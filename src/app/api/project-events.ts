import { Injectable, inject, signal, type Signal } from '@angular/core';
import { QITS_API_BASE } from './api-base';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from './event-source';

/**
 * Every topic one project's live channel emits, copied from `ProjectChangeHint.Topic` with the
 * service's own naming rule applied: the enum constant lowercased, underscores to hyphens.
 *
 * The list is complete rather than trimmed to what is drawn today. `agent-activity` fires against a
 * reader that does not exist yet — the channel is ahead of the screen — and a counter costs a
 * signal, so declaring it now means the refinement panel wires to a topic that is already ticking
 * instead of adding one.
 */
export const PROJECT_TOPICS = ['epics', 'agent-activity'] as const;

/** One of {@link PROJECT_TOPICS}. */
export type ProjectTopic = (typeof PROJECT_TOPICS)[number];

/**
 * The project's live channel: one connection, payload-free hints, and a counter per topic.
 *
 * **Hint-and-refetch, not push-the-data.** Every frame is a topic name and nothing else. A panel
 * reads the counter for the topic it cares about inside an `effect` and re-issues its own ordinary
 * REST request when the number moves. That is why an idle project produces no traffic at all —
 * polling has a floor and this does not. It also means there is no pushed shape to drift from the
 * fetched one, and no partial-update merge logic anywhere. An epic tree assembled from three
 * levels of fan-out is exactly the shape you do not want to patch by hand.
 *
 * **Invalidate everything on every connect, and on every reconnect.** {@link handleOpen} bumps all
 * counters. There is no replay protocol here, no `Last-Event-ID`, no resume token and no
 * snapshot-then-delta — the server offers none and the client must not invent one. The browser's
 * own reconnect handles the retry; this one burst closes whatever gap the disconnected window
 * left. It costs a handful of requests on reconnect and removes an entire class of correctness
 * bugs, which is the best trade on the screen.
 *
 * **An unrecognised topic is ignored, not an error.** `ping` arrives every ~25 seconds to hold the
 * connection open through intermediate proxies, and a newer service may invent a topic this build
 * has never heard of. Both fall through the same door.
 *
 * **Nothing here polls.** That is a rule and not a tendency: this page has a channel, so it must
 * not also put a traffic floor under a project nobody is changing.
 *
 * The service is application-scoped but singly-owned: the project page's epics overview opens it
 * for the project it is showing and closes it on destroy. {@link connected} is what draws the quiet
 * inline marker saying the panel is briefly behind — a stale-data notice, not a failure: what is on
 * screen is a moment old rather than wrong.
 */
@Injectable({ providedIn: 'root' })
export class ProjectEvents {
  private readonly base = inject(QITS_API_BASE);
  private readonly openStream = inject(EVENT_SOURCE_FACTORY);

  private readonly counters = new Map(PROJECT_TOPICS.map((topic) => [topic, signal(0)] as const));

  private readonly link = signal(false);

  /** Whether the channel is up. False means the data is stale and will catch up, not that it is wrong. */
  readonly connected: Signal<boolean> = this.link.asReadonly();

  private source: EventSourceLike | null = null;
  private streamed: string | null = null;

  /**
   * How many times this topic has been invalidated. Read it in an `effect`; the value is meaningless
   * and only its movement matters.
   */
  invalidations(topic: ProjectTopic): Signal<number> {
    return this.counters.get(topic)!.asReadonly();
  }

  /**
   * Watch one project. Calling it again for the same id does nothing, so an effect may call it
   * freely; calling it for a different id moves the connection, because the page is per-project and
   * hints about the one just left are noise.
   */
  connect(projectId: string): void {
    if (this.streamed === projectId && this.source) {
      return;
    }
    this.close();
    this.streamed = projectId;
    const source = this.openStream(
      `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/events`,
    );
    source.onopen = () => this.handleOpen();
    source.onmessage = (event) => this.handleTopic(event.data);
    source.onerror = () => this.link.set(false);
    this.source = source;
  }

  /** Stop watching. The overview calls this on destroy; nothing else should need to. */
  close(): void {
    this.source?.close();
    this.source = null;
    this.streamed = null;
    this.link.set(false);
  }

  private handleOpen(): void {
    this.link.set(true);
    for (const counter of this.counters.values()) {
      counter.update((count) => count + 1);
    }
  }

  private handleTopic(data: string): void {
    const counter = this.counters.get(data.trim() as ProjectTopic);
    counter?.update((count) => count + 1);
  }
}
