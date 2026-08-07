import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { normalizeArchetype, type RepositoryDto } from '../api/dto';
import { NONE, repositoryLabel } from '../ui/format';

/**
 * One component repository: what it is called, what it is, where it came from, and what its main
 * branch is.
 *
 * <p><b>It links nowhere, and that is the point.</b> There is no repository detail page yet, so a
 * card that looked clickable would be a promise this build cannot keep — and a dead link is worse
 * than no link. The url is shown as text rather than as an anchor for the same reason: the platform
 * git host's address is not something a browser tab can usefully open.
 *
 * The archetype badge shows the **normalised** value, so a row still stamped `INTEGRATION` reads
 * `LIBRARY` — the same word the group heading above it uses, and the same one the wrapper directory
 * means.
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
        <dt>Origin</dt>
        <dd class="url">{{ origin() }}</dd>
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
  readonly repository = input.required<RepositoryDto>();

  protected readonly none = NONE;

  protected readonly label = computed(() => repositoryLabel(this.repository()));

  protected readonly archetype = computed(() => normalizeArchetype(this.repository().archetype));

  /** A repository born blank on the platform git host has no origin to name, and says so. */
  protected readonly origin = computed(() => this.repository().url ?? 'this platform’s git host');
}
