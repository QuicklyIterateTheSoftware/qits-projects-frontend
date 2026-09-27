import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import { relativeSince } from '../ui/format';
import type { WorkItem } from './campaign-model';
import { statusBadge } from './entities-model';
import { archetypeLabel, entityAddress, entityRoute } from './entity-nodes';

/**
 * One line on the desk's collapsed sections — the record rather than the work: the entity's number,
 * its title, its archetype and status, and how long ago it was opened. Both the number and the title
 * link to the entity's page, `/<project>/work/<qualified id>`.
 *
 * <p>A superseded epic says so and links to its successor's page when the desk holds it — the
 * successor's number is resolved by the desk, which is the only one holding every entity.
 */
@Component({
  selector: 'app-entity-summary-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, RouterLink],
  template: `
    <a class="qualified" [routerLink]="route()">{{ address() }}</a>
    <a class="title" [routerLink]="route()">{{ entity().title }}</a>
    <qits-badge [label]="archetype()" tone="neutral" />
    <qits-badge [label]="badge().label" [tone]="badge().tone" />
    @if (successor(); as next) {
      <a class="successor" [routerLink]="successorRoute()">superseded by {{ next.title }}</a>
    }
    @if (age(); as opened) {
      <span class="age">{{ opened }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.4rem 0;
      border-top: 1px solid #e5e7eb;
      font-size: 0.85rem;
    }
    :host:first-of-type {
      border-top: 0;
    }
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .title,
    .successor {
      color: #1d4ed8;
      overflow-wrap: anywhere;
    }
    /* The age is pushed to the end, so the column scans down the row edges. */
    .age {
      margin-left: auto;
      color: #6b7280;
      font-size: 0.8rem;
    }
  `,
})
export class EntitySummaryRow {
  readonly entity = input.required<WorkItem>();

  /** The project's slug, which every address is spelled with. */
  readonly projectSlug = input<string>('');

  /** The epic that superseded this one, when the desk holds it; null draws nothing. */
  readonly successor = input<WorkItem | null>(null);

  protected readonly badge = computed(() => statusBadge(this.entity().status));
  protected readonly archetype = computed(() => archetypeLabel(this.entity().archetype));
  protected readonly address = computed(() => entityAddress(this.entity()));
  protected readonly route = computed(() => entityRoute(this.projectSlug(), this.entity()));
  /** Null where the read carries no timestamp (a campaign's listing). */
  protected readonly age = computed(() => {
    const at = this.entity().createdAt;
    return at ? relativeSince(at) : null;
  });

  protected readonly successorRoute = computed(() => {
    const next = this.successor();
    return next ? entityRoute(this.projectSlug(), next) : [];
  });
}
