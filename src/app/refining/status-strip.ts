import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import type { WorkspaceDaemonReachability } from '../api/workspace-daemon-api';
import { RefinementsApi, isSessionRoom, type RefinementDto } from '../api/refinements-api';
import { describeError } from '../ui/loadable';

/** Which button is waiting on the server. Never "some mutation is pending" — one Stop must not spin Start. */
type Pending = 'start' | 'stop' | null;

const RUNTIME_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  RUNNING: 'success',
  STARTING: 'info',
  STOPPED: 'neutral',
  PROVISIONING: 'info',
  FAILED: 'danger',
};

/** What the strip says about the front desk a session room's session runs in. */
export interface DeskState {
  readonly label: string;
  readonly tone: QitsBadgeTone;
  /** What the state means for the room's session, or null when it needs no sentence. */
  readonly note: string | null;
}

/**
 * The desk's state word, said for a room whose session runs in it. An unknown word is drawn as
 * itself: the vocabulary is the service's (`FrontDeskState`) and may grow.
 */
export function deskState(status: string | null | undefined): DeskState {
  switch (status) {
    case 'RUNNING':
      return { label: 'running', tone: 'success', note: null };
    case 'QUEUED':
      return {
        label: 'queued',
        tone: 'info',
        note: 'The desk is waiting for a front-desk runner to take it. The session starts once it is up.',
      };
    case 'PROVISIONING':
      return {
        label: 'provisioning',
        tone: 'info',
        note: 'The desk is being brought up. The session starts once it is.',
      };
    case 'UNAVAILABLE':
      return {
        label: 'unavailable',
        tone: 'warning',
        note: 'The desk’s runner has been offline past its reconnect grace. No session can run in it until the runner is back.',
      };
    case 'FAILED':
      return {
        label: 'failed',
        tone: 'danger',
        note: 'The desk failed, so the session cannot run in it.',
      };
    case 'STOPPED':
      return {
        label: 'stopped',
        tone: 'neutral',
        note: 'The desk is stopped. Starting the room asks for it again.',
      };
    case 'ABSENT':
      return {
        label: 'not created',
        tone: 'neutral',
        note: 'The project has no desk yet. Starting the room asks for one.',
      };
    case null:
    case undefined:
    case '':
      return { label: 'state unknown', tone: 'neutral', note: null };
    default:
      return { label: status.toLowerCase(), tone: 'neutral', note: null };
  }
}

/**
 * Everything the refining page knows about the state of its room, plus the verbs that change it.
 *
 * **Two kinds of room, one strip** (epic qits-770). A room opened now is a **session** of the
 * project's front desk: the strip shows the session's state (`runtimeStatus`, with `runtimeError`
 * as its detail) and the desk's (`deskStatus`, with `deskDetail`), because a queued, unavailable or
 * failed desk is the commonest reason a session is not running and the session's own state cannot
 * say so. A **legacy** room — one with a `refining/<slug>` branch, opened before the sessions — is
 * still a container of its own until qits-1316 retires it, and shows that container's state.
 *
 * **What the container rooms used to show is gone**: the daemon's version, the working tree's
 * cleanliness, the drift against the parent and the Recreate guarded by them. A session room has
 * none of it, and the service stops serving those fields with the next release, so a legacy room
 * would soon have read "unknown" in every one of them. Recreate went with them — it is no door of a
 * session room, and its container door goes in the same release.
 *
 * **The verbs live beside the state they act on.** Start is the room's `ensure` and Stop its `stop`,
 * for either kind. Lifecycle decisions about the entity are deliberately absent.
 *
 * **A legacy room's unreachable daemon is still a sentence**, not seven 502s: the container proxy
 * failing to reach anything takes the file browser, every terminal and the agent surface down at once.
 *
 * **Mutations refresh on settled, not on success.** A failed start still changed something worth
 * re-reading, and the truth after a refusal is more useful than the stale row that produced it.
 */
@Component({
  selector: 'app-status-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsButton],
  templateUrl: './status-strip.html',
  styleUrl: './status-strip.css',
})
export class StatusStrip {
  /** The refinement row, as qits-projects last reported it. */
  readonly workspace = input.required<RefinementDto>();

  /** What the room's daemon proxy last said. */
  readonly reachability = input<WorkspaceDaemonReachability>('unknown');

  /** Whether the hint channel is up. False draws the quiet stale-data marker. */
  readonly live = input(true);

  /** Something changed on the server. The page re-reads. */
  readonly changed = output<void>();

  private readonly api = inject(RefinementsApi);

  protected readonly pending = signal<Pending>(null);
  protected readonly failure = signal<string | null>(null);

  /** Whether the room is a session of the front desk rather than a container of its own. */
  protected readonly session = computed(() => isSessionRoom(this.workspace()));

  protected readonly runtimeTone = computed<QitsBadgeTone>(
    () => RUNTIME_TONES[this.workspace().runtimeStatus ?? ''] ?? 'neutral',
  );

  protected readonly runtimeLabel = computed(
    () => this.workspace().runtimeStatus?.toLowerCase() ?? 'state unknown',
  );

  /**
   * Whether Stop is the verb on offer. A session that is starting is already wanted, so it is
   * stopped rather than started again; a container is only stopped once it runs.
   */
  protected readonly running = computed(() => {
    const status = this.workspace().runtimeStatus;
    return status === 'RUNNING' || (this.session() && status === 'STARTING');
  });

  protected readonly desk = computed(() => deskState(this.workspace().deskStatus));

  /** A legacy room's daemon is reached through its own container; say so when it is not. */
  protected readonly daemonGone = computed(
    () =>
      !this.session() &&
      this.workspace().runtimeStatus === 'RUNNING' &&
      this.reachability() === 'unreachable',
  );

  protected async start(): Promise<void> {
    await this.run('start', () => this.api.ensure(this.workspace().id));
  }

  protected async stop(): Promise<void> {
    await this.run('stop', () => this.api.stop(this.workspace().id));
  }

  /**
   * One verb: spin its own button, keep the reason on a failure, and refresh either way.
   *
   * The `finally` is the "settled, not success" rule in three lines — a refused start still moved
   * something, and the row that produced the refusal is the least trustworthy thing on the page.
   */
  private async run(which: Exclude<Pending, null>, call: () => Promise<unknown>): Promise<void> {
    this.pending.set(which);
    this.failure.set(null);
    try {
      await call();
    } catch (error) {
      this.failure.set(describeError(error));
    } finally {
      this.pending.set(null);
      this.changed.emit();
    }
  }
}
