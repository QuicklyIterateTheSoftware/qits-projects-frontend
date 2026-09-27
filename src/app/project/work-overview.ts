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
import { QitsButton } from '@qits/ui-components';
import { ArchetypesApi, type ArchetypeRegistry } from '../api/archetypes-api';
import { EntitiesApi } from '../api/entities-api';
import { ProjectEvents } from '../api/project-events';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { EntityCard } from './entity-card';
import { EntitySummaryRow } from './entity-summary-row';
import { EntityTransitionPanel } from './entity-transition-panel';
import { groupByStatus, statusVocabulary, type Entity } from './entities-model';
import { archetypeLabel } from './entity-nodes';
import { WorkspaceLinks } from './workspace-links';

/** What one read brings back: the entities, and the vocabulary their sections are ordered by. */
interface Desk {
  readonly entities: readonly Entity[];
  readonly registry: ArchetypeRegistry;
}

/**
 * **The one desk's body** — every entity of the project, or of one archetype, grouped by status.
 *
 * <p>This replaces the epics desk and the tickets desk (ticket 521a0bda, qits-397), which were two
 * views over one collection with two parallel groupings: five epic sections keyed on words qits-392
 * deleted, and an outstanding/closed split for tickets. One lifecycle now covers both, so one spine
 * does too: a section per status, in the **served registry's** order, the two endings collapsed. The
 * archetype is a filter on the one read — `archetype` in, one archetype's rows out — and never a
 * second page.
 *
 * <p><b>One read per filter, no more.</b> A filter naming an archetype asks for exactly that
 * archetype ({@link EntitiesApi.list} reads one endpoint), so the tickets view does not pay for the
 * epic tree's fan-out; no filter reads both, in parallel.
 *
 * <p><b>It listens as well as reads.</b> An agent, or another tab, changes these rows without this
 * page doing anything: both the `epics` and the `tickets` topics re-read it, quietly — a hint never
 * blanks the desk, and a failed quiet re-read leaves the rows standing.
 *
 * <p><b>The only press on a row is Reshape</b> (promote, demote, reparent — the multi-entity
 * transition, through {@link EntityTransitionPanel}). Dispatch, Run the next phase and Refine are on
 * the entity's page, where the dispatch state is read before they are offered; a desk that asked that
 * state of every row would be a request per row.
 */
@Component({
  selector: 'app-work-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Async,
    Empty,
    EntityCard,
    EntitySummaryRow,
    EntityTransitionPanel,
    QitsButton,
    WorkspaceLinks,
  ],
  template: `
    @if (behind()) {
      <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
    }

    <app-async
      [state]="desk()"
      loadingLabel="Loading the work"
      errorLabel="Could not load the work"
      (retry)="load()"
    />

    @if (loaded()) {
      @if (entities().length === 0) {
        <app-empty [message]="emptyMessage()" />
      } @else {
        @for (group of groups(); track group.status) {
          @if (group.archive) {
            <details class="group" [attr.data-status]="group.status">
              <summary>{{ group.badge.label }} ({{ group.entities.length }})</summary>
              <div class="rows">
                @for (entity of group.entities; track entity.id) {
                  <app-entity-summary-row
                    [entity]="entity"
                    [projectSlug]="linkSlug()"
                    [successor]="successorOf(entity)"
                  />
                }
              </div>
            </details>
          } @else {
            <section class="group" [attr.data-status]="group.status">
              <h3>{{ group.badge.label }} ({{ group.entities.length }})</h3>
              <div class="cards">
                @for (entity of group.entities; track entity.id) {
                  <div class="entry">
                    <app-entity-card [entity]="entity" [projectSlug]="linkSlug()" />
                    <div class="actions">
                      <qits-button variant="ghost" size="sm" (pressed)="reshaping.set(entity.id)">
                        Reshape
                      </qits-button>
                      <app-workspace-links [workspaces]="entity.workspaces" />
                    </div>
                    @if (reshaping() === entity.id) {
                      <app-entity-transition-panel
                        [projectId]="projectId()"
                        [entityId]="entity.id"
                        (done)="reshaped()"
                        (cancelled)="reshaping.set(null)"
                      />
                    }
                  </div>
                }
              </div>
            </section>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    .behind {
      margin: 0 0 0.5rem;
      color: #6b7280;
      font-size: 0.8rem;
      font-style: italic;
    }
    h3,
    summary {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
      text-transform: capitalize;
    }
    summary {
      cursor: pointer;
    }
    .group {
      margin-top: 1rem;
    }
    details .rows {
      margin-top: 0.5rem;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.4rem;
    }
  `,
})
export class WorkOverview {
  private readonly api = inject(EntitiesApi);
  private readonly archetypes = inject(ArchetypesApi);
  private readonly events = inject(ProjectEvents);

  readonly projectId = input.required<string>();

  /** The project's slug, which every link is spelled with. Falls back to the id until it resolves. */
  readonly projectSlug = input<string>('');

  /** The archetype filter (`EPIC`, `TICKET`, …), or null for every archetype. */
  readonly archetype = input<string | null>(null);

  protected readonly desk = signal<Loadable<Desk>>(LOADING);

  /** Which entity has its reshape form open, or null — one at a time. Opening it sends nothing. */
  protected readonly reshaping = signal<string | null>(null);

  protected readonly loaded = computed(() => this.desk().kind === 'ready');

  protected readonly entities = computed<readonly Entity[]>(() => {
    const state = this.desk();
    if (state.kind !== 'ready') {
      return [];
    }
    const archetype = this.archetype();
    return archetype
      ? state.value.entities.filter((entity) => entity.archetype === archetype)
      : state.value.entities;
  });

  protected readonly groups = computed(() => {
    const state = this.desk();
    const vocabulary = state.kind === 'ready' ? statusVocabulary(state.value.registry) : [];
    return groupByStatus(this.entities(), vocabulary);
  });

  protected readonly linkSlug = computed(() => this.projectSlug() || this.projectId());

  protected readonly emptyMessage = computed(() => {
    const archetype = this.archetype();
    return archetype
      ? `This project has no ${archetypeLabel(archetype)}s yet.`
      : 'This project has no epics or tickets yet.';
  });

  private readonly byId = computed(
    () => new Map(this.entities().map((entity) => [entity.id, entity] as const)),
  );

  private readonly wasLive = signal(false);

  /** Whether to say the desk is lagging — only once the channel has been up at least once. */
  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  /** Which project-and-filter the last read was for, so a hop is told apart from a hint. */
  private watching: string | null = null;
  private hinted = 0;
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const archetype = this.archetype();
      const hints = this.events.invalidations('epics')() + this.events.invalidations('tickets')();
      if (!projectId) {
        return;
      }
      const key = `${projectId}/${archetype ?? ''}`;
      // Arrival, a project hop and a filter change show the loading state; a hint never does.
      const quiet = key === this.watching && hints !== this.hinted;
      this.watching = key;
      this.hinted = hints;
      untracked(() => {
        this.events.connect(projectId);
        void this.load(quiet);
      });
    });

    effect(() => {
      if (this.events.connected()) {
        this.wasLive.set(true);
      }
    });

    inject(DestroyRef).onDestroy(() => this.events.close());
  }

  /** The epic that superseded this one, when the desk holds it. */
  protected successorOf(entity: Entity): Entity | null {
    const id = entity.archetype === 'EPIC' ? entity.supersededByEpicId : null;
    return id ? (this.byId().get(id) ?? null) : null;
  }

  /** A reshape landed: close the form and read the desk again — the shape of the tree moved. */
  protected reshaped(): void {
    this.reshaping.set(null);
    void this.load();
  }

  /**
   * Read the desk. A loud read blanks it first (arrival, a hop, a filter change, the retry, a create);
   * a quiet one swaps the rows when they land and keeps them when the read fails.
   */
  async load(quiet = false): Promise<void> {
    const projectId = this.projectId();
    const archetype = this.archetype();
    if (!quiet) {
      this.desk.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const [entities, registry] = await Promise.all([
        this.api.list(
          projectId,
          archetype === 'EPIC' || archetype === 'TICKET' ? archetype : undefined,
        ),
        this.archetypes.registry(),
      ]);
      if (this.newest(projectId, attempt)) {
        this.desk.set(ready({ entities, registry }));
      }
    } catch (error) {
      if (this.newest(projectId, attempt) && !(quiet && this.loaded())) {
        this.desk.set(failed(error));
      }
    }
  }

  private newest(projectId: string, attempt: number): boolean {
    return attempt === this.attempt && projectId === this.projectId();
  }
}
