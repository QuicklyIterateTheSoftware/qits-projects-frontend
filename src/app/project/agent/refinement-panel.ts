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
import { QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import type { AgentSurface } from '../../api/agent-daemon-api';
import type { AgentContainerDto } from '../../api/project-agent-api';
import { ProjectEvents } from '../../api/project-events';
import { RefinementSession } from './refinement-session';
import { TerminalView } from './terminal-view';

/** Which destructive control is waiting for its second press. */
type Pending = 'terminate' | 'stop' | null;

/**
 * The four sentences a surface owns. Everything else on the panel is the same at both.
 *
 * <p>Kept as a table rather than as two components because the difference between the two front
 * desks really is only what they are called and what they are for: the container, the three verbs,
 * the sign-in replay, the badge and the status line are one behaviour, and a second copy of them
 * would be a second place for that behaviour to drift.
 */
interface DeskWords {
  /** The disclosure's own word — what a reader scanning a collapsed page sees. */
  readonly title: string;
  /** The invitation in the dormant branch, before the shared sentence about the container. */
  readonly invitation: string;
  /** The resolving line. */
  readonly starting: string;
  /** The idle branch's opening sentence, before the shared one about resuming being a choice. */
  readonly idleLead: string;
  /** The terminal's accessible label. */
  readonly terminal: string;
}

const WORDS: Readonly<Record<AgentSurface, DeskWords>> = {
  'project.epics': {
    title: 'Refinement agent',
    invitation: 'Talk to the agent to draft and refine this project’s epics.',
    starting: 'Starting the refinement agent…',
    idleLead: 'This project has been refined before and nothing is running now.',
    terminal: 'Refinement agent session',
  },
  'project.tickets': {
    title: 'Triage agent',
    invitation: 'Talk to the agent to file and triage this project’s tickets.',
    starting: 'Starting the triage agent…',
    idleLead: 'This project’s tickets have been triaged before and nothing is running now.',
    terminal: 'Triage agent session',
  },
};

/**
 * A front desk: one conversation per project per desk, driven from a terminal at the head of a board.
 *
 * <p><b>One agent per board, not one per row.</b> Refining is a conversation about the whole plan —
 * "new epic: …", "add a feature to the auth epic", "that one is superseded" — and an agent that could
 * only see one epic could not answer any of those. Triage is the same shape one size down: "file
 * this", "that is a duplicate of the badge one", "close the fixed ones". So this sits at the head of
 * the board it is about, above the rows it changes, and those rows refresh through the project's live
 * channel when the agent changes them.
 *
 * <p><b>Two surfaces, one panel, one behaviour.</b> {@link surface} chooses which board this is the
 * front desk of. It changes four sentences ({@link WORDS}) and is sent on every launch, which is what
 * decides the stored configuration the session is rendered from; it does not change what any button
 * does. The two share a container and a sign-in and nothing else — each gets its own
 * {@link RefinementSession}, provided here rather than at the root, so mounting the second panel
 * cannot pull the first one's terminal onto the other surface's screen.
 *
 * <p><b>Nobody signed in is a screen with a button, not a redirect.</b> A launch against a harness
 * with no sign-in on the shared credential volume is refused, and this says so and offers the
 * terminal. It used to be handed one silently in place of the session it asked for, and attach to it
 * as though that were what happened.
 *
 * <p><b>Collapsed and dormant by default, and that is a rule rather than a default.</b> A session
 * costs an image pull, a repository clone and a model process. So this panel is one row until it is
 * asked for: expanding reads the container's status and nothing else, and only Start ensures a
 * container. The board below must stay exactly as cheap to open as it was before this existed — the
 * spec pins that by verifying no request at all leaves on page load, and it is what makes putting a
 * second one of these on the tickets page free.
 *
 * <p><b>Collapsing detaches; it never terminates.</b> The agent keeps working with the panel shut
 * and with the browser closed, which is what makes reopening cheap and is why closing asks nothing.
 * Ending the conversation is its own control, and stopping the container is a third — three verbs,
 * because conflating any two of them loses work. The two that do lose work ask twice, in the
 * button, the way the epic actions do.
 *
 * <p><b>An unreachable daemon is one sentence.</b> The proxy resolves through a tunnel registry
 * that empties the moment the daemon's control socket drops, so a single blip turns every request
 * here into a 502 at once. Saying it once in the status line is the honest report; a failure notice
 * per request would describe one event as several.
 */
@Component({
  selector: 'app-refinement-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsButton, TerminalView],
  // One session per panel, not one per application: see the class note on two desks.
  providers: [RefinementSession],
  template: `
    <section class="panel">
      <header class="bar">
        <button class="toggle" type="button" [attr.aria-expanded]="expanded()" (click)="toggle()">
          <span class="caret" aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>
          {{ words().title }}
        </button>

        <qits-badge [label]="chip().label" [tone]="chip().tone" />

        @if (!expanded()) {
          <qits-button variant="secondary" size="sm" [busy]="session.busy()" (pressed)="start()">
            Start
          </qits-button>
        }
      </header>

      @if (expanded()) {
        <p class="status" role="status">{{ statusLine() }}</p>

        @if (unreachable()) {
          <p class="offline" role="status">
            The agent daemon is not answering, so nothing in this panel can reach it right now.
          </p>
        }

        @if (session.problem(); as message) {
          <p class="failed" role="alert">{{ message }}</p>
        }

        @switch (branch().kind) {
          @case ('dormant') {
            <p class="prose">
              {{ words().invitation }} Starting one creates the project’s agent container if it does
              not exist yet.
            </p>
            <qits-button variant="secondary" size="sm" [busy]="session.busy()" (pressed)="start()">
              Start
            </qits-button>
          }

          @case ('resolving') {
            <p class="prose">{{ words().starting }}</p>
          }

          @case ('unavailable') {
            <p class="prose">{{ unavailableMessage() }}</p>
            <qits-button variant="secondary" size="sm" [busy]="session.busy()" (pressed)="start()">
              Try again
            </qits-button>
          }

          @case ('signed-out') {
            <p class="prose">{{ signedOut().message }}</p>
            <p class="prose">
              Signing in writes to the platform's shared credential volume, so one sign-in serves
              every container on it. The terminal below is opened because you asked for it — nothing
              was started in place of the session.
            </p>
            <qits-button
              variant="secondary"
              size="sm"
              [busy]="session.busy()"
              (pressed)="openSignIn()"
            >
              Open the {{ signedOut().harness }} sign-in terminal
            </qits-button>
          }

          @case ('idle') {
            <p class="prose">
              {{ words().idleLead }} Continuing the last conversation is a choice rather than
              something that happens on its own — the container may no longer hold it.
            </p>
            <div class="actions">
              <qits-button
                variant="secondary"
                size="sm"
                [busy]="session.busy()"
                (pressed)="startFresh()"
              >
                New session
              </qits-button>
              @if (lastSessionId(); as sessionId) {
                <qits-button
                  variant="ghost"
                  size="sm"
                  [busy]="session.busy()"
                  (pressed)="resume(sessionId)"
                >
                  Resume the last session
                </qits-button>
              }
            </div>
          }

          @default {
            <app-terminal-view
              [frames]="session.frames()"
              [attached]="live()"
              [label]="words().terminal"
              (data)="session.send($event)"
              (resized)="session.resize($event.cols, $event.rows)"
            />

            <div class="actions">
              @if (session.link() === 'lost') {
                <qits-button variant="secondary" size="sm" (pressed)="session.rearm()">
                  Reconnect
                </qits-button>
              }
              @if (session.link() === 'disconnected') {
                <qits-button
                  variant="secondary"
                  size="sm"
                  [busy]="session.busy()"
                  (pressed)="startFresh()"
                >
                  New session
                </qits-button>
              }
              <qits-button variant="ghost" size="sm" (pressed)="collapse()">Detach</qits-button>
              <qits-button
                variant="ghost"
                size="sm"
                [busy]="session.busy()"
                (pressed)="press('terminate')"
              >
                {{ pending() === 'terminate' ? 'Confirm end session?' : 'End session' }}
              </qits-button>
              <qits-button
                variant="ghost"
                size="sm"
                [busy]="session.busy()"
                (pressed)="press('stop')"
              >
                {{ pending() === 'stop' ? 'Confirm stop container?' : 'Stop container' }}
              </qits-button>
            </div>
          }
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    .panel {
      padding: 0.6rem 0.75rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    /* A real button: the whole row is the disclosure, so it has to carry the keyboard and the
       aria-expanded state rather than being a styled div with a click handler. */
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0;
      border: 0;
      background: none;
      color: #111827;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .caret {
      color: #6b7280;
    }
    .status {
      margin: 0.6rem 0 0;
      color: #6b7280;
      font-size: 0.8rem;
    }
    .offline {
      margin: 0.35rem 0 0;
      color: #b45309;
      font-size: 0.85rem;
    }
    .failed {
      margin: 0.35rem 0 0;
      color: #b91c1c;
      font-size: 0.85rem;
    }
    .prose {
      margin: 0.6rem 0;
      color: #374151;
      font-size: 0.9rem;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
  `,
})
export class RefinementPanel {
  protected readonly session = inject(RefinementSession);
  private readonly events = inject(ProjectEvents);

  /** Which project's agent. The panel is per project, and so is the container behind it. */
  readonly projectId = input.required<string>();

  /**
   * Which session surface this is — where in the product the reader is standing.
   *
   * Defaulted rather than required, and to the one that existed first: the epics page mounts this
   * without the attribute and gets exactly what it always got.
   */
  readonly surface = input<AgentSurface>('project.epics');

  protected readonly words = computed(() => WORDS[this.surface()]);

  protected readonly expanded = signal(false);

  protected readonly pending = signal<Pending>(null);

  protected readonly branch = this.session.branch;

  /** Whether keystrokes reach anything. A reconnecting terminal is readable and inert. */
  protected readonly live = computed(() => this.session.link() === 'open');

  protected readonly unreachable = computed(
    () => this.expanded() && this.session.reachability() === 'unreachable',
  );

  protected readonly lastSessionId = computed(() => {
    const branch = this.session.branch();
    return branch.kind === 'idle' ? branch.lastSessionId : null;
  });

  /** The refusal's two sentences, or empty ones when this is not the branch on screen. */
  protected readonly signedOut = computed(() => {
    const branch = this.session.branch();
    return branch.kind === 'signed-out'
      ? { harness: branch.harness, message: branch.message }
      : { harness: 'the coding agent', message: '' };
  });

  protected readonly unavailableMessage = computed(() => {
    const branch = this.session.branch();
    return branch.kind === 'unavailable' ? branch.message : '';
  });

  /** The one word in the collapsed row. It answers "is there an agent here" and nothing more. */
  protected readonly chip = computed<{ label: string; tone: QitsBadgeTone }>(() => {
    const container = this.session.container();
    if (!container) {
      return { label: this.expanded() ? 'Checking…' : 'Not started', tone: 'neutral' };
    }
    return chipFor(container);
  });

  /** The thin line under the header: where the container is, and what is running in it. */
  protected readonly statusLine = computed(() => {
    const container = this.session.container();
    const parts: string[] = [];
    parts.push(container ? containerWords(container) : 'Container status not read yet');
    if (container && container.runtimeStatus !== 'ABSENT') {
      parts.push(container.daemonConnected ? 'daemon connected' : 'daemon not connected');
    }
    const harness = this.session.agentType();
    if (harness) {
      parts.push(harness === 'CLAUDE' ? 'Claude' : 'Kimi');
    }
    parts.push(linkWords(this.session.link(), this.session.branch().kind));
    return parts.join(' · ');
  });

  /** Which project the hint latch has seen, so a project hop is told apart from an invalidation. */
  private watching: string | null = null;
  private seenHint = -1;

  constructor() {
    // Pointing the session at a project makes no request — that is the dormancy rule, and it is why
    // this may run on page load at all. A hop closes the panel: the agent behind it was the other
    // project's, and leaving the terminal open would show one project's session under another's
    // heading.
    effect(() => {
      const projectId = this.projectId();
      const surface = this.surface();
      untracked(() => {
        this.session.use(projectId, surface);
        this.expanded.set(false);
        this.pending.set(null);
      });
    });

    effect(() => {
      const projectId = this.projectId();
      const hint = this.events.invalidations('agent-activity')();
      const expanded = this.expanded();
      untracked(() => this.decideRefresh(projectId, hint, expanded));
    });

    // Detaching, never terminating: the agent outlives this page, which is the whole reason leaving
    // is free. The channel itself belongs to the epics overview and is not closed here.
    inject(DestroyRef).onDestroy(() => this.session.detach());
  }

  /** Open or shut the panel. Opening reads the container's status; shutting lets the socket go. */
  protected toggle(): void {
    this.pending.set(null);
    if (this.expanded()) {
      this.collapse();
      return;
    }
    this.expanded.set(true);
    void this.session.refreshContainer();
  }

  protected collapse(): void {
    this.expanded.set(false);
    this.pending.set(null);
    this.session.detach();
  }

  /** The expensive press: ensure the container, then resolve what to attach to. */
  protected start(): void {
    this.expanded.set(true);
    this.pending.set(null);
    void this.session.start();
  }

  protected startFresh(): void {
    this.pending.set(null);
    void this.session.startFresh();
  }

  protected resume(sessionId: string): void {
    this.pending.set(null);
    void this.session.resume(sessionId);
  }

  /** The deliberate press the refusal offers. Opens a terminal; it never opens a session. */
  protected openSignIn(): void {
    this.pending.set(null);
    void this.session.openSignIn();
  }

  /**
   * Ask once, then do it.
   *
   * The confirmation is the button rather than a dialog, exactly as the epic actions do it:
   * `window.confirm` blocks the page, cannot be styled to match anything here and is awkward to
   * assert, while a button that changes its own label asks in the place the reader is already
   * looking — and un-asks itself the moment the other control is pressed.
   */
  protected press(control: Exclude<Pending, null>): void {
    if (this.pending() !== control) {
      this.pending.set(control);
      return;
    }
    this.pending.set(null);
    if (control === 'terminate') {
      void this.session.terminate();
    } else {
      void this.session.stopContainer();
    }
  }

  /**
   * The catch-up read.
   *
   * The first observation is never a refetch: expanding has just read the container, and answering
   * the same hint again would make opening the panel cost two requests instead of one. A hint that
   * lands while the panel is shut is swallowed rather than remembered — the next expand reads the
   * status anyway, so remembering it would only buy a duplicate.
   */
  private decideRefresh(projectId: string, hint: number, expanded: boolean): void {
    if (this.watching !== projectId) {
      this.watching = projectId;
      this.seenHint = hint;
      return;
    }
    if (hint === this.seenHint) {
      return;
    }
    this.seenHint = hint;
    if (expanded) {
      void this.session.refreshContainer();
    }
  }
}

/** The collapsed row's badge, which has to be readable without the status line beside it. */
function chipFor(container: AgentContainerDto): { label: string; tone: QitsBadgeTone } {
  switch (container.runtimeStatus) {
    case 'RUNNING':
      // Running without a connected daemon is the window between `docker start` and the control
      // socket dialling back in. Every proxied request 502s in it, so it is not "ready".
      return container.daemonConnected
        ? { label: 'Ready', tone: 'success' }
        : { label: 'Starting', tone: 'warning' };
    case 'PROVISIONING':
      return { label: 'Provisioning', tone: 'info' };
    case 'STOPPED':
      return { label: 'Stopped', tone: 'neutral' };
    case 'FAILED':
      return { label: 'Failed', tone: 'danger' };
    default:
      return { label: 'Not started', tone: 'neutral' };
  }
}

function containerWords(container: AgentContainerDto): string {
  switch (container.runtimeStatus) {
    case 'RUNNING':
      return 'Container running';
    case 'PROVISIONING':
      return 'Container provisioning';
    case 'STOPPED':
      return 'Container stopped';
    case 'FAILED':
      return 'Container failed';
    default:
      return 'No container yet';
  }
}

/** What the socket is doing, said only when there is a socket to say it about. */
function linkWords(link: string, branch: string): string {
  if (branch !== 'attached' && branch !== 'signin') {
    return 'not attached';
  }
  switch (link) {
    case 'open':
      return 'attached';
    case 'connecting':
      return 'attaching';
    case 'reconnecting':
      return 'reconnecting';
    case 'lost':
      return 'lost the connection';
    default:
      return 'the session ended';
  }
}
