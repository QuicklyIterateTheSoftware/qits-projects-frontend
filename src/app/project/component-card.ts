import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { QitsBadge, QitsCard } from '@qits/ui-components';
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
 */
@Component({
  selector: 'app-component-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsCard],
  template: `
    <qits-card>
      <div class="head">
        <span class="name">{{ label() }}</span>
        <span class="badges">
          @if (backupState(); as backup) {
            <span [title]="backup.title"
              ><qits-badge [label]="backup.label" [tone]="backup.tone"
            /></span>
          }
          <qits-badge [label]="archetype()" tone="neutral" />
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
  `,
})
export class ComponentCard {
  private readonly document = inject(DOCUMENT);

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

  protected readonly none = NONE;

  protected readonly label = computed(() => repositoryLabel(this.repository()));

  protected readonly archetype = computed(() => normalizeArchetype(this.repository().archetype));

  /** The git host's name-addressed route, built from the browser's own origin. */
  protected readonly clone = computed(() => {
    const repository = this.repository();
    return cloneUrl(
      this.document.location?.origin ?? '',
      this.projectSlug() || repository.projectId,
      repository.name || repository.id,
    );
  });

  /** The twin the platform syncs to, or nothing — an absence, not an explanation. */
  protected readonly backup = computed(() => this.repository().backupUrl ?? NONE);

  /** How the last backup went, or null for a repository nobody asked to back up. */
  protected readonly backupState = computed(() => backupBadge(this.repository()));
}
