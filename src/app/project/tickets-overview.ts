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
import type { TicketAgentDispatchDto, TicketDto } from '../api/dto';
import { ProjectEvents } from '../api/project-events';
import { TicketsApi } from '../api/tickets-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { TicketActions } from './ticket-actions';
import { TicketCard } from './ticket-card';
import { TicketSummaryRow } from './ticket-summary-row';
import { groupTickets, ticketAnchor } from './tickets-model';

/** Why the last dispatch on one ticket did not happen, kept beside the ticket it is about. */
interface Failure {
  readonly id: string;
  readonly message: string;
}

/**
 * A project's tickets, grouped into what is still asking for something and what is not.
 *
 * <p><b>One read, grouped, rather than one read per section.</b> The service will filter by status,
 * but two reads would be two moments — long enough for a ticket resolved between them to be in both
 * sections or in neither. `groupTickets` splits the one answer, which is the same rule the epics
 * overview is built on and for the same reason.
 *
 * <p><b>Open is cards and resolved is rows.</b> The two sections are read for different things: the
 * open ones are being chosen between, so each carries its description and both badges; the resolved
 * ones are a record somebody occasionally looks something up in, so they are a scannable list with a
 * link. Drawing the archive as fully as the work would bury the work under it.
 *
 * <p><b>Only the open cards carry an action row</b>, the same shape the epics overview mounts beside
 * its cards: a resolved ticket is terminal, and a terminal row draws no actions — offering to put an
 * agent on something already answered would be offering to reopen it sideways.
 *
 * <p><b>A dispatch is not re-read, and it is not remembered past this page.</b> The door writes a
 * comment and fires the `tickets` topic, so the list refreshes itself and a manual reload here would
 * be a second read of the same change. What it answers — which workspace the agent went to — is
 * kept in memory only, because the service stores no queryable dispatch on the ticket: after a
 * reload the link is gone and the way back is another press, which lands in the same workspace
 * because the door is find-or-create.
 *
 * <p><b>Resolved opens collapsed and only when there is something in it.</b> A project that has
 * never resolved a ticket should not carry an empty disclosure explaining that; a project with two
 * hundred should not open with them. Open is always there, because "nothing is open" is a fact worth
 * stating out loud.
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
  imports: [Async, Empty, TicketActions, TicketCard, TicketSummaryRow],
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
      @if (rows().length === 0) {
        <app-empty message="This project has no tickets yet." />
      } @else {
        <section class="group">
          <h3>Open</h3>
          @if (groups().open.length === 0) {
            <app-empty message="No ticket is open." />
          } @else {
            <div class="cards">
              @for (ticket of groups().open; track ticket.id) {
                <div class="entry" [id]="anchor(ticket)">
                  <app-ticket-card [ticket]="ticket" [projectSlug]="linkSlug()" />
                  <app-ticket-actions
                    [disabled]="inFlight() !== null"
                    [busy]="running(ticket)"
                    [error]="error(ticket)"
                    [dispatch]="dispatch(ticket)"
                    (assign)="assign(ticket)"
                  />
                </div>
              }
            </div>
          }
        </section>

        @if (groups().resolved.length > 0) {
          <details class="group">
            <summary>Resolved ({{ groups().resolved.length }})</summary>
            <div class="rows">
              @for (ticket of groups().resolved; track ticket.id) {
                <app-ticket-summary-row
                  [id]="anchor(ticket)"
                  [ticket]="ticket"
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
  private readonly api = inject(TicketsApi);
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

  protected readonly tickets = signal<Loadable<readonly TicketDto[]>>(LOADING);

  /** Which ticket a dispatch is running against, or null. One at a time, as the epics panel has it. */
  protected readonly inFlight = signal<string | null>(null);

  protected readonly failure = signal<Failure | null>(null);

  /**
   * Where a press sent an agent, by ticket id — the only record there is, and it lives no longer
   * than this component. See the class note on why nothing re-reads it.
   */
  private readonly dispatches = signal<ReadonlyMap<string, TicketAgentDispatchDto>>(new Map());

  protected readonly loaded = computed(() => this.tickets().kind === 'ready');

  protected readonly rows = computed<readonly TicketDto[]>(() => {
    const state = this.tickets();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly groups = computed(() => groupTickets(this.rows()));

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

  protected anchor(ticket: TicketDto): string {
    return ticketAnchor(ticket.id);
  }

  protected running(ticket: TicketDto): boolean {
    return this.inFlight() === ticket.id;
  }

  protected error(ticket: TicketDto): string | null {
    const failure = this.failure();
    return failure?.id === ticket.id ? failure.message : null;
  }

  protected dispatch(ticket: TicketDto): TicketAgentDispatchDto | null {
    return this.dispatches().get(ticket.id) ?? null;
  }

  /**
   * Put a workspace and an agent on this ticket, and keep where they went.
   *
   * <p><b>Nothing is re-read afterwards.</b> The door comments on the ticket and fires the project's
   * `tickets` topic, so the panel's own live channel brings the new list in — asking for it here as
   * well would be two reads of one change, and the second would land first as often as not.
   */
  protected async assign(ticket: TicketDto): Promise<void> {
    const id = ticket.id;
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
      const rows = await this.api.list(projectId);
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
