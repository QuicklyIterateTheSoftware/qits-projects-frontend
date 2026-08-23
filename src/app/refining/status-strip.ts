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
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import { driftLabel, relativeSince } from '../ui/format';
import { describeError } from '../ui/loadable';

/** Which button is waiting on the server. Never "some mutation is pending" — one Stop must not spin Start. */
type Pending = 'start' | 'stop' | 'recreate' | null;

/** What the page can say about the in-container daemon right now. */
type DaemonState = 'connected' | 'gone' | 'not-running';

const RUNTIME_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  RUNNING: 'success',
  STOPPED: 'neutral',
  PROVISIONING: 'info',
  FAILED: 'danger',
};

/**
 * Everything the refining page knows about the state of its own workspace, plus the verbs that change
 * it. Copied from qits-spa-workspaces' detail shell, where every field here was already on the wire.
 *
 * **The verbs live beside the state they act on**, which is why this is a strip and not a toolbar.
 * Start, Stop and Recreate sit next to the runtime state. Epic lifecycle decisions are deliberately
 * absent: they belong below the epic document, not among container diagnostics.
 *
 * **Recreate is disabled unless the tree is provably clean.** The service refuses with a 400
 * otherwise, and `clean: null` — what a workspace with no live daemon reports — counts as not clean.
 * That combination is the sharp edge: recreate is the remedy for an outdated daemon, and an outdated
 * daemon is quite often a disconnected one, so the button most likely to be reached for is exactly
 * the one that must explain why it cannot be pressed.
 *
 * **The daemon's connection is a first-class state here, and the live channel's is not.** They are
 * different sizes of problem. A dropped hint channel means the page is briefly behind and will catch
 * up, so it gets a quiet inline marker. A dropped daemon control socket takes the file browser, every
 * terminal and the whole agent surface down with it — the reverse tunnel made that socket
 * load-bearing for the container proxy — and without a sentence here the only symptom is a wall of
 * identical 502s in seven panels.
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

  /** The repository's default branch — what decides the door. */
  readonly mainBranch = input.required<string>();

  /** What the container proxy last said about the daemon. */
  readonly reachability = input<WorkspaceDaemonReachability>('unknown');

  /** Whether the hint channel is up. False draws the quiet stale-data marker. */
  readonly live = input(true);

  /** Something changed on the server. The page re-reads. */
  readonly changed = output<void>();

  /** A container verb answered with a process id — the Starting tab attaches to it at once. */
  readonly started = output<string>();

  private readonly api = inject(RefinementsApi);

  protected readonly pending = signal<Pending>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly runtimeTone = computed<QitsBadgeTone>(
    () => RUNTIME_TONES[this.workspace().runtimeStatus ?? ''] ?? 'neutral',
  );

  protected readonly runtimeLabel = computed(
    () => this.workspace().runtimeStatus?.toLowerCase() ?? 'runtime unknown',
  );

  protected readonly running = computed(() => this.workspace().runtimeStatus === 'RUNNING');

  protected readonly drift = computed(() => {
    const workspace = this.workspace();
    return driftLabel(workspace.ahead, workspace.behind);
  });

  /**
   * Clean, dirty, or unknown — and unknown is drawn as unknown.
   *
   * qits-workspaces answers null when no live daemon told it, and a null rendered as "clean" would
   * be the strip's one outright lie — on the field that gates the recreate.
   */
  protected readonly cleanliness = computed(() => {
    const clean = this.workspace().clean;
    if (clean === null) {
      return { label: 'working tree unknown', tone: 'neutral' as QitsBadgeTone };
    }
    return clean
      ? { label: 'clean', tone: 'success' as QitsBadgeTone }
      : { label: 'uncommitted changes', tone: 'warning' as QitsBadgeTone };
  });

  protected readonly daemonState = computed<DaemonState>(() => {
    const workspace = this.workspace();
    if (workspace.runtimeStatus !== 'RUNNING') {
      return 'not-running';
    }
    if (this.reachability() === 'unreachable' || !workspace.daemonConnectedAt) {
      return 'gone';
    }
    return 'connected';
  });

  protected readonly daemonSince = computed(() => {
    const at = this.workspace().daemonConnectedAt;
    return at ? relativeSince(at) : '';
  });

  /** The recreate guard, as one sentence or null when there is nothing to explain. */
  protected readonly recreateBlocked = computed<string | null>(() => {
    const clean = this.workspace().clean;
    if (clean === true) {
      return null;
    }
    return clean === false
      ? 'Recreate needs a clean working tree — this one has uncommitted changes, and recreating would throw them away.'
      : 'Recreate needs a working tree the service can prove is clean. Nothing is reporting one here, so it is refused rather than risked.';
  });

  protected async start(): Promise<void> {
    await this.run('start', async () => {
      const answer = await this.api.ensureContainer(this.workspace().id);
      if (answer.technicalProcessId) {
        this.started.emit(answer.technicalProcessId);
      }
    });
  }

  protected async stop(): Promise<void> {
    await this.run('stop', () => this.api.stopContainer(this.workspace().id));
  }

  protected async recreate(): Promise<void> {
    await this.run('recreate', async () => {
      const answer = await this.api.recreateContainer(this.workspace().id);
      if (answer.technicalProcessId) {
        this.started.emit(answer.technicalProcessId);
      }
    });
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
