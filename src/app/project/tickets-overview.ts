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
import type { TicketAgentDispatchDto } from '../api/dto';
import { EntitiesApi } from '../api/entities-api';
import { ProjectEvents } from '../api/project-events';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { EntityActions } from './entity-actions';
import { EntityCard } from './entity-card';
import { EntitySummaryRow } from './entity-summary-row';
import { EntityTransitionPanel } from './entity-transition-panel';
import {
  entityAnchor,
  groupTickets,
  type Entity,
  type EntityAction,
  type TicketEntity,
} from './entities-model';

/** Why the last dispatch on one ticket did not happen, kept beside the ticket it is about. */
interface Failure {
  readonly id: string;
  readonly message: string;
}

/**
 * A project's tickets: **what is still outstanding, in lifecycle order, and what is done.**
 *
 * <p><b>A view over the project's entities, filtered to one archetype</b> — the epics desk's twin,
 * and now literally so. Same {@link EntitiesApi}, same {@link Entity} type, same card, row and action
 * components; what makes it the tickets desk is the archetype it asks for and the two sections
 * {@link groupTickets} splits the answer into. The two desks keep their own routes and their own
 * presence, and they stopped being backed by two models to do it.
 *
 * <p><b>One fetch, and still exactly one.</b> The archetype is passed to the read, so this desk asks
 * for the tickets and pays for the tickets — it does not pay for the epics' fan-out because the
 * collection is a shared *shape*, not a shared eager read.
 *
 * <p><b>One read, grouped, rather than one read per section.</b> The service will filter by status,
 * but two reads would be two moments — long enough for a ticket moved between them to be in both
 * sections or in neither. `groupTickets` splits the one answer, which is the same rule the epics
 * overview is built on and for the same reason.
 *
 * <p><b>Two sections for five statuses, and the outstanding one reads as a pipeline.</b> A heading
 * per status would be five boxes with a row or two in each; the split a reader needs is whether
 * anything is still owed. So outstanding is everything but `DONE`, ordered reported → refined →
 * implemented → verified, which puts the unrefined work at the top where it is being picked up from
 * and the nearly-closed work at the bottom.
 *
 * <p><b>Outstanding is cards and done is rows.</b> The two sections are read for different things:
 * the outstanding ones are being chosen between, so each carries its description and both badges;
 * the done ones are a record somebody occasionally looks something up in, so they are a scannable
 * list with a link. Drawing the archive as fully as the work would bury the work under it.
 *
 * <p><b>Only the outstanding cards carry an action row.</b> A closed ticket is offered nothing —
 * that is {@link actionsFor}'s answer for a `DONE` ticket rather than this template's, because
 * offering to put an agent on something a person has already closed would be offering to reopen it
 * sideways, and that is a rule about tickets rather than about this screen.
 *
 * <p><b>A dispatch is not re-read, and the memory of one is now only the fast path.</b> The door
 * writes a comment and fires the `tickets` topic, so the list refreshes itself and a manual reload
 * here would be a second read of the same change. What a press answered is still kept in memory,
 * because it lands before the refreshed list does — but it is no longer the only record: each ticket
 * carries the **live workspaces working on it**, derived by the service on every read, so a reload
 * and a second tab both show the way in and neither offers a second agent.
 *
 * <p><b>Done opens collapsed and only when there is something in it.</b> A project that has never
 * closed a ticket should not carry an empty disclosure explaining that; a project with two hundred
 * should not open with them. Outstanding is always there, because "nothing is outstanding" is a fact
 * worth stating out loud.
 *
 * <p><b>It listens as well as reads.</b> Another tab, another person, or this application's own
 * ticket page changes these rows without this screen doing anything, so the project's live channel
 * hints on `tickets` and the panel re-reads. The hint carries nothing, which is the point: there is
 * no pushed shape to reconcile, and one topic covers the comments as well as the rows.
 *
 * <p><b>A hint's refresh is quiet.</b> Only an arrival, a project hop and the retry show the loading
 * state; a hint swaps the list underneath the reader when it lands, and leaves it standing when the
 * read fails. What is on screen is a moment old, not unknown — and taking the list away to report
 * one bad round trip would be reporting a problem by causing a worse one.
 *
 * <p>The read is keyed on the project id in an effect, because the sub-navigation re-uses this
 * instance across a project hop, and **a late answer is dropped** rather than rendered: a hop can
 * land while an older read is still in flight, and the last response to arrive is not the one the
 * route is on.
 */
@Component({
  selector: 'app-tickets-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, EntityActions, EntityCard, EntitySummaryRow, EntityTransitionPanel],
  template: `
    @if (behind()) {
      <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
    }

    <app-async
      [state]="tickets()"
      loadingLabel="Loading the tickets"
      errorLabel="Could not load the tickets"
      (retry)="load()"
    />

    @if (loaded()) {
      @if (entities().length === 0) {
        <app-empty message="This project has no tickets yet." />
      } @else {
        <section class="group">
          <h3>Outstanding</h3>
          @if (groups().outstanding.length === 0) {
            <app-empty message="No ticket is outstanding." />
          } @else {
            <div class="cards">
              @for (entity of groups().outstanding; track entity.id) {
                <div class="entry" [id]="anchor(entity)">
                  <app-entity-card [entity]="entity" [projectSlug]="linkSlug()" />
                  <app-entity-actions
                    [entity]="entity"
                    [disabled]="inFlight() !== null"
                    [running]="running(entity)"
                    [error]="error(entity)"
                    [dispatch]="dispatch(entity)"
                    (chosen)="choose(entity, $event)"
                  />
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
          }
        </section>

        @if (groups().done.length > 0) {
          <details class="group">
            <summary>Done ({{ groups().done.length }})</summary>
            <div class="rows">
              @for (entity of groups().done; track entity.id) {
                <app-entity-summary-row
                  [id]="anchor(entity)"
                  [entity]="entity"
                  [projectSlug]="linkSlug()"
                />
              }
            </div>
          </details>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    /* The channel marker is the panel's own line, above every group: it is about the whole list
       rather than about one of the sections. */
    .behind {
      margin: 0 0 0.5rem;
      color: #6b7280;
      font-size: 0.8rem;
      font-style: italic;
    }
    h3 {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .group {
      margin-top: 1rem;
    }
    summary {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    details .rows {
      margin-top: 0.5rem;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
  `,
})
export class TicketsOverview {
  private readonly api = inject(EntitiesApi);
  private readonly events = inject(ProjectEvents);

  readonly projectId = input.required<string>();

  /**
   * The project's slug — what a link out of this overview is spelled with, since the URL grammar
   * names projects by slug and only the API resolves ids.
   *
   * Optional, falling back to the id, so a caller that has not resolved the slug yet still produces
   * a working address: this application redirects an id in the first segment to the slug.
   */
  readonly projectSlug = input<string>('');

  protected readonly tickets = signal<Loadable<readonly Entity[]>>(LOADING);

  /** Which ticket a dispatch is running against, or null. One at a time, as the epics panel has it. */
  protected readonly inFlight = signal<string | null>(null);

  protected readonly failure = signal<Failure | null>(null);

  /**
   * Which ticket has its reshape form open, or null — one at a time, keyed by id.
   *
   * <p>Not part of {@link inFlight}, because opening the form sends nothing: the rest of the desk
   * stays live, and a reader who opened the wrong card presses Cancel. Everything about the write
   * belongs to the panel, so this desk learns no transition rule — it holds an id and re-reads.
   */
  protected readonly reshaping = signal<string | null>(null);

  /**
   * Where a press sent an agent, by ticket id — the only record there is, and it lives no longer
   * than this component. See the class note on why nothing re-reads it.
   */
  private readonly dispatches = signal<ReadonlyMap<string, TicketAgentDispatchDto>>(new Map());

  protected readonly loaded = computed(() => this.tickets().kind === 'ready');

  protected readonly entities = computed<readonly Entity[]>(() => {
    const state = this.tickets();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly groups = computed(() => groupTickets(this.entities()));

  /** What the links are spelled with: the slug where there is one, the id until then. */
  protected readonly linkSlug = computed(() => this.projectSlug() || this.projectId());

  /** Whether the channel has ever been up. Nothing is "behind" before it has ever been current. */
  private readonly wasLive = signal(false);

  /**
   * Whether to say the panel is lagging. It stays quiet on a page that never had a channel at all —
   * an SSE endpoint an older service does not serve is not a reader's problem.
   */
  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  /** Which project the last run of the read effect was for, so a hop is told apart from a hint. */
  private watching: string | null = null;

  /** The hint count that run had seen. The number itself means nothing; only its movement does. */
  private hinted = 0;

  /** How many reads have started. A read that is no longer the newest is dropped when it lands. */
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const hints = this.events.invalidations('tickets')();
      if (!projectId) {
        return;
      }
      // Arrival and a project hop show the loading state. A hint on the project already on screen
      // never does — that is the whole difference between the two ways this effect runs.
      const quiet = projectId === this.watching && hints !== this.hinted;
      this.watching = projectId;
      this.hinted = hints;
      untracked(() => {
        this.events.connect(projectId);
        void this.load(projectId, quiet);
      });
    });

    effect(() => {
      if (this.events.connected()) {
        this.wasLive.set(true);
      }
    });

    inject(DestroyRef).onDestroy(() => this.events.close());
  }

  protected anchor(entity: Entity): string {
    return entityAnchor(entity.archetype, entity.id);
  }

  protected running(entity: Entity): string | null {
    return this.inFlight() === entity.id ? 'assign' : null;
  }

  protected error(entity: Entity): string | null {
    const failure = this.failure();
    return failure?.id === entity.id ? failure.message : null;
  }

  protected dispatch(entity: Entity): TicketAgentDispatchDto | null {
    return this.dispatches().get(entity.id) ?? null;
  }

  /**
   * Do what the button asked for. A ticket has one move, so this is one branch — and it is still
   * written as a branch on the action's discriminant rather than as an unconditional call, because
   * the row it is wired to is the row the epics desk uses and what it emits is an
   * {@link EntityAction}.
   */
  protected async choose(entity: TicketEntity, action: EntityAction): Promise<void> {
    if (action.kind === 'assign') {
      await this.assign(entity);
    } else if (action.kind === 'reshape') {
      // It opens a form and sends nothing, so it takes no busy state and clears no failure.
      this.reshaping.set(entity.id);
    }
  }

  /**
   * A reshape landed: close the form and read the project again.
   *
   * <p>The one write on this desk that **is** re-read here. A dispatch is left to the live channel
   * because the door fires the project's `tickets` hint itself; the transition door moves rows of
   * every archetype at once and makes no such promise about this desk's topic — and what it changed
   * may be that the ticket is no longer a ticket, which is a row this list must stop drawing.
   */
  protected reshaped(): void {
    this.reshaping.set(null);
    void this.load();
  }

  /**
   * Put a workspace and an agent on this ticket, and keep where they went.
   *
   * <p><b>Nothing is re-read afterwards.</b> The door comments on the ticket and fires the project's
   * `tickets` topic, so the panel's own live channel brings the new list in — asking for it here as
   * well would be two reads of one change, and the second would land first as often as not.
   */
  private async assign(entity: TicketEntity): Promise<void> {
    const id = entity.id;
    this.inFlight.set(id);
    this.failure.set(null);
    try {
      const dispatch = await this.api.dispatchAgent(id);
      this.dispatches.update((known) => new Map(known).set(id, dispatch));
    } catch (error) {
      this.failure.set({ id, message: describeError(error) });
    } finally {
      this.inFlight.set(null);
    }
  }

  /**
   * Read the project's tickets.
   *
   * A loud read blanks what is on screen first — arrival, a project hop, the retry, a create. A
   * quiet one leaves the list up and swaps it when the new one arrives, and leaves it up when the
   * new one does not: see the class note on why a hint's failed refresh must not empty the screen.
   */
  async load(projectId = this.projectId(), quiet = false): Promise<void> {
    if (!quiet) {
      this.tickets.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const rows = await this.api.list(projectId, 'TICKET');
      if (this.newest(projectId, attempt)) {
        this.tickets.set(ready(rows));
      }
    } catch (error) {
      if (this.newest(projectId, attempt) && !(quiet && this.loaded())) {
        this.tickets.set(failed(error));
      }
    }
  }

  /**
   * Whether an answer that has just landed is still the one the panel is waiting for.
   *
   * Two ways it is not. The project may have moved on — a hop lands easily while an older read is
   * still in flight. Or a newer read may have started for the *same* project: hints arrive while
   * somebody works, and an older list overwriting a newer one would put the panel a step behind and
   * keep it there until the next hint.
   */
  private newest(projectId: string, attempt: number): boolean {
    return attempt === this.attempt && projectId === this.projectId();
  }
}
