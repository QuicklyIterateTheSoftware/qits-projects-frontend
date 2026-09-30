import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import { EntitiesApi } from './entities-api';
import type { CommentDto, EpicDto, FeatureDto, TaskDto, TicketDto } from './dto';

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
  status: 'REFINED',
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

const comment = (over: Partial<CommentDto> = {}): CommentDto => ({
  id: 'c1',
  entityId: 't1',
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
const CAMPAIGN = {
  id: 'c1',
  number: 430,
  qualifiedId: 'qits-430',
  projectId: 'p1',
  title: 'Rename qits-x',
  status: 'REFINED',
  started: false,
  active: false,
  members: 3,
};

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
     * No filter means everything, and the reads go out **together**: a caller asking for the
     * project's whole body of work pays one round trip per archetype, not one per row and not one
     * after the other. Campaigns are roots of work too (qits-419), so they are part of "everything".
     */
    it('reads every archetype in parallel when no archetype is named', async () => {
      const answer = api.list('p1');
      const epics = http.expectOne('/projects/api/projects/p1/epics');
      const tickets = http.expectOne('/projects/api/projects/p1/tickets');
      const campaigns = http.expectOne('/projects/api/projects/p1/campaigns');
      epics.flush({ entries: [{ epic: epic() }] });
      tickets.flush({ entries: [{ ticket: ticket() }] });
      campaigns.flush({ campaigns: [CAMPAIGN] });
      await settle();
      http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['EPIC', 'TICKET', 'CAMPAIGN']);
    });

    it('reads nothing but the campaigns when the campaigns are what was asked for', async () => {
      const answer = api.list('p1', 'CAMPAIGN');
      http.expectOne('/projects/api/projects/p1/campaigns').flush({ campaigns: [CAMPAIGN] });

      const rows = await answer;
      expect(rows).toEqual([
        expect.objectContaining({
          archetype: 'CAMPAIGN',
          id: 'c1',
          number: 430,
          qualifiedId: 'qits-430',
          status: 'REFINED',
          members: 3,
        }),
      ]);
      expect(http.match(() => true)).toEqual([]);
    });
  });

  /**
   * The map-shaped door, and the thing that makes it worth having beside the one-row transition: one
   * request, one atomicity, one refusal.
   */
  describe('the multi-entity transition', () => {
    const request = new Map<string, EntityTransitionRequest>([
      ['f1', { archetype: 'EPIC', membership: { parent: null }, title: 'The transition form' }],
      [
        'k1',
        { archetype: 'FEATURE', membership: { parent: 'f1' }, title: 'Draw the parent picker' },
      ],
    ]);

    it('posts the map as an object keyed by entity id, at the entities path', async () => {
      const answer = api.transitionEntities(request);
      const posted = http.expectOne('/projects/api/entities/transition');
      posted.flush({ f1: { id: 'f1', archetype: 'EPIC' }, k1: { id: 'k1', archetype: 'FEATURE' } });

      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({
        f1: { archetype: 'EPIC', membership: { parent: null }, title: 'The transition form' },
        k1: {
          archetype: 'FEATURE',
          membership: { parent: 'f1' },
          title: 'Draw the parent picker',
        },
      });
      expect([...(await answer).keys()]).toEqual(['f1', 'k1']);
    });

    /** The post-state is the answer, keyed the way the request was — the ids are the only linkage. */
    it('answers the written post-state by id', async () => {
      const answer = api.transitionEntities(request);
      http
        .expectOne('/projects/api/entities/transition')
        .flush({ f1: { id: 'f1', archetype: 'EPIC', parent: null } });

      expect((await answer).get('f1')?.archetype).toBe('EPIC');
    });

    /** A refusal is one 400 carrying every violation, and it reaches the caller unmangled. */
    it('rejects with the service’s whole sentence when the request is refused', async () => {
      const answer = api.transitionEntities(request);
      http
        .expectOne('/projects/api/entities/transition')
        .flush(
          { message: 'a TASK requires repository id; a EPIC has no impetus' },
          { status: 400, statusText: 'Bad Request' },
        );

      await expect(answer).rejects.toMatchObject({
        status: 400,
        error: { message: 'a TASK requires repository id; a EPIC has no impetus' },
      });
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

    /** The retired PUT is never called: an edit is a restatement on the multi-entity door. */
    it('has no ticket PUT at all', () => {
      expect('update' in api).toBe(false);
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
     * Its own door, not a field on the edit: blocking is something that happens to an entity, and a
     * block sent through the edit would drag every other box on that form along with it.
     *
     * <p>The entity door, not the retired ticket-scoped one — `POST /entities/{id}/blocked` is what
     * every archetype with a lifecycle answers through now, a ticket included.
     */
    it('blocks an entity through the entity blocked verb, carrying the reason', async () => {
      const answer = api.setBlocked('t1', true, 'Waiting on qits-ci to redeploy.');
      const request = http.expectOne('/projects/api/entities/t1/blocked');
      request.flush({ block: { entityId: 't1', archetype: 'TICKET', status: 'REPORTED', blocked: true } });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        blocked: true,
        reason: 'Waiting on qits-ci to redeploy.',
      });
      expect((await answer).blocked).toBe(true);
    });

    /** The same door the other way, and the note is optional — coming back is self-explanatory. */
    it('unblocks through the same door, with or without a note', async () => {
      const answer = api.setBlocked('t1', false);
      const request = http.expectOne('/projects/api/entities/t1/blocked');
      request.flush({ block: { entityId: 't1', archetype: 'TICKET', status: 'REPORTED', blocked: false } });

      expect(request.request.body).toEqual({ blocked: false, reason: '' });
      expect((await answer).blocked).toBe(false);
    });

    /** Not ticket-scoped at all: the same verb answers for an epic, and for a campaign. */
    it('blocks an epic through the same entity door, not a ticket-scoped one', async () => {
      const answer = api.setBlocked('e1', true, 'Waiting on a design decision.');
      const request = http.expectOne('/projects/api/entities/e1/blocked');
      request.flush({ block: { entityId: 'e1', archetype: 'EPIC', status: 'REFINED', blocked: true } });

      expect((await answer).archetype).toBe('EPIC');
      expect((await answer).blocked).toBe(true);
    });

    /**
     * Absent means false, and the boundary is where that stops being a question — a model field left
     * `undefined` would have every reader of it remembering which way the missing value falls.
     */
    it('reads a ticket with no blocked field as not blocked', async () => {
      const answer = api.get('t1');
      http.expectOne('/projects/api/tickets/t1').flush({ ticket: ticket() });

      expect((await answer).blocked).toBe(false);
    });

    /**
     * A status step stays on the lifecycle door: the multi-entity transition restates a row's shape
     * and runs no lifecycle (no adjacency, no phase advance, no resolving move).
     */
    it('addresses one ticket rather than the multi-entity transition', async () => {
      const answer = api.transition('t1', 'REFINED');
      http.expectOne('/projects/api/tickets/t1/transition').flush({ ticket: ticket() });

      await answer;
      expect(http.match('/projects/api/entities/transition')).toEqual([]);
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

  /** The one dispatching door, for every archetype with a lifecycle (qits-394). */
  describe('the dispatch door', () => {
    const answer = {
      entityId: 't1',
      archetype: 'TICKET',
      phase: 'refine',
      mode: 'FLOW',
      workspaceRowId: 7,
      repositoryId: 'r1',
      branch: 'ticket/the-cancelled-badge-is-the-wrong-colour',
      fresh: true,
      agentLaunch: 'SCHEDULED',
    };

    it('posts Dispatch as FLOW to the entity door, and unwraps the dispatch', async () => {
      const dispatched = api.dispatch('t1', 'FLOW');
      const request = http.expectOne('/projects/api/entities/t1/dispatch');
      request.flush({ dispatch: answer });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ mode: 'FLOW' });
      expect(await dispatched).toEqual({ dispatch: answer });
    });

    it('posts Run the next phase as PHASE to the same door', async () => {
      const dispatched = api.dispatch('e1', 'PHASE');
      const request = http.expectOne('/projects/api/entities/e1/dispatch');
      request.flush({ dispatch: { ...answer, entityId: 'e1', archetype: 'EPIC', mode: 'PHASE' } });

      expect(request.request.body).toEqual({ mode: 'PHASE' });
      const envelope = await dispatched;
      expect('dispatch' in envelope && envelope.dispatch.mode).toBe('PHASE');
    });

    /** On a campaign the press is its start (qits-417), and the answer is its progress instead. */
    it('answers a campaign’s start as its progress, discriminated by key', async () => {
      const progress = {
        campaign: { id: 'c1', qualifiedId: 'qits-430', title: 'Rename', status: 'REFINED', start: null },
        evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
        members: [],
      };
      const dispatched = api.dispatch('c1', 'FLOW');
      http.expectOne('/projects/api/entities/c1/dispatch').flush({ progress });

      const envelope = await dispatched;
      expect('progress' in envelope).toBe(true);
      expect('dispatch' in envelope).toBe(false);
    });

    it('never calls the retired per-archetype dispatch doors', async () => {
      const dispatched = api.dispatch('t1', 'FLOW');
      http.expectOne('/projects/api/entities/t1/dispatch').flush({ dispatch: answer });
      await dispatched;

      expect(http.match(() => true)).toEqual([]);
      expect('dispatchAgent' in api).toBe(false);
    });

    it('reads what a press would start, unwrapping the state', async () => {
      const state = api.dispatchState('a/b');
      const request = http.expectOne('/projects/api/entities/a%2Fb/dispatch');
      request.flush({
        state: {
          entityId: 'a/b',
          archetype: 'EPIC',
          status: 'REFINED',
          nextPhase: 'implement',
          blocked: false,
          dispatchable: true,
          mode: null,
        },
      });

      expect(request.request.method).toBe('GET');
      expect((await state).nextPhase).toBe('implement');
    });

    /** The audit's key is a subtree key: an epic's id for its tree, a ticket's own for a ticket. */
    it('reads the audit subtree by its key', async () => {
      const entries = api.audit('t1');
      const request = http.expectOne('/projects/api/epics/t1/audit');
      request.flush({
        entries: [
          {
            id: 'a1',
            entityType: 'TICKET',
            entityId: 't1',
            epicId: 't1',
            operation: 'UPDATE',
            changedBy: 'kim',
            changedAt: AT,
            snapshot: null,
          },
        ],
      });

      expect((await entries).map((entry) => entry.operation)).toEqual(['UPDATE']);
    });
  });

  describe('the comments', () => {
    it('lists an entity’s comments under it, unwrapped — any archetype, not only a ticket', async () => {
      const answer = api.comments('e1');
      const request = http.expectOne('/projects/api/entities/e1/comments');
      request.flush({ entries: [{ comment: comment() }] });

      expect(request.request.method).toBe('GET');
      expect(await answer).toEqual([comment()]);
    });

    /** The author is stamped from the session, so a client that sent one would be asserting it. */
    it('posts only the body, because the author is the server’s to stamp', async () => {
      const answer = api.addComment('e1', 'Reproduced on dev.');
      const request = http.expectOne('/projects/api/entities/e1/comments');
      request.flush({ comment: comment() }, { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
      expect((await answer).id).toBe('c1');
    });

    /**
     * A comment is addressed by its own id, at its own path — not under the entity it is on — and
     * the edit travels as a JSON merge patch, the only property it carries being `body`.
     */
    it('patches a comment edit at comments/<id>, as a merge patch', async () => {
      const answer = api.updateComment('c1', 'Reproduced on dev and on stage.');
      const request = http.expectOne('/projects/api/comments/c1');
      request.flush({ comment: comment({ body: 'Reproduced on dev and on stage.' }) });

      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev and on stage.' });
      expect(request.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
      expect((await answer).body).toBe('Reproduced on dev and on stage.');
    });

    it('deletes a comment at the same address, and drops the body', async () => {
      const answer = api.removeComment('c1');
      const request = http.expectOne('/projects/api/comments/c1');
      request.flush({ success: true });

      expect(request.request.method).toBe('DELETE');
      await expect(answer).resolves.toBeUndefined();
    });

    it('escapes a comment id rather than pasting it into the path', async () => {
      const answer = api.removeComment('a/b');
      http.expectOne('/projects/api/comments/a%2Fb').flush({ success: true });

      await answer;
    });

    it('escapes an entity id rather than pasting it into the path', async () => {
      const answer = api.comments('a/b');
      http.expectOne('/projects/api/entities/a%2Fb/comments').flush({ entries: [] });

      await answer;
    });
  });
});
