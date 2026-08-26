import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks, QitsBadge, QitsButton, QitsCard } from '@qits/ui-components';
import { normalizeArchetype, type RepositoryDto } from '../api/dto';
import type { QitsBadgeTone } from '@qits/ui-components';
import { NONE, cloneUrl, formatInstant, formatRelativeTime, repositoryLabel } from '../ui/format';

/** What the backup badge says, and how loudly. `title` is the hover text; it may be empty. */
export interface BackupBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
  readonly title: string;
}

/**
 * The badge for one repository's last backup, or **nothing at all**.
 *
 * <p>Nothing is the right answer for a repository with no backup remote: it is not behind, it is
 * not failing, and there is nothing to fix — a badge saying "never backed up" on a repository
 * nobody asked to back up would be an invented problem. That is the one case where silence beats a
 * label, and it is why this returns null rather than a neutral badge.
 *
 * <p><b>`AUTH_REQUIRED` is the only outcome the reader can act on</b>, so it says what to do —
 * "sign-in needed" — where the other two failures say what happened. Both of those carry the
 * server's `detail` as hover text rather than on the badge, because a badge is a word and a reason
 * is a sentence.
 */
export function backupBadge(
  repository: Pick<RepositoryDto, 'backupUrl' | 'lastBackup'>,
  nowMs: number = Date.now(),
): BackupBadge | null {
  if (!repository.backupUrl) {
    return null;
  }
  const attempt = repository.lastBackup;
  if (!attempt) {
    return { label: 'never backed up', tone: 'neutral', title: '' };
  }
  const when = formatInstant(attempt.at);
  const detail = attempt.detail ? `${attempt.detail} (${when})` : when;
  switch (attempt.outcome) {
    case 'SUCCEEDED':
      return {
        label: `backed up ${formatRelativeTime(attempt.at, nowMs)}`,
        tone: 'success',
        title: detail,
      };
    case 'AUTH_REQUIRED':
      return { label: 'sign-in needed', tone: 'warning', title: detail };
    case 'UNREACHABLE':
      return { label: 'remote unreachable', tone: 'warning', title: detail };
    default:
      return { label: 'backup failed', tone: 'warning', title: detail };
  }
}

/**
 * One component repository: what it is called, what it is, where it is cloned from, where it is
 * backed up to, and what its main branch is.
 *
 * <p><b>Two urls, and they are not two spellings of one.</b> The card used to draw a single
 * "Origin", which was the old `url` field, and it was wrong twice over: it named a *backup* as the
 * place the code comes from, and it drew a GitHub address on some cards and the sentence "this
 * platform's git host" on others — so the same fact appeared in two forms and neither was the
 * clone address. **Clone** is composed and therefore uniform on every card, because a platform
 * clone always comes from the platform's own git host. **Backup** is the twin the platform pushes
 * to automatically, and it is the only per-repository url there is.
 *
 * <p>A missing backup draws the em dash rather than prose. After release C's reconcile has healed
 * the rows there should be none, and a sentence explaining an absence that is not supposed to exist
 * would outlive the absence.
 *
 * <p><b>It links nowhere, and that is the point.</b> There is no repository detail page yet, so a
 * card that looked clickable would be a promise this build cannot keep — and a dead link is worse
 * than no link. The urls are text for the same reason: a git address is not something a browser tab
 * can usefully open.
 *
 * <p><b>One action, and only on a card the project's configuration does not name.</b> A repository
 * the wrapper declares is a member, and there is nothing to decide about it here. A row nothing
 * declares is the reader's decision — put the entry back, or delete the repository — so that card
 * carries the badge that states the problem and the button that is one of the two ways out.
 *
 * <p>The button asks twice and requests nothing. **Twice**, because a delete takes the repository
 * off the git host as well as the row, and once is a stray click; the second press is asked for in
 * the label rather than in a dialog, which is how every destructive move in this app asks. And
 * **nothing**, because the page owns the read this delete invalidates: it makes the request, holds
 * the busy state and the failure, and reads the list again.
 */
@Component({
  selector: 'app-component-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsButton, QitsCard],
  template: `
    <qits-card>
      <div class="head">
        <span class="name">{{ label() }}</span>
        <span class="badges">
          @if (!declared()) {
            <span title="No wrapper entry names this repository, so it is not part of the project."
              ><qits-badge label="not in wrapper" tone="warning"
            /></span>
          }
          @if (backupState(); as backup) {
            <span [title]="backup.title"
              ><qits-badge [label]="backup.label" [tone]="backup.tone"
            /></span>
          }
          <qits-badge [label]="archetype()" tone="neutral" />
          @if (!declared()) {
            <qits-button variant="ghost" size="sm" [busy]="deleting()" (pressed)="press()">
              {{ pending() ? 'Confirm delete?' : 'Delete' }}
            </qits-button>
          }
        </span>
      </div>
      <dl class="facts">
        <dt>Clone</dt>
        <dd class="url">{{ clone() }}</dd>
        <dt>Backup</dt>
        <dd class="url">{{ backup() }}</dd>
        <dt>Main branch</dt>
        <dd>{{ repository().mainBranch || none }}</dd>
      </dl>
      @if (error(); as message) {
        <p class="failed" role="alert">Could not delete this repository — {{ message }}.</p>
      }
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .badges {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.15rem 0.6rem;
      margin: 0.5rem 0 0;
      font-size: 0.85rem;
    }
    .facts dt {
      color: #6b7280;
    }
    .facts dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .url {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .failed {
      margin: 0.5rem 0 0;
      color: #b91c1c;
      font-size: 0.85rem;
    }
  `,
})
export class ComponentCard {
  private readonly document = inject(DOCUMENT);
  private readonly appLinks = inject(QitsAppLinks);

  readonly repository = input.required<RepositoryDto>();

  /**
   * The project's slug — the public spelling of the clone url's first segment.
   *
   * Optional, and empty falls back to `repository.projectId`: the slug arrives with the project
   * list, which is a second read, and a card drawn before it answers still has to show an address
   * that works. qits-projects resolves the segment by id *or* slug, so the fallback is a correct
   * url and not a placeholder — just a less readable one.
   */
  readonly projectSlug = input<string>('');

  /**
   * Whether a wrapper entry names this repository. **True by default**, because that is what every
   * ordinary card is and a card told nothing should accuse nobody.
   */
  readonly declared = input(true);

  /** True while the page's delete for this repository is in flight. */
  readonly deleting = input(false);

  /** Why the last delete failed — the server's own sentence, on the card it is about. */
  readonly error = input<string | null>(null);

  /** A delete the reader has now asked for twice. The page makes the request. */
  readonly deleteRequested = output<void>();

  protected readonly none = NONE;

  /** True once Delete has been pressed once, so the next press is the confirmed one. */
  protected readonly pending = signal(false);

  protected readonly label = computed(() => repositoryLabel(this.repository()));

  protected readonly archetype = computed(() => normalizeArchetype(this.repository().archetype));

  /**
   * The git host's name-addressed route, spelled with the git host's own origin.
   *
   * The navigation names the authority that serves `/git`, so the address a reader copies is
   * `githost.<env>.<domain>/git/<slug>/<name>.git`. The environment origin is the fallback for a
   * platform naming no git host yet, and the browser's own for an app served without the platform
   * in front of it.
   */
  protected readonly clone = computed(() => {
    const repository = this.repository();
    const origin =
      this.appLinks.origin('qits-githost') ??
      this.appLinks.environmentOrigin() ??
      this.document.location?.origin ??
      '';
    return cloneUrl(
      origin,
      this.projectSlug() || repository.projectId,
      repository.name || repository.id,
    );
  });

  /** The twin the platform syncs to, or nothing — an absence, not an explanation. */
  protected readonly backup = computed(() => this.repository().backupUrl ?? NONE);

  /** How the last backup went, or null for a repository nobody asked to back up. */
  protected readonly backupState = computed(() => backupBadge(this.repository()));

  protected press(): void {
    if (!this.pending()) {
      this.pending.set(true);
      return;
    }
    this.pending.set(false);
    this.deleteRequested.emit();
  }
}
