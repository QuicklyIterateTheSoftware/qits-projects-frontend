import type { TicketDto } from '../api/dto';
import {
  groupTickets,
  isEdited,
  newestFirst,
  ticketAnchor,
  ticketBySlug,
  ticketRoute,
  ticketStatusBadge,
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
    status: 'OPEN',
    assignee: null,
    createdBy: null,
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
     * Open is `warning` rather than the plan's `neutral`, and that is the deliberate difference: an
     * open task is merely not done, an open ticket is somebody asking for something.
     */
    it('says open in an attention tone and resolved in the done one', () => {
      expect(ticketStatusBadge('OPEN')).toEqual({ label: 'open', tone: 'warning' });
      expect(ticketStatusBadge('RESOLVED')).toEqual({ label: 'resolved', tone: 'success' });
    });

    /** The two types are read together on one screen, so they have to differ at a glance. */
    it('tones the two types apart rather than by their words alone', () => {
      expect(ticketTypeBadge('BUG')).toEqual({ label: 'bug', tone: 'danger' });
      expect(ticketTypeBadge('IMPROVEMENT')).toEqual({ label: 'improvement', tone: 'info' });
      expect(ticketTypeBadge('BUG').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });
  });

  describe('grouping', () => {
    it('puts every ticket in exactly one of the two sections', () => {
      const rows = [
        ticket({ id: 'a' }),
        ticket({ id: 'b', status: 'RESOLVED' }),
        ticket({ id: 'c' }),
      ];

      const groups = groupTickets(rows);

      expect(groups.open.map((row) => row.id)).toEqual(['c', 'a']);
      expect(groups.resolved.map((row) => row.id)).toEqual(['b']);
    });

    /**
     * The server sorts ascending and both sections read newest first, so the reversal is the whole
     * point of doing this here — a list that trusted the response's order would be upside down.
     */
    it('turns the server’s ascending order into newest-first inside each section', () => {
      const rows = [
        ticket({ id: 'old', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'mid', createdAt: '2026-09-04T09:00:00Z' }),
        ticket({ id: 'new', createdAt: '2026-09-07T09:00:00Z' }),
      ];

      expect(groupTickets(rows).open.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
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
      expect(groupTickets([])).toEqual({ open: [], resolved: [] });
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
