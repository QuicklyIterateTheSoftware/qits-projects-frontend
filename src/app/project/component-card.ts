import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { normalizeArchetype, type RepositoryDto } from '../api/dto';
import { NONE, cloneUrl, repositoryLabel } from '../ui/format';

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
        <qits-badge [label]="archetype()" tone="neutral" />
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

  protected readonly none = NONE;

  protected readonly label = computed(() => repositoryLabel(this.repository()));

  protected readonly archetype = computed(() => normalizeArchetype(this.repository().archetype));

  /** The git host's name-addressed route, built from the browser's own origin. */
  protected readonly clone = computed(() => {
    const repository = this.repository();
    return cloneUrl(
      this.document.location?.origin ?? '',
      repository.projectId,
      repository.name || repository.id,
    );
  });

  /** The twin the platform syncs to, or nothing — an absence, not an explanation. */
  protected readonly backup = computed(() => this.repository().backupUrl ?? NONE);
}
