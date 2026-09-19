import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntitiesApi } from './entities-api';
import type { EpicDto, FeatureDto, TaskDto, TicketCommentDto, TicketDto } from './dto';

const AT = '2026-09-07T09:00:00Z';

const ticket = (over: Partial<TicketDto> = {}): TicketDto => ({
  id: 't1',
  projectId: 'p1',
  title: 'The cancelled badge is the wrong colour',
  slug: 'the-cancelled-badge-is-the-wrong-colour',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REPORTED',
  assignee: null,
  createdBy: 'kim',
  impetus: 'The badge reads as success when a run is cancelled, on the builds page.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
  ...over,
});

const epic = (over: Partial<EpicDto> = {}): EpicDto => ({
  id: 'e1',
  projectId: 'p1',
  title: 'Epics on the project page',
  slug: 'epics-overview',
  description: null,
  number: 12,
  qualifiedId: 'qits-12',
  status: 'IMPLEMENTATION',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
  ...over,
});

const feature = (over: Partial<FeatureDto> = {}): FeatureDto => ({
  id: 'f1',
  epicId: 'e1',
  projectId: 'p1',
  title: 'Read the epics',
  slug: 'read-the-epics',
  description: null,
  number: 13,
  qualifiedId: 'qits-13',
  dependsOnFeatureId: null,
  implementedOn: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const task = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: 'k1',
  featureId: 'f1',
  repositoryId: 'r1',
  projectId: 'p1',
  title: 'Add the endpoints',
  slug: 'add-the-endpoints',
  description: null,
  number: 14,
  qualifiedId: 'qits-14',
  dependsOnTaskId: null,
  implementedAt: null,
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

/** Let the fan-out's `async` frames land between one level of the plan and the next. */
const settle = async () => {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve();
  }
};

/**
 * The entities' transport, and the four things about it that are easy to get wrong.
 *
 * **The archetype is a filter on one read, and it decides which endpoints are called at all.** There
 * is no unified list on the wire — the service kept the contract byte-identical through the
 * migration — so this class is where "the project's entities" is assembled out of `…/epics` and
 * `…/tickets`. A filter that read both regardless would make each desk pay for the other's fan-out,
 * and a fan-out issued per row rather than per level would turn one screen into dozens of requests.
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
describe('EntitiesApi', () => {
  let api: EntitiesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(EntitiesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('the one read, filtered by archetype', () => {
    it('lists a project’s tickets as entities, unwrapped and stamped TICKET', async () => {
      const answer = api.list('p1', 'TICKET');
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ entries: [{ ticket: ticket() }, { ticket: ticket({ id: 't2' }) }] });

      expect(request.request.method).toBe('GET');
      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['TICKET', 'TICKET']);
      expect(rows.map((row) => row.id)).toEqual(['t1', 't2']);
      expect(rows[0].qualifiedId).toBe('qits-41');
    });

    /** Asking for tickets must not touch the epics' three routes. `http.verify()` is the assertion. */
    it('reads nothing but the tickets when the tickets are what was asked for', async () => {
      const answer = api.list('p1', 'TICKET');
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });

      expect(await answer).toEqual([]);
      expect(http.match('/projects/api/projects/p1/epics')).toEqual([]);
    });

    it('answers an empty list for a project with none, rather than translating a 404', async () => {
      const answer = api.list('p1', 'TICKET');
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });

      expect(await answer).toEqual([]);
    });

    /** Project ids reach this from a URL, so one that needs escaping has to survive the trip. */
    it('escapes the project id rather than pasting it into the path', async () => {
      const answer = api.list('a/b', 'TICKET');
      http.expectOne('/projects/api/projects/a%2Fb/tickets').flush({ entries: [] });

      await answer;
    });

    /**
     * An epic is a tree, so its entity carries the whole fan-out — and the fan-out is a request per
     * *level*, in parallel across the parents, rather than a request per row in series.
     */
    it('assembles an epic with its features and their tasks, as one entity', async () => {
      const answer = api.list('p1', 'EPIC');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: epic() }] });
      await settle();
      http
        .expectOne('/projects/api/epics/e1/features')
        .flush({ entries: [{ feature: feature() }] });
      await settle();
      http.expectOne('/projects/api/features/f1/tasks').flush({ entries: [{ task: task() }] });

      const [entity] = await answer;
      expect(entity.archetype).toBe('EPIC');
      expect(entity.id).toBe('e1');
      expect(entity.qualifiedId).toBe('qits-12');
      expect(entity.archetype === 'EPIC' && entity.features).toHaveLength(1);
      expect(entity.archetype === 'EPIC' && entity.features[0].tasks[0].id).toBe('k1');
    });

    /** Asking for epics must not read the tickets either — the filter cuts both ways. */
    it('reads nothing but the plan when the epics are what was asked for', async () => {
      const answer = api.list('p1', 'EPIC');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [] });

      expect(await answer).toEqual([]);
      expect(http.match('/projects/api/projects/p1/tickets')).toEqual([]);
    });

    /**
     * No filter means everything, and the two reads go out **together**: a caller asking for the
     * project's whole body of work pays two round trips, not one per row and not one after the other.
     */
    it('reads both archetypes in parallel when no archetype is named', async () => {
      const answer = api.list('p1');
      const epics = http.expectOne('/projects/api/projects/p1/epics');
      const tickets = http.expectOne('/projects/api/projects/p1/tickets');
      epics.flush({ entries: [{ epic: epic() }] });
      tickets.flush({ entries: [{ ticket: ticket() }] });
      await settle();
      http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['EPIC', 'TICKET']);
    });
  });

  describe('the ticket writes', () => {
    it('posts a new ticket under its project and answers the entity', async () => {
      const answer = api.create('p1', {
        title: 'The cancelled badge is the wrong colour',
        impetus: 'The badge reads as success when a run is cancelled.',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ ticket: ticket() }, { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        title: 'The cancelled badge is the wrong colour',
        impetus: 'The badge reads as success when a run is cancelled.',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      expect((await answer).id).toBe('t1');
      expect((await answer).archetype).toBe('TICKET');
    });

    /** Absence is what says "nothing was said" — an empty string would be a stored empty string. */
    it('leaves an unstated description and assignee off the body entirely', async () => {
      const answer = api.create('p1', {
        title: 'Tidy the spacing',
        impetus: 'The ticket cards should be easier to scan.',
        type: 'IMPROVEMENT',
      });
      const request = http.expectOne('/projects/api/projects/p1/tickets');
      request.flush({ ticket: ticket({ type: 'IMPROVEMENT' }) });

      expect(request.request.body).toEqual({
        title: 'Tidy the spacing',
        impetus: 'The ticket cards should be easier to scan.',
        type: 'IMPROVEMENT',
      });
      await answer;
    });

    it('reads one ticket by id, at the top level rather than under its project', async () => {
      const answer = api.get('t1');
      const request = http.expectOne('/projects/api/tickets/t1');
      request.flush({ ticket: ticket() });

      expect(request.request.method).toBe('GET');
      expect((await answer).slug).toBe('the-cancelled-badge-is-the-wrong-colour');
    });

    it('puts an edit and answers the entity it came back as', async () => {
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

    it('moves a ticket along the lifecycle through the transition verb, not a field edit', async () => {
      const answer = api.transition('t1', 'REFINED');
      const request = http.expectOne('/projects/api/tickets/t1/transition');
      request.flush({ ticket: ticket({ status: 'REFINED' }) });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'REFINED' });
      expect((await answer).status).toBe('REFINED');
    });

    /** Backwards is the same door: nothing is terminal, so a closed ticket walks back the way it came. */
    it('moves it back through the same verb, the other way', async () => {
      const answer = api.transition('t1', 'VERIFIED');
      const request = http.expectOne('/projects/api/tickets/t1/transition');
      request.flush({ ticket: ticket({ status: 'VERIFIED' }) });

      expect(request.request.body).toEqual({ target: 'VERIFIED' });
      expect((await answer).status).toBe('VERIFIED');
    });

    /**
     * The single-row door, and it stays single. The unified entity brought
     * `POST /projects/api/entities/transition` with it — a map of id to target state — and nothing in
     * this client calls it yet: a one-row move has no business paying for a map.
     */
    it('addresses one ticket rather than the multi-entity transition', async () => {
      const answer = api.transition('t1', 'REFINED');
      http.expectOne('/projects/api/tickets/t1/transition').flush({ ticket: ticket() });

      await answer;
      expect(http.match('/projects/api/entities/transition')).toEqual([]);
    });

    /** Nothing is sent: the ticket is in the path and the principal is in the session. */
    it('dispatches an agent with an empty body, and unwraps the dispatch', async () => {
      const answer = api.dispatchAgent('t1');
      const request = http.expectOne('/projects/api/tickets/t1/dispatch-agent');
      request.flush({
        dispatch: {
          workspaceRowId: 7,
          repositoryId: 'r1',
          branch: 'ticket/the-cancelled-badge-is-the-wrong-colour',
          fresh: true,
          agentLaunch: 'SCHEDULED',
        },
      });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({});
      expect(await answer).toEqual({
        workspaceRowId: 7,
        repositoryId: 'r1',
        branch: 'ticket/the-cancelled-badge-is-the-wrong-colour',
        fresh: true,
        agentLaunch: 'SCHEDULED',
      });
    });

    it('escapes the ticket id on the dispatch path too', async () => {
      const answer = api.dispatchAgent('a/b');
      http.expectOne('/projects/api/tickets/a%2Fb/dispatch-agent').flush({
        dispatch: {
          workspaceRowId: 7,
          repositoryId: 'r1',
          branch: 'ticket/a-b',
          fresh: false,
          agentLaunch: 'SKIPPED_RUNNING',
        },
      });

      expect((await answer).agentLaunch).toBe('SKIPPED_RUNNING');
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
