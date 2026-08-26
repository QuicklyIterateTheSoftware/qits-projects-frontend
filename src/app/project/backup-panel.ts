import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsButton, QitsCard } from '@qits/ui-components';
import type { BackupSyncResponse, RepositoryDto } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { RemoteLoginTerminal } from './remote-login-terminal';

/**
 * How long to wait before re-reading, after a sync has been accepted.
 *
 * The push happens after the 202, so there is no answer to wait for — only a guess about when one
 * will exist. Three seconds is long enough for a small repository's push to land and short enough
 * that the reader has not looked away. It is a **single** refresh, not a poll: a page that kept
 * asking would spend the rest of its life doing so for outcomes that may take a minute, and the
 * manual refresh beside it is the honest way to ask again.
 */
export const BACKUP_REFRESH_DELAY_MS = 3000;

/**
 * The project's backups: whether they are working, how to run them, and how to fix them.
 *
 * <p><b>Project-wide rather than per repository, and that is a deliberate narrowing.</b> The
 * credential store the platform pushes with is shared, so the failure these controls exist for —
 * `AUTH_REQUIRED` — is never one repository's problem: it is the whole project's, and one sign-in
 * clears all of it. A per-row sync button would be a second way to do the same thing on a smaller
 * scale, and `ComponentCard` carries exactly one action — the delete a repository nothing declares
 * needs, which has no project-wide form. The per-repository sync endpoint exists on the server;
 * nothing here needs it yet.
 *
 * <p>The sign-in runs against the **project repository**, because that is the one repository every
 * project has. What it authenticates is the host, not the repository — so any of them would do.
 */
@Component({
  selector: 'app-backup-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, QitsCard, RemoteLoginTerminal],
  template: `
    <qits-card heading="Backups">
      <p class="summary">{{ summary() }}</p>

      @if (needsSignIn()) {
        <p class="prompt" role="status">
          The backup remote refused the platform's credentials. Sign in once and every repository's
          backup starts working again.
        </p>
      }

      <div class="actions">
        <qits-button
          variant="primary"
          size="sm"
          [disabled]="backedUpCount() === 0"
          [busy]="sync().kind === 'loading'"
          (pressed)="runSync()"
        >
          Sync backups
        </qits-button>

        @if (signInRepoId()) {
          <qits-button
            [variant]="needsSignIn() ? 'primary' : 'ghost'"
            size="sm"
            [disabled]="terminalOpen()"
            (pressed)="openTerminal()"
          >
            Sign in to backup remote
          </qits-button>
        }

        <qits-button variant="ghost" size="sm" (pressed)="changed.emit()">Refresh</qits-button>
      </div>

      @if (sync().kind === 'error') {
        <p class="failed" role="alert">Could not schedule the backups — {{ syncMessage() }}.</p>
      }
      @if (scheduled(); as result) {
        <p class="note" role="status">
          Scheduled {{ result.scheduled }} repositor{{ result.scheduled === 1 ? 'y' : 'ies' }}. The
          pushes run in the background; this list refreshes once in a moment, and the Refresh button
          asks again.
        </p>
      }

      @if (terminalOpen()) {
        <app-remote-login-terminal [repoId]="signInRepoId()!" (closed)="onTerminalClosed()" />
      }
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 1rem;
    }
    .summary,
    .prompt,
    .note {
      margin: 0.4rem 0 0;
      font-size: 0.9rem;
      color: #374151;
    }
    .prompt {
      color: #92400e;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.6rem;
    }
    .failed {
      margin: 0.4rem 0 0;
      color: #b91c1c;
      font-size: 0.9rem;
    }
  `,
})
export class BackupPanel {
  private readonly api = inject(ProjectsApi);

  readonly projectId = input.required<string>();
  readonly repositories = input.required<readonly RepositoryDto[]>();

  /** The project repository, which is what the sign-in terminal drives. Null when there is none. */
  readonly projectRepositoryId = input.required<string | null>();

  /** Something happened that the list should be re-read for. */
  readonly changed = output<void>();

  protected readonly sync = signal<Loadable<BackupSyncResponse>>(IDLE);
  protected readonly terminalOpen = signal(false);

  private refreshHandle: ReturnType<typeof setTimeout> | null = null;

  /** Only repositories with a backup remote are backed up, so only they are counted. */
  protected readonly backedUpCount = computed(
    () => this.repositories().filter((repository) => repository.backupUrl).length,
  );

  protected readonly needsSignIn = computed(() =>
    this.repositories().some((repository) => repository.lastBackup?.outcome === 'AUTH_REQUIRED'),
  );

  /**
   * The repository the sign-in pushes through — and it must have a backup remote of its own, since
   * the server refuses to open a terminal for a repository with nothing to sign in to.
   */
  protected readonly signInRepoId = computed(() => {
    const id = this.projectRepositoryId();
    const row = this.repositories().find((repository) => repository.id === id);
    return row?.backupUrl ? row.id : null;
  });

  protected readonly scheduled = computed(() => {
    const state = this.sync();
    return state.kind === 'ready' ? state.value : undefined;
  });

  protected readonly syncMessage = computed(() => {
    const state = this.sync();
    return state.kind === 'error' ? state.message : '';
  });

  protected readonly summary = computed(() => {
    const total = this.backedUpCount();
    if (total === 0) {
      return 'No repository in this project has a backup remote, so there is nothing to push.';
    }
    const failing = this.repositories().filter(
      (repository) =>
        repository.backupUrl &&
        repository.lastBackup !== null &&
        repository.lastBackup.outcome !== 'SUCCEEDED',
    ).length;
    const never = this.repositories().filter(
      (repository) => repository.backupUrl && repository.lastBackup === null,
    ).length;
    const parts = [`${total} repositor${total === 1 ? 'y has' : 'ies have'} a backup remote`];
    if (failing > 0) {
      parts.push(`${failing} last failed`);
    }
    if (never > 0) {
      parts.push(`${never} never attempted`);
    }
    return `${parts.join(', ')}.`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelRefresh());
  }

  protected async runSync(): Promise<void> {
    this.sync.set(LOADING);
    try {
      this.sync.set(ready(await this.api.syncBackups(this.projectId())));
      this.scheduleRefresh();
    } catch (error) {
      this.sync.set(failed(error));
    }
  }

  protected openTerminal(): void {
    this.terminalOpen.set(true);
  }

  /**
   * The session ended — which says the terminal is gone, not that the sign-in worked.
   *
   * So both things happen: the list is re-read, and a sync is nudged. If the credentials did land,
   * that is what turns every `sign-in needed` badge back into a time; if they did not, the badges
   * come back unchanged, which is the honest answer.
   */
  protected onTerminalClosed(): void {
    this.terminalOpen.set(false);
    this.changed.emit();
    void this.runSync();
  }

  private scheduleRefresh(): void {
    this.cancelRefresh();
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = null;
      this.changed.emit();
    }, BACKUP_REFRESH_DELAY_MS);
  }

  private cancelRefresh(): void {
    if (this.refreshHandle !== null) {
      clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
  }
}
