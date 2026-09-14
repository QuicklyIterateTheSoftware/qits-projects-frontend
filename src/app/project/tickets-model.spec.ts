import type { TicketDto } from '../api/dto';
import {
  TICKET_LIFECYCLE,
  groupTickets,
  isEdited,
  newestFirst,
  ticketAnchor,
  ticketBySlug,
  ticketRoute,
  ticketStatusBadge,
  ticketTransitions,
  ticketTypeBadge,
  ticketsRoute,
} from './tickets-model';

const AT = '2026-09-07T09:00:00Z';

function ticket(over: Partial<TicketDto> = {}): TicketDto {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'The cancelled badge is the wrong colour',
    slug: 'cancelled-badge',
    type: 'BUG',
    status: 'REPORTED',
    assignee: null,
    createdBy: null,
    impetus: 'The badge reads as success when a run is cancelled.',
    description: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  };
}

/**
 * The rules the tickets screen is drawn from, asserted without a component around them.
 *
 * Two of them are the kind that stay plausible while being wrong. **The grouping** decides which of
 * two sections a ticket appears in, and a ticket in neither would simply be gone from the page with
 * nothing to see. **The ordering** is imposed here rather than taken from the server, so the day the
 * service's sort changes this file is what keeps the screen the right way up.
 */
describe('tickets model', () => {
  describe('the badges', () => {
    /**
     * One badge per status, and the tones say how finished rather than how urgent: the three phases
     * still running are the accent and the grey, verified is informational because it is waiting on
     * a person, and only done is green.
     */
    it('gives every status of the lifecycle its own badge', () => {
      expect(ticketStatusBadge('REPORTED')).toEqual({ label: 'reported', tone: 'warning' });
      expect(ticketStatusBadge('REFINED')).toEqual({ label: 'refined', tone: 'neutral' });
      expect(ticketStatusBadge('IMPLEMENTED')).toEqual({ label: 'implemented', tone: 'neutral' });
      expect(ticketStatusBadge('VERIFIED')).toEqual({ label: 'verified', tone: 'info' });
      expect(ticketStatusBadge('DONE')).toEqual({ label: 'done', tone: 'success' });
    });

    /** A label per status, so no two rows on the desk claim the same thing. */
    it('labels the five apart from one another', () => {
      const labels = TICKET_LIFECYCLE.map((status) => ticketStatusBadge(status).label);

      expect(new Set(labels).size).toBe(TICKET_LIFECYCLE.length);
    });

    /**
     * Verified is not done: the platform no longer shows the problem, but nobody has closed it.
     * Toning both green would hide the one row waiting for a human sentence.
     */
    it('keeps verified out of the done tone', () => {
      expect(ticketStatusBadge('VERIFIED').tone).not.toBe(ticketStatusBadge('DONE').tone);
    });

    /** The two types are read together on one screen, so they have to differ at a glance. */
    it('tones the two types apart rather than by their words alone', () => {
      expect(ticketTypeBadge('BUG')).toEqual({ label: 'bug', tone: 'danger' });
      expect(ticketTypeBadge('IMPROVEMENT')).toEqual({ label: 'improvement', tone: 'info' });
      expect(ticketTypeBadge('BUG').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });
  });

  /**
   * The adjacency rule, which is what the detail page's control is drawn from. A target two steps
   * away and a target the ticket already holds are both 409s, so offering either would be offering a
   * press that cannot work.
   */
  describe('the moves a ticket may make', () => {
    it('offers both neighbours from the middle of the lifecycle, forward first', () => {
      expect(ticketTransitions('REFINED')).toEqual([
        { target: 'IMPLEMENTED', label: 'Mark implemented', forward: true },
        { target: 'REPORTED', label: 'Back to reported', forward: false },
      ]);
      expect(ticketTransitions('IMPLEMENTED')).toEqual([
        { target: 'VERIFIED', label: 'Mark verified', forward: true },
        { target: 'REFINED', label: 'Back to refined', forward: false },
      ]);
      expect(ticketTransitions('VERIFIED')).toEqual([
        { target: 'DONE', label: 'Close', forward: true },
        { target: 'IMPLEMENTED', label: 'Back to implemented', forward: false },
      ]);
    });

    /** The ends have one neighbour each — and `DONE` still has one, because nothing is terminal. */
    it('offers one move from each end, and never a way to stand still', () => {
      expect(ticketTransitions('REPORTED')).toEqual([
        { target: 'REFINED', label: 'Mark refined', forward: true },
      ]);
      expect(ticketTransitions('DONE')).toEqual([
        { target: 'VERIFIED', label: 'Reopen', forward: false },
      ]);
    });

    it('never offers a target two steps away, or the status already held', () => {
      for (const status of TICKET_LIFECYCLE) {
        const targets = ticketTransitions(status).map((move) => move.target);
        const at = TICKET_LIFECYCLE.indexOf(status);

        expect(targets).not.toContain(status);
        for (const target of targets) {
          expect(Math.abs(TICKET_LIFECYCLE.indexOf(target) - at)).toBe(1);
        }
      }
    });
  });

  describe('grouping', () => {
    it('puts everything but done in outstanding, and done in its own list', () => {
      const rows = [
        ticket({ id: 'a' }),
        ticket({ id: 'b', status: 'DONE' }),
        ticket({ id: 'c', status: 'VERIFIED' }),
        ticket({ id: 'd', status: 'IMPLEMENTED' }),
      ];

      const groups = groupTickets(rows);

      expect(groups.outstanding.map((row) => row.id)).toEqual(['a', 'd', 'c']);
      expect(groups.done.map((row) => row.id)).toEqual(['b']);
    });

    /**
     * The outstanding section reads as a pipeline rather than as an alphabet: reported at the top,
     * where work is picked up from, and verified at the bottom, where it is nearly closed.
     */
    it('orders outstanding by the lifecycle, not by the words and not by the date', () => {
      const rows = [
        ticket({ id: 'verified', status: 'VERIFIED', createdAt: '2026-09-07T09:00:00Z' }),
        ticket({ id: 'reported', status: 'REPORTED', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'implemented', status: 'IMPLEMENTED', createdAt: '2026-09-06T09:00:00Z' }),
        ticket({ id: 'refined', status: 'REFINED', createdAt: '2026-09-02T09:00:00Z' }),
      ];

      expect(groupTickets(rows).outstanding.map((row) => row.id)).toEqual([
        'reported',
        'refined',
        'implemented',
        'verified',
      ]);
    });

    /** Within one phase the newest is on top: it is the row being talked about. */
    it('keeps newest-first inside a single status, and throughout the done list', () => {
      const rows = [
        ticket({ id: 'old', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'new', createdAt: '2026-09-07T09:00:00Z' }),
        ticket({ id: 'closed-old', status: 'DONE', createdAt: '2026-09-02T09:00:00Z' }),
        ticket({ id: 'closed-new', status: 'DONE', createdAt: '2026-09-08T09:00:00Z' }),
      ];

      const groups = groupTickets(rows);

      expect(groups.outstanding.map((row) => row.id)).toEqual(['new', 'old']);
      expect(groups.done.map((row) => row.id)).toEqual(['closed-new', 'closed-old']);
    });

    /**
     * The server sorts ascending and both sections read newest first, so the reversal is the whole
     * point of doing this here — a list that trusted the response's order would be upside down.
     */
    it('turns the server\u2019s ascending order into newest-first inside each section', () => {
      const rows = [
        ticket({ id: 'old', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'mid', createdAt: '2026-09-04T09:00:00Z' }),
        ticket({ id: 'new', createdAt: '2026-09-07T09:00:00Z' }),
      ];

      expect(groupTickets(rows).outstanding.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
    });

    it('breaks a tie on the incoming order reversed, so the later of two is on top', () => {
      const rows = [ticket({ id: 'first' }), ticket({ id: 'second' })];

      expect(newestFirst(rows).map((row) => row.id)).toEqual(['second', 'first']);
    });

    /** A bad stamp sorts to the bottom of its section rather than throwing the section away. */
    it('sinks a timestamp it cannot parse instead of failing on it', () => {
      const rows = [
        ticket({ id: 'broken', createdAt: 'not a date' }),
        ticket({ id: 'fine', createdAt: '2026-09-01T09:00:00Z' }),
      ];

      expect(newestFirst(rows).map((row) => row.id)).toEqual(['fine', 'broken']);
    });

    it('answers two empty sections for a project with no tickets', () => {
      expect(groupTickets([])).toEqual({ outstanding: [], done: [] });
    });
  });

  describe('addresses', () => {
    /** Slug on both segments: the id resolves nothing in a URL and is corrected away in the first. */
    it('spells a ticket’s address with the project slug and the ticket slug', () => {
      expect(ticketRoute('qits', 'cancelled-badge')).toEqual([
        '/',
        'qits',
        'tickets',
        'cancelled-badge',
      ]);
      expect(ticketsRoute('qits')).toEqual(['/', 'qits', 'tickets']);
    });

    it('gives a ticket a card anchor of its own', () => {
      expect(ticketAnchor('t1')).toBe('ticket-t1');
    });
  });

  describe('resolving a slug', () => {
    it('finds the ticket the address names', () => {
      const rows = [ticket({ id: 'a', slug: 'one' }), ticket({ id: 'b', slug: 'two' })];

      expect(ticketBySlug(rows, 'two')?.id).toBe('b');
    });

    /** A slug nobody has is an ordinary not-found, which is what the detail page draws. */
    it('answers null for a slug the project does not hold', () => {
      expect(ticketBySlug([ticket({ slug: 'one' })], 'nope')).toBeNull();
      expect(ticketBySlug([], 'one')).toBeNull();
    });

    /** The segment is the slug by construction, so matching an id would bless an untested address. */
    it('does not match on the id, which the address grammar never carries', () => {
      expect(ticketBySlug([ticket({ id: 't1', slug: 'one' })], 't1')).toBeNull();
    });
  });

  describe('the edited hint', () => {
    it('says nothing about a comment as it was written', () => {
      expect(isEdited({ createdAt: AT, updatedAt: AT })).toBe(false);
    });

    it('says edited once the update has moved past the creation', () => {
      expect(isEdited({ createdAt: AT, updatedAt: '2026-09-07T10:00:00Z' })).toBe(true);
    });

    /** Compared as instants, not as strings: the service is free to change how it formats one. */
    it('reads two spellings of the same instant as unedited', () => {
      expect(
        isEdited({ createdAt: '2026-09-07T09:00:00Z', updatedAt: '2026-09-07T09:00:00.000Z' }),
      ).toBe(false);
    });

    it('stays quiet about a stamp it cannot parse, rather than guessing', () => {
      expect(isEdited({ createdAt: 'nonsense', updatedAt: AT })).toBe(false);
      expect(isEdited({ createdAt: AT, updatedAt: 'nonsense' })).toBe(false);
    });
  });
});
