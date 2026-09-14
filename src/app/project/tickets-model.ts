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

/**
 * The impetus rule, as a form says it — **a constant rather than template text** because the two
 * shapes it quotes are written with braces, and a `{` in an Angular template opens an ICU message.
 * Escaping them inline would spell the sentence as three interpolations and make the one piece of
 * prose a reporter actually reads the least readable line in the file.
 *
 * <p>It lives here rather than beside the create form because **two** forms quote it: intake writes
 * an impetus and triage fixes a badly written one, and a second copy of the rule would be a second
 * opinion about what an impetus is.
 */
export const IMPETUS_RULE =
  'What brought this about, in your own words: “{some error} occurs {in some context}”, or ' +
  '“{an existing part} should be {something to introduce or improve}”. One sentence, almost ' +
  'always — rarely a paragraph, very rarely two. Steps to reproduce a bug can go here too and do ' +
  'not count against that.';

/** What a ticket's badge says, and how loudly. The shape {@link ./epics-model#StatusBadge} has. */
export interface TicketBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

/**
 * The lifecycle in order, which is the only place that order is written down.
 *
 * Everything else here is derived from it: the badge, the adjacency a transition control offers, and
 * the order the outstanding section reads down. A second copy of this sequence would be a second
 * opinion about what comes after what, and the one that was not updated would be the one drawn.
 */
export const TICKET_LIFECYCLE: readonly TicketStatus[] = [
  'REPORTED',
  'REFINED',
  'IMPLEMENTED',
  'VERIFIED',
  'DONE',
];

/**
 * A badge per status, and the tones say **how finished**, not how urgent.
 *
 * <p>The three in flight are the accent the palette has and the grey beside it. `REPORTED` is
 * `warning` for the reason the old single open badge was: it is a standing request nobody has
 * picked up, and drawing it in the same grey as a ticket already being worked would make the top of
 * the pipeline read as background. `REFINED` and `IMPLEMENTED` are `neutral` — something is
 * underway and nothing is being claimed about it, which is exactly what the plan's own `neutral`
 * means one level up.
 *
 * <p>`VERIFIED` is `info` and not `success`, and that is the distinction worth having. Verified
 * means the platform no longer shows the problem; done means a person agreed to close it. Toning
 * both green would hide the one row on the desk that is waiting for a human sentence.
 *
 * <p>`DONE` is `success`, the same word the plan uses for an implemented epic.
 *
 * <p>The five tones are not five distinct colours, because {@link QitsBadgeTone} has five values for
 * the whole application and two of them (`danger`, `info`) are already spoken for by the type badge
 * beside this one. Labels carry the distinction; the tone carries the phase.
 */
const STATUS_BADGES: Readonly<Record<TicketStatus, TicketBadge>> = {
  REPORTED: { label: 'reported', tone: 'warning' },
  REFINED: { label: 'refined', tone: 'neutral' },
  IMPLEMENTED: { label: 'implemented', tone: 'neutral' },
  VERIFIED: { label: 'verified', tone: 'info' },
  DONE: { label: 'done', tone: 'success' },
};

/** What the ticket has achieved — see {@link ../api/dto#TicketStatus} for why that is the reading. */
export function ticketStatusBadge(status: TicketStatus): TicketBadge {
  return STATUS_BADGES[status] ?? STATUS_BADGES.REPORTED;
}

/** One move a ticket can make from where it is, and the claim pressing it makes. */
export interface TicketTransition {
  readonly target: TicketStatus;
  readonly label: string;
  /** Forward is the pipeline's direction; backward is a correction. */
  readonly forward: boolean;
}

/**
 * What each move is called, **named after the claim it makes** rather than after the state it lands
 * in.
 *
 * Forward, a press asserts that a phase finished: "Mark refined" says the ticket now says what to
 * do. `DONE` is "Close", because that is the word a person uses for it and "mark done" would be the
 * one label on this row that described a column rather than an act. Backward, a press retracts a
 * claim — "Back to refined" says the implementation is not there after all — and the one move out of
 * `DONE` is "Reopen", which is what reopening has always been called.
 */
const FORWARD_LABELS: Readonly<Record<TicketStatus, string>> = {
  REPORTED: 'Mark reported',
  REFINED: 'Mark refined',
  IMPLEMENTED: 'Mark implemented',
  VERIFIED: 'Mark verified',
  DONE: 'Close',
};

const BACKWARD_LABELS: Readonly<Record<TicketStatus, string>> = {
  REPORTED: 'Back to reported',
  REFINED: 'Back to refined',
  IMPLEMENTED: 'Back to implemented',
  VERIFIED: 'Reopen',
  DONE: 'Back to done',
};

/**
 * The moves a ticket may make: its **neighbours on the lifecycle and nothing else**, forward first.
 *
 * <p><b>Adjacent-only in either direction, and the current status is not among them.</b> The service
 * refuses both a two-step move and a move to the status already held, so a control that offered
 * either would be offering a 409 — and the reason it is computed here rather than in the page is
 * that this is the rule the whole screen is drawn from, and a rule inside a template is one nothing
 * can test without a browser around it.
 *
 * <p>Forward first because the pipeline's direction is what a reader is usually pressing, and the
 * backward move is a correction they go looking for. The ends have one neighbour each, which is how
 * "nothing is terminal" draws: `DONE` still offers Reopen.
 */
export function ticketTransitions(status: TicketStatus): readonly TicketTransition[] {
  const at = TICKET_LIFECYCLE.indexOf(status);
  if (at < 0) {
    return [];
  }
  const moves: TicketTransition[] = [];
  const ahead = TICKET_LIFECYCLE[at + 1];
  const behind = TICKET_LIFECYCLE[at - 1];
  if (ahead) {
    moves.push({ target: ahead, label: FORWARD_LABELS[ahead], forward: true });
  }
  if (behind) {
    moves.push({ target: behind, label: BACKWARD_LABELS[behind], forward: false });
  }
  return moves;
}

/**
 * A bug is `danger` and an improvement is `info`, which is the distinction doing the most work on
 * this screen.
 *
 * The two are read together — a reader scanning the outstanding section is deciding what to pick up
 * — so they have to be told apart at a glance rather than by reading. Red against blue does that;
 * two neighbouring greys would leave the type badge as decoration.
 */
const BUG: TicketBadge = { label: 'bug', tone: 'danger' };
const IMPROVEMENT: TicketBadge = { label: 'improvement', tone: 'info' };

/** What a ticket is about. */
export function ticketTypeBadge(type: TicketType): TicketBadge {
  return type === 'BUG' ? BUG : IMPROVEMENT;
}

/** The two sections of the overview, in the order a reader works down them. */
export interface TicketGroups {
  readonly outstanding: readonly TicketDto[];
  readonly done: readonly TicketDto[];
}

/**
 * The tickets split into **what is still moving and what is closed**: outstanding is anything but
 * `DONE`.
 *
 * <p><b>Two lists for five statuses, deliberately.</b> A section per status would put five headings
 * on a desk that usually has one or two rows under each, and would make a ticket's progress a jump
 * between boxes rather than a move down a list. The split that matters to a reader is whether
 * anything is still owed, which is exactly `DONE` or not.
 *
 * <p><b>Outstanding is ordered by the lifecycle, not alphabetically and not by date</b> — reported
 * at the top, then refined, then implemented, then verified — so the section reads as a pipeline and
 * a reader sees where the work is piling up. Within one status it is **newest first**, which is the
 * old rule kept: the row that just arrived is the one being talked about.
 *
 * <p><b>Done is newest first throughout</b>, because it is an archive and what somebody looks up in
 * an archive is usually the most recent thing in it. A status that the lifecycle does not know
 * sorts after the ones it does rather than vanishing: an unrecognised row belongs at the bottom of
 * the desk, not off it.
 *
 * <p><b>Grouped and re-ordered here rather than fetched twice.</b> The overview already reads every
 * ticket, and two `?status=` reads would be two moments — enough for a ticket moved between them to
 * appear in both sections or in neither. One read that is grouped is one moment, which is the same
 * reasoning `groupEpics` is built on.
 */
export function groupTickets(tickets: readonly TicketDto[]): TicketGroups {
  const outstanding: TicketDto[] = [];
  const done: TicketDto[] = [];
  for (const ticket of tickets) {
    (ticket.status === 'DONE' ? done : outstanding).push(ticket);
  }
  return { outstanding: byLifecycle(newestFirst(outstanding)), done: newestFirst(done) };
}

/** The lifecycle's own order, ties keeping whatever order they arrived in. See {@link groupTickets}. */
function byLifecycle(tickets: readonly TicketDto[]): readonly TicketDto[] {
  return tickets
    .map((ticket, index) => ({ ticket, index }))
    .sort((left, right) => phase(left.ticket) - phase(right.ticket) || left.index - right.index)
    .map((entry) => entry.ticket);
}

/** Where a ticket sits on the lifecycle, with an unknown status sorted past every known one. */
function phase(ticket: TicketDto): number {
  const at = TICKET_LIFECYCLE.indexOf(ticket.status);
  return at < 0 ? TICKET_LIFECYCLE.length : at;
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
