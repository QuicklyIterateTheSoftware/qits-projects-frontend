import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TicketCommentDto, TicketDto } from './dto';
import { TicketsApi } from './tickets-api';

const AT = '2026-09-07T09:00:00Z';

const ticket = (over: Partial<TicketDto> = {}): TicketDto => ({
  id: 't1',
  projectId: 'p1',
  title: 'The cancelled badge is the wrong colour',
  slug: 'the-cancelled-badge-is-the-wrong-colour',
  type: 'BUG',
  status: 'OPEN',
  assignee: null,
  createdBy: 'kim',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const comment = (over: Partial<TicketCommentDto> = {}): TicketCommentDto => ({
  id: 'c1',
  ticketId: 't1',
  author: 'kim',
  body: 'Reproduced on dev.',
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

/**
 * The tickets' transport, and the three things about it that are easy to get wrong.
 *
 * **Two path families.** A list and a create hang under their parent, because that is the only place
 * the parent is known; everything about an existing row is addressed by that row's own id at the top
 * level. Getting the second one wrong produces a URL the service answers 404 for, which reads on
 * screen as a ticket that has vanished.
 *
 * **The envelope is unwrapped here, once.** Every read answers `{"entries":[{"ticket":…}]}` or
 * `{"ticket":…}`, and no page above this file has ever seen either — so a method that forgot to
 * unwrap would hand a screen an object with one key on it.
 *
 * **The clears are booleans beside the values, not nulls instead of them.** A partial update reads an
 * absent field as untouched, so "empty this" needs a spelling of its own; a body that sent
 * `description: ''` would store an empty string where the reader meant nothing.
 */
describe('TicketsApi', () => {
  let api: TicketsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TicketsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('the tickets', () => {
    it('lists a project’s tickets, unwrapped out of the entries envelope', async () => {
      const answer = api.list('p1');
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ entries: [{ ticket: ticket() }, { ticket: ticket({ id: 't2' }) }] });

      expect(request.request.method).toBe('GET');
      expect(await answer).toEqual([ticket(), ticket({ id: 't2' })]);
    });

    it('answers an empty list for a project with no tickets, rather than translating a 404', async () => {
      const answer = api.list('p1');
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });

      expect(await answer).toEqual([]);
    });

    /** Project ids reach this from a URL, so one that needs escaping has to survive the trip. */
    it('escapes the project id rather than pasting it into the path', async () => {
      const answer = api.list('a/b');
      http.expectOne('/projects/api/projects/a%2Fb/tickets').flush({ entries: [] });

      await answer;
    });

    it('posts a new ticket under its project and answers the row', async () => {
      const answer = api.create('p1', {
        title: 'The cancelled badge is the wrong colour',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ ticket: ticket() }, { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        title: 'The cancelled badge is the wrong colour',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      expect((await answer).id).toBe('t1');
    });

    /** Absence is what says "nothing was said" — an empty string would be a stored empty string. */
    it('leaves an unstated description and assignee off the body entirely', async () => {
      const answer = api.create('p1', { title: 'Tidy the spacing', type: 'IMPROVEMENT' });
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ ticket: ticket({ type: 'IMPROVEMENT' }) });

      expect(request.request.body).toEqual({ title: 'Tidy the spacing', type: 'IMPROVEMENT' });
      await answer;
    });

    it('reads one ticket by id, at the top level rather than under its project', async () => {
      const answer = api.get('t1');
      const request = http.expectOne('/projects/api/tickets/t1');
      request.flush({ ticket: ticket() });

      expect(request.request.method).toBe('GET');
      expect((await answer).slug).toBe('the-cancelled-badge-is-the-wrong-colour');
    });

    it('puts an edit and answers the row it came back as', async () => {
      const answer = api.update('t1', { title: 'Renamed', type: 'IMPROVEMENT' });
      const request = http.expectOne('/projects/api/tickets/t1');
      request.flush({ ticket: ticket({ title: 'Renamed', type: 'IMPROVEMENT' }) });

      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ title: 'Renamed', type: 'IMPROVEMENT' });
      expect((await answer).title).toBe('Renamed');
    });

    /** The pairing is the whole shape of this body — see {@link TicketEdit}. */
    it('sends the clears as their own flags, beside the fields they empty', async () => {
      const answer = api.update('t1', { clearDescription: true, clearAssignee: true });
      const request = http.expectOne('/projects/api/tickets/t1');
      request.flush({ ticket: ticket({ description: null, assignee: null }) });

      expect(request.request.body).toEqual({ clearDescription: true, clearAssignee: true });
      expect((await answer).assignee).toBeNull();
    });

    it('resolves a ticket through the transition verb, not through a field edit', async () => {
      const answer = api.transition('t1', 'RESOLVED');
      const request = http.expectOne('/projects/api/tickets/t1/transition');
      request.flush({ ticket: ticket({ status: 'RESOLVED' }) });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'RESOLVED' });
      expect((await answer).status).toBe('RESOLVED');
    });

    it('reopens through the same verb, the other way', async () => {
      const answer = api.transition('t1', 'OPEN');
      const request = http.expectOne('/projects/api/tickets/t1/transition');
      request.flush({ ticket: ticket() });

      expect(request.request.body).toEqual({ target: 'OPEN' });
      expect((await answer).status).toBe('OPEN');
    });

    /** The `success` body adds nothing a 200 has not said, so it is dropped rather than returned. */
    it('deletes a ticket and drops the body that only says it worked', async () => {
      const answer = api.remove('t1');
      const request = http.expectOne('/projects/api/tickets/t1');
      request.flush({ success: true });

      expect(request.request.method).toBe('DELETE');
      await expect(answer).resolves.toBeUndefined();
    });
  });

  describe('the comments', () => {
    it('lists a ticket’s comments under the ticket, unwrapped', async () => {
      const answer = api.comments('t1');
      const request = http.expectOne('/projects/api/tickets/t1/comments');
      request.flush({ entries: [{ comment: comment() }] });

      expect(request.request.method).toBe('GET');
      expect(await answer).toEqual([comment()]);
    });

    /** The author is stamped from the session, so a client that sent one would be asserting it. */
    it('posts only the body, because the author is the server’s to stamp', async () => {
      const answer = api.addComment('t1', 'Reproduced on dev.');
      const request = http.expectOne('/projects/api/tickets/t1/comments');
      request.flush({ comment: comment() }, { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
      expect((await answer).id).toBe('c1');
    });

    /** A comment is addressed by its own id, at its own path — not under the ticket it is on. */
    it('puts a comment edit at ticket-comments/<id>', async () => {
      const answer = api.updateComment('c1', 'Reproduced on dev and on stage.');
      const request = http.expectOne('/projects/api/ticket-comments/c1');
      request.flush({ comment: comment({ body: 'Reproduced on dev and on stage.' }) });

      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev and on stage.' });
      expect((await answer).body).toBe('Reproduced on dev and on stage.');
    });

    it('deletes a comment at the same address, and drops the body', async () => {
      const answer = api.removeComment('c1');
      const request = http.expectOne('/projects/api/ticket-comments/c1');
      request.flush({ success: true });

      expect(request.request.method).toBe('DELETE');
      await expect(answer).resolves.toBeUndefined();
    });

    it('escapes a comment id rather than pasting it into the path', async () => {
      const answer = api.removeComment('a/b');
      http.expectOne('/projects/api/ticket-comments/a%2Fb').flush({ success: true });

      await answer;
    });
  });
});
