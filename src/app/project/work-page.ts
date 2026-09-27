import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { ArchetypesApi } from '../api/archetypes-api';
import { ProjectParam } from '../nav/project-param';
import { RefinementPanel } from './agent/refinement-panel';
import {
  ARCHETYPE_PARAM,
  archetypeFilterParam,
  archetypeFromParam,
  archetypeLabel,
} from './entity-nodes';
import { NewTicketForm } from './new-ticket-form';
import { WorkOverview } from './work-overview';

/** One button of the archetype filter: what it says, and the query value it sets (null clears). */
interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly value: string | null;
}

/**
 * **The one desk** — `/<project>/work`: every epic and every ticket of the project on one page, with
 * the archetype as a filter on it (ticket 521a0bda, qits-397).
 *
 * <p>It replaces the epics page and the tickets page, which were two routes over one collection. The
 * filter is `?archetype=epic` / `?archetype=ticket` — a **query parameter**, because it is a view of
 * the one place and not a second place, and a link to a filtered desk is still a link to the desk.
 * The old addresses, `/<project>/epics` and `/<project>/tickets`, redirect here with the filter set.
 *
 * <p><b>The filter's options are read off the served registry</b>: every archetype that has a
 * lifecycle (a non-empty `legalStatuses`) is a root of work a desk lists; features and tasks are in
 * their epics' trees and are reached from there. Until the registry answers, the filter offers "All"
 * and whatever the address already names.
 *
 * <p><b>One front desk agent.</b> The refinement panel above the rows is the project's
 * conversation; its surface follows the filter — `project.tickets` (filing and triage) when the desk
 * is filtered to tickets, `project.epics` (drafting the plan) otherwise — mounted as two separate
 * instances so switching the filter never carries one surface's terminal onto the other's.
 */
@Component({
  selector: 'app-work-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NewTicketForm, RefinementPanel, RouterLink, WorkOverview],
  template: `
    <p class="back">
      <a [routerLink]="['/', projectSlug()]">← {{ heading() }}</a>
    </p>

    <h1>Work</h1>

    <nav class="filter" aria-label="Archetype">
      @for (option of options(); track option.key) {
        <a
          class="option"
          [class.selected]="option.value === selectedParam()"
          [attr.aria-current]="option.value === selectedParam() ? 'page' : null"
          [routerLink]="[]"
          [queryParams]="{ archetype: option.value }"
          queryParamsHandling="merge"
        >
          {{ option.label }}
        </a>
      }
    </nav>

    @if (archetype() === null || archetype() === 'TICKET') {
      <app-new-ticket-form [projectId]="projectId()" (created)="refresh()" />
    }

    @if (archetype() === 'TICKET') {
      <app-refinement-panel [projectId]="projectId()" surface="project.tickets" />
    } @else {
      <app-refinement-panel [projectId]="projectId()" surface="project.epics" />
    }

    <app-work-overview
      [projectId]="projectId()"
      [projectSlug]="projectSlug()"
      [archetype]="archetype()"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .filter {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      margin: 0 0 1rem;
    }
    .option {
      padding: 0.2rem 0.65rem;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      font-size: 0.85rem;
      color: #374151;
      text-decoration: none;
      text-transform: capitalize;
    }
    .option.selected {
      border-color: #1d4ed8;
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 600;
    }
  `,
})
export class WorkPage {
  private readonly param = inject(ProjectParam);
  private readonly route = inject(ActivatedRoute);
  private readonly archetypes = inject(ArchetypesApi);

  private readonly overview = viewChild(WorkOverview);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  /** The project's display name, once the shared list has answered. The address until then. */
  protected readonly heading = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value.name : this.param.segment();
  });

  /** The filter as the registry spells it — `EPIC`, `TICKET` — or null for every archetype. */
  protected readonly archetype = computed(() =>
    archetypeFromParam(this.query().get(ARCHETYPE_PARAM)),
  );

  /** The filter as the URL spells it, which is what the selected option is compared against. */
  protected readonly selectedParam = computed(() => {
    const archetype = this.archetype();
    return archetype ? archetypeFilterParam(archetype) : null;
  });

  /** The archetypes with a lifecycle, off the registry — see the class note. */
  private readonly served = signal<readonly string[]>([]);

  protected readonly options = computed<readonly FilterOption[]>(() => {
    const words = [...this.served()];
    const current = this.archetype();
    if (current && !words.includes(current)) {
      words.push(current);
    }
    return [
      { key: '', label: 'All', value: null },
      ...words.map((word) => ({
        key: word,
        label: `${archetypeLabel(word)}s`,
        value: archetypeFilterParam(word),
      })),
    ];
  });

  constructor() {
    void this.archetypes
      .registry()
      .then((registry) =>
        this.served.set(
          registry.archetypes
            .filter((spec) => spec.legalStatuses.length > 0)
            .map((spec) => spec.archetype),
        ),
      )
      .catch(() => undefined);
  }

  /** A ticket was opened: the desk re-reads. */
  protected refresh(): void {
    void this.overview()?.load();
  }
}
