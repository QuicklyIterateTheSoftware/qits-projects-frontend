import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ProjectEvents } from '../api/project-events';
import { ProjectsApi } from '../api/projects-api';
import { RefiningService } from '../refining/refining-service';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { EpicActions } from './epic-actions';
import { EpicCard } from './epic-card';
import { EpicDraftCard } from './epic-draft-card';
import { EpicSummaryRow } from './epic-summary-row';
import {
  actionKey,
  actionsFor,
  epicAnchor,
  epicTitles,
  groupEpics,
  type EpicAction,
  type EpicNode,
} from './epics-model';

/** Which epic an action is running against, and which of its buttons it is. */
interface InFlight {
  readonly id: string;
  /** The action's {@link actionKey} — a status for a transition, `refine` for the refining workspace. */
  readonly key: string;
}

/** Why the last transition on one epic did not happen, kept beside the epic it is about. */
interface Failure {
  readonly id: string;
  readonly message: string;
}

/**
 * The epics a project is being changed by, grouped by where each one stands.
 *
 * <p><b>One state for the whole fan-out.</b> The service answers the three levels separately, so a
 * full tree is one read plus one per epic plus one per feature — but a card holding a feature whose
 * tasks are still in flight is a card that says an epic is smaller than it is. So the panel waits
 * for all of it and shows one loading state, and a failure anywhere is a failure of the panel with
 * one retry, rather than a page of half-drawn cards each offering its own.
 *
 * <p>The read is keyed on the project id in an effect, because the sub-navigation re-uses this
 * instance across a project hop. **A late answer is dropped** rather than rendered: the fan-out is
 * several round trips deep, so a hop can easily land while an older tree is still assembling, and
 * the last response to arrive is not the one the route is on.
 *
 * <p><b>Grouped from the one read, never from `?status=`.</b> The filter exists on the server, but
 * asking it five times would be five moments, and one of the five groups cannot be asked for at all
 * — done is a shape of the tree rather than a value on the row. So the fan-out stays single and
 * `groupEpics` does the splitting.
 *
 * <p><b>Two sections are always there, three appear only when they hold something.</b> Refining and
 * implementation are the work, so an empty one is a fact worth stating; done, superseded and
 * abandoned are the record, so they open collapsed with their count and stay out of the way of a
 * project that has none.
 *
 * <p>A transition re-reads the whole tree rather than splicing the answer in: superseding creates a
 * second epic, and a panel that patched one row would show a draft that is not there.
 *
 * <p><b>One of a draft's buttons is not a transition.</b> Refine starts (or re-enters) a workspace on
 * the wrapper's `refining/<slug>` branch and navigates to it, leaving the epic exactly where it was.
 * It shares this panel's busy state and its error pinning — a project with no wrapper, a git host that
 * refused the ref and a workspaces service that is down all land beside the card, because in every one
 * of them the screen is still correct and only the workspace is missing — and it shares nothing else.
 *
 * <p><b>It listens as well as reads.</b> A refinement agent — or another tab — changes these epics
 * without this page doing anything, so the project's live channel hints and the panel re-reads. The
 * hint carries nothing, which is the point: there is no pushed shape to reconcile against a tree
 * this deep.
 *
 * <p><b>A hint's refresh is quiet.</b> Only an arrival, a project hop and the retry show the loading
 * state; a hint swaps the tree underneath the reader when it lands. Blanking the panel on every hint
 * would make the page flash for as long as an agent kept typing, and it would be dishonest — what is
 * on screen is a moment old, not unknown. For the same reason a quiet re-read that *fails* leaves
 * the tree standing: the next hint corrects it, and one bad round trip should not take the plan off
 * the screen.
 */
@Component({
  selector: 'app-epics-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, EpicActions, EpicCard, EpicDraftCard, EpicSummaryRow],
  template: `
    <header>
      <h2>Epics</h2>
      @if (behind()) {
        <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
      }
    </header>

    <app-async
      [state]="epics()"
      loadingLabel="Loading the epics"
      errorLabel="Could not load the epics"
      (retry)="load()"
    />

    @if (loaded()) {
      @if (nodes().length === 0) {
        <app-empty message="This project has no epics yet." />
      } @else {
        <section class="group">
          <h3>Refining</h3>
          @if (groups().refining.length === 0) {
            <app-empty message="No epic is being drafted." />
          } @else {
            <div class="cards">
              @for (node of groups().refining; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-draft-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="choose(node, $event)"
                  />
                </div>
              }
            </div>
          }
        </section>

        <section class="group">
          <h3>Implementation</h3>
          @if (groups().implementation.length === 0) {
            <app-empty message="No epic is being implemented." />
          } @else {
            <div class="cards">
              @for (node of groups().implementation; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="choose(node, $event)"
                  />
                </div>
              }
            </div>
          }
        </section>

        @if (groups().done.length > 0) {
          <details class="group">
            <summary>Done ({{ groups().done.length }})</summary>
            <div class="cards">
              @for (node of groups().done; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="choose(node, $event)"
                  />
                </div>
              }
            </div>
          </details>
        }

        @if (groups().superseded.length > 0) {
          <details class="group">
            <summary>Superseded ({{ groups().superseded.length }})</summary>
            <div class="rows">
              @for (node of groups().superseded; track node.epic.id) {
                <app-epic-summary-row [node]="node" [successorTitle]="successorTitle(node)" />
              }
            </div>
          </details>
        }

        @if (groups().abandoned.length > 0) {
          <details class="group">
            <summary>Abandoned ({{ groups().abandoned.length }})</summary>
            <div class="rows">
              @for (node of groups().abandoned; track node.epic.id) {
                <app-epic-summary-row [node]="node" />
              }
            </div>
          </details>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    /* The marker shares the heading's line, so it appears and disappears without moving anything
       below it — a channel that flaps must not make the plan jump under the reader's eye. */
    header {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin: 0 0 0.5rem;
    }
    h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: #111827;
    }
    .behind {
      margin: 0;
      color: #6b7280;
      font-size: 0.8rem;
      font-style: italic;
    }
    h3 {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .group {
      margin-top: 1rem;
    }
    summary {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    details .cards,
    details .rows {
      margin-top: 0.5rem;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
  `,
})
export class EpicsOverview {
  private readonly api = inject(ProjectsApi);
  private readonly events = inject(ProjectEvents);
  private readonly refining = inject(RefiningService);
  private readonly router = inject(Router);

  readonly projectId = input.required<string>();

  protected readonly epics = signal<Loadable<readonly EpicNode[]>>(LOADING);

  protected readonly inFlight = signal<InFlight | null>(null);

  protected readonly failure = signal<Failure | null>(null);

  protected readonly loaded = computed(() => this.epics().kind === 'ready');

  protected readonly nodes = computed<readonly EpicNode[]>(() => {
    const state = this.epics();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly groups = computed(() => groupEpics(this.nodes()));

  private readonly titles = computed(() => epicTitles(this.nodes()));

  /** Whether the channel has ever been up. Nothing is "behind" before it has ever been current. */
  private readonly wasLive = signal(false);

  /**
   * Whether to say the panel is lagging. It stays quiet on a page that never had a channel at all —
   * an SSE endpoint an older service does not serve is not a reader's problem.
   */
  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  /** Which project the last run of the read effect was for, so a hop is told apart from a hint. */
  private watching: string | null = null;

  /** The hint count that run had seen. The number itself means nothing; only its movement does. */
  private hinted = 0;

  /** How many reads have started. A read that is no longer the newest is dropped when it lands. */
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const hints = this.events.invalidations('epics')();
      if (!projectId) {
        return;
      }
      // Arrival and a project hop show the loading state. A hint on the project already on screen
      // never does — that is the whole difference between the two ways this effect runs.
      const quiet = projectId === this.watching && hints !== this.hinted;
      this.watching = projectId;
      this.hinted = hints;
      untracked(() => {
        this.events.connect(projectId);
        void this.load(projectId, quiet);
      });
    });

    effect(() => {
      if (this.events.connected()) {
        this.wasLive.set(true);
      }
    });

    inject(DestroyRef).onDestroy(() => this.events.close());
  }

  protected anchor(node: EpicNode): string {
    return epicAnchor(node.epic.id);
  }

  protected actions(node: EpicNode) {
    return actionsFor(node.epic.status);
  }

  protected running(node: EpicNode): string | null {
    const flight = this.inFlight();
    return flight?.id === node.epic.id ? flight.key : null;
  }

  protected error(node: EpicNode): string | null {
    const failure = this.failure();
    return failure?.id === node.epic.id ? failure.message : null;
  }

  /** The successor's title when this list holds it; null draws no link — see the row component. */
  protected successorTitle(node: EpicNode): string | null {
    const id = node.epic.supersededByEpicId;
    return id ? (this.titles().get(id) ?? null) : null;
  }

  /**
   * Do what the button asked for — one of two quite different things, told apart by the action's own
   * discriminant rather than by reading a status.
   *
   * The two share the busy state and the error-pinning and nothing else: a transition moves the epic and
   * re-reads the tree, refining leaves the epic exactly where it was and navigates away.
   */
  protected async choose(node: EpicNode, action: EpicAction): Promise<void> {
    const id = node.epic.id;
    this.inFlight.set({ id, key: actionKey(action) });
    this.failure.set(null);
    try {
      if (action.kind === 'refine') {
        await this.refine(node);
      } else {
        await this.api.transitionEpic(id, action.target);
        await this.load();
      }
    } catch (error) {
      this.failure.set({ id, message: describeError(error) });
    } finally {
      this.inFlight.set(null);
    }
  }

  /**
   * Open this epic's refining workspace, starting one if there is none, then go to it.
   *
   * <p><b>The tree is not re-read afterwards, because nothing about it changed.</b> The epic is
   * `REFINING` before the press and `REFINING` after it — what the press produced is a branch and a
   * container in another service — so re-reading would be several round trips confirming a tree the
   * page is about to leave anyway. That is the difference from a transition, and it is why the two
   * share only the busy state and the failure.
   */
  private async refine(node: EpicNode): Promise<void> {
    await this.refining.open(node);
    await this.router.navigate([this.projectId(), 'epics', node.epic.slug, 'refining']);
  }

  /**
   * Read the whole tree.
   *
   * A loud read blanks what is on screen first — arrival, a project hop, a retry, a transition. A
   * quiet one leaves the tree up and swaps it when the new one arrives, and leaves it up when the
   * new one does not: a hint's refresh that failed means the panel is a moment old, which is what it
   * already was, so taking the plan off the screen would report a problem by causing a worse one.
   */
  protected async load(projectId = this.projectId(), quiet = false): Promise<void> {
    if (!quiet) {
      this.epics.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const tree = await this.read(projectId);
      if (this.newest(projectId, attempt)) {
        this.epics.set(ready(tree));
      }
    } catch (error) {
      if (this.newest(projectId, attempt) && !(quiet && this.loaded())) {
        this.epics.set(failed(error));
      }
    }
  }

  /**
   * Whether an answer that has just landed is still the one the panel is waiting for.
   *
   * Two ways it is not. The project may have moved on — the fan-out is several round trips deep, so
   * a hop lands easily while an older tree is still assembling. Or a newer read may have started for
   * the *same* project: hints arrive while an agent works, and an older tree overwriting a newer one
   * would put the panel a step behind and keep it there until the next hint.
   */
  private newest(projectId: string, attempt: number): boolean {
    return attempt === this.attempt && projectId === this.projectId();
  }

  /** The epics, then their features, then their tasks — each level in parallel across its parents. */
  private async read(projectId: string): Promise<readonly EpicNode[]> {
    const epics = await this.api.epics(projectId);
    return Promise.all(
      epics.map(async (epic) => ({
        epic,
        features: await Promise.all(
          (await this.api.features(epic.id)).map(async (feature) => ({
            feature,
            tasks: await this.api.tasks(feature.id),
          })),
        ),
      })),
    );
  }
}
