import type { QitsBadgeTone } from '@qits/ui-components';
import type { TicketCommentDto, TicketDto, TicketStatus, TicketType } from '../api/dto';

/**
 * The small work beside the plan, and the three questions a screen asks of it: what a ticket's
 * badges say, which of the two sections it belongs in, and where it is addressed.
 *
 * No Angular here, for the reason the epics model gives: every answer is derived from the wire
 * shapes alone, and each is the kind of rule that stays plausible while being wrong — a section a
 * ticket silently falls out of, a route spelled with an id where the address grammar wants a slug.
 */

/** What a ticket's badge says, and how loudly. The shape {@link ./epics-model#StatusBadge} has. */
export interface TicketBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

/**
 * Open is `warning`, and it is the one tone worth arguing about.
 *
 * A *task* that is open is simply not done yet, so the plan draws it `neutral` — nothing is being
 * claimed about it. A ticket that is open is a standing request from somebody: it is on the list
 * precisely because it wants attention, and drawing it in the same grey as an unstarted task would
 * make the whole Open section read as background. `danger` would be a lie in the other direction —
 * an open improvement is not an emergency — so `warning` is the honest middle.
 */
const OPEN: TicketBadge = { label: 'open', tone: 'warning' };

/**
 * Resolved is `success`, the same word the plan uses for an implemented epic.
 *
 * It is one word for three endings — fixed, done, not doing it — because the wire has one status
 * for them. What actually happened is in the comments, and a badge that guessed between them would
 * be inventing a distinction the service does not store.
 */
const RESOLVED: TicketBadge = { label: 'resolved', tone: 'success' };

/** Whether the ticket is still asking for something. */
export function ticketStatusBadge(status: TicketStatus): TicketBadge {
  return status === 'RESOLVED' ? RESOLVED : OPEN;
}

/**
 * A bug is `danger` and an improvement is `info`, which is the distinction doing the most work on
 * this screen.
 *
 * The two are read together — a reader scanning the Open section is deciding what to pick up — so
 * they have to be told apart at a glance rather than by reading. Red against blue does that; two
 * neighbouring greys would leave the type badge as decoration.
 */
const BUG: TicketBadge = { label: 'bug', tone: 'danger' };
const IMPROVEMENT: TicketBadge = { label: 'improvement', tone: 'info' };

/** What a ticket is about. */
export function ticketTypeBadge(type: TicketType): TicketBadge {
  return type === 'BUG' ? BUG : IMPROVEMENT;
}

/** The two sections of the overview, in the order a reader works down them. */
export interface TicketGroups {
  readonly open: readonly TicketDto[];
  readonly resolved: readonly TicketDto[];
}

/**
 * The tickets split by whether they are still asking for something, **newest first inside each**.
 *
 * <p><b>Grouped and re-ordered here rather than fetched twice.</b> The overview already reads every
 * ticket, and two `?status=` reads would be two moments — enough for a ticket resolved between them
 * to appear in both sections or in neither. One read that is grouped is one moment, which is the
 * same reasoning `groupEpics` is built on.
 *
 * <p><b>Newest first, against the server's ascending order.</b> A ticket list is read from the top
 * and the top should be what just arrived: the oldest open ticket is the one least likely to be
 * picked up next, and the newest resolved one is the record somebody is most likely to be checking.
 * The order is imposed here rather than assumed of the response, so a change of sort on the service
 * cannot quietly turn this screen upside down.
 *
 * <p>Ties break on the incoming order **reversed**, which keeps two tickets stamped in the same
 * instant in the order the server would have listed them, newest of the two on top. An unparseable
 * timestamp sorts as the epoch rather than throwing: a row with a bad stamp belongs at the bottom of
 * its section, not in the way of the section.
 */
export function groupTickets(tickets: readonly TicketDto[]): TicketGroups {
  const open: TicketDto[] = [];
  const resolved: TicketDto[] = [];
  for (const ticket of tickets) {
    (ticket.status === 'RESOLVED' ? resolved : open).push(ticket);
  }
  return { open: newestFirst(open), resolved: newestFirst(resolved) };
}

/** Newest first, ties keeping the incoming order reversed. See {@link groupTickets}. */
export function newestFirst(tickets: readonly TicketDto[]): readonly TicketDto[] {
  return tickets
    .map((ticket, index) => ({ ticket, index }))
    .sort(
      (left, right) => createdMs(right.ticket) - createdMs(left.ticket) || right.index - left.index,
    )
    .map((entry) => entry.ticket);
}

/** The creation instant in milliseconds, or the epoch for a stamp that will not parse. */
function createdMs(ticket: TicketDto): number {
  const at = Date.parse(ticket.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

/** The element id a ticket's card carries, and therefore what an in-page link points at. */
export function ticketAnchor(ticketId: string): string {
  return `ticket-${ticketId}`;
}

/**
 * Where one ticket lives: `/<project>/tickets/<slug>`, as a router command array.
 *
 * <p>Composed here, and spelled with the **slug** on both segments, because that is this platform's
 * address grammar everywhere — the project's first segment is its slug and so is the ticket's. The
 * id would work for neither: nothing resolves a ticket id in the URL, and a project id in the first
 * segment is corrected away the moment it renders.
 *
 * <p>A rule rather than a stored field, for the reason the branch names are: a second copy of an
 * address is free to drift from the route table that serves it.
 */
export function ticketRoute(projectSlug: string, ticketSlug: string): readonly string[] {
  return ['/', projectSlug, 'tickets', ticketSlug];
}

/** The overview's own address, which is where a deleted ticket's page sends the reader back to. */
export function ticketsRoute(projectSlug: string): readonly string[] {
  return ['/', projectSlug, 'tickets'];
}

/**
 * The ticket a slug names, or null when this list holds none.
 *
 * <p>Null is an ordinary answer and not an error: the detail page resolves its address against the
 * project's list, so a slug nobody has is exactly the not-found this returns. Matched on the slug
 * alone and never on the id — the segment is the slug by construction, and accepting an id here
 * would quietly bless an address the route table does not promise to keep working.
 */
export function ticketBySlug(tickets: readonly TicketDto[], slug: string): TicketDto | null {
  return tickets.find((ticket) => ticket.slug === slug) ?? null;
}

/**
 * Whether a comment has been rewritten since it was posted.
 *
 * There is no `edited` flag on the wire and no revision history, so the two timestamps are the whole
 * of the evidence: `updatedAt` past `createdAt` is the hint, and equal-or-before is a comment as it
 * was written. Compared as parsed instants rather than as strings, because the service is free to
 * change how it formats one and string order would then be arbitrary; a stamp that will not parse
 * reads as unedited, which is the quiet answer rather than the wrong one.
 */
export function isEdited(comment: Pick<TicketCommentDto, 'createdAt' | 'updatedAt'>): boolean {
  const created = Date.parse(comment.createdAt);
  const updated = Date.parse(comment.updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) {
    return false;
  }
  return updated > created;
}
