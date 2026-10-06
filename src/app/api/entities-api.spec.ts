import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import { workAnswer, workOfTicket, type WorkFixture } from '../../testing/work-fixtures';
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
 * The entities' transport on the `/work` surface (epic qits-965), and the things about it that are
 * easy to get wrong.
 *
 * **One listing, the archetype a filter on it.** `GET /projects/{project}/work` answers the whole
 * tree; each root is then read whole (the listing is a summary) with its workspaces, an epic's
 * features and tasks from `…/children`, and a campaign's summary from its progress — in parallel
 * across the roots, never one after the other.
 *
 * **Everything about an existing row is addressed by its qualified id** at `/work/{q}`. Getting it
 * wrong produces a URL the service answers 404 for, which reads on screen as a row that vanished.
 *
 * **The envelope is unwrapped here, once**, so no page above this file sees one.
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

  /** Answer every `/work` read of the fixture project, round after round, and say what was read. */
  async function serve(fixture: WorkFixture): Promise<string[]> {
    const urls: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      await settle();
      for (const request of http.match(() => true)) {
        const answer = workAnswer('p1', fixture, request.request.url, request.request.method);
        if (!answer) throw new Error(`unanswered ${request.request.url}`);
        urls.push(request.request.url);
        request.flush(answer);
      }
    }
    return urls;
  }

  describe('the one read, filtered by archetype', () => {
    it('lists a project’s tickets as entities, read whole and stamped TICKET', async () => {
      const answer = api.list('p1', 'TICKET');
      const urls = await serve({
        epics: [epic()],
        tickets: [
          ticket({ description: 'The **badge**.' }),
          ticket({ id: 't2', qualifiedId: 'qits-42' }),
        ],
      });

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['TICKET', 'TICKET']);
      expect(rows.map((row) => row.id)).toEqual(['t1', 't2']);
      expect(rows[0].qualifiedId).toBe('qits-41');
      // The listing has no description; the whole read does.
      expect(rows[0].description).toBe('The **badge**.');
      expect(urls).toContain('/projects/api/work/qits-41');
      expect(urls).toContain('/projects/api/work/qits-41/workspaces');
      // The epic is in the listing, but nothing about it is read for the tickets desk.
      expect(urls.filter((url) => url.includes('qits-12'))).toEqual([]);
    });

    it('answers an empty list for a project with none, rather than translating a 404', async () => {
      const answer = api.list('p1', 'TICKET');
      await serve({});

      expect(await answer).toEqual([]);
    });

    /** Project ids reach this from a URL, so one that needs escaping has to survive the trip. */
    it('escapes the project id rather than pasting it into the path', async () => {
      const answer = api.list('a/b', 'TICKET');
      http.expectOne('/projects/api/projects/a%2Fb/work').flush({ entities: [] });

      await answer;
    });

    /**
     * An epic is a tree, so its entity carries the whole fan-out — and the fan-out is a request per
     * *level*, in parallel across the parents, rather than a request per row in series.
     */
    it('assembles an epic with its features and their tasks, as one entity', async () => {
      const answer = api.list('p1', 'EPIC');
      const urls = await serve({
        epics: [
          {
            epic: epic({
              workspaces: [
                { workspaceRowId: 7, repositoryId: 'r1', workspaceId: 'w', branch: 'epic/x' },
              ],
            }),
            features: [{ feature: feature({ description: 'the feature' }), tasks: [task()] }],
          },
        ],
        tickets: [ticket()],
      });

      const [entity] = await answer;
      expect(entity.archetype).toBe('EPIC');
      expect(entity.id).toBe('e1');
      expect(entity.qualifiedId).toBe('qits-12');
      expect(entity.workspaces.map((workspace) => workspace.workspaceRowId)).toEqual([7]);
      expect(entity.archetype === 'EPIC' && entity.features).toHaveLength(1);
      expect(entity.archetype === 'EPIC' && entity.features[0].feature.description).toBe(
        'the feature',
      );
      expect(entity.archetype === 'EPIC' && entity.features[0].tasks[0].id).toBe('k1');
      expect(urls).toContain('/projects/api/work/qits-12/children');
      expect(urls).toContain('/projects/api/work/qits-13/children');
    });

    /**
     * No filter means every root, and the reads about them go out **together**: one round trip for
     * the listing, then one for the roots — not one per row after the other. Campaigns are roots of
     * work too (qits-419), so they are part of "everything".
     */
    it('reads every root in parallel when no archetype is named', async () => {
      const fixture = { epics: [epic()], tickets: [ticket()], campaigns: [CAMPAIGN] };
      const answer = api.list('p1');
      http
        .expectOne('/projects/api/projects/p1/work')
        .flush(workAnswer('p1', fixture, '/projects/api/projects/p1/work') as object);
      await settle();
      // One round after the listing, every root's reads are already out together.
      const round = http.match(() => true);
      expect(round.map((request) => request.request.url)).toEqual(
        expect.arrayContaining([
          '/projects/api/work/qits-12',
          '/projects/api/work/qits-12/workspaces',
          '/projects/api/work/qits-12/children',
          '/projects/api/work/qits-41',
          '/projects/api/work/qits-41/workspaces',
          '/projects/api/work/qits-430/progress',
        ]),
      );
      for (const request of round) {
        request.flush(workAnswer('p1', fixture, request.request.url) as object);
      }

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['EPIC', 'TICKET', 'CAMPAIGN']);
    });

    it('summarises a campaign from its progress, reading nothing else about it', async () => {
      const answer = api.list('p1', 'CAMPAIGN');
      const urls = await serve({ tickets: [ticket()], campaigns: [CAMPAIGN] });

      const rows = await answer;
      expect(rows).toEqual([
        expect.objectContaining({
          archetype: 'CAMPAIGN',
          id: 'c1',
          number: 430,
          qualifiedId: 'qits-430',
          status: 'REFINED',
          members: 3,
          started: false,
        }),
      ]);
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/work/qits-430/progress',
      ]);
    });

    it('leaves the epics’ features and tasks to the epic, never listing them as roots', async () => {
      const answer = api.epicsAndTickets('p1');
      await serve({
        epics: [{ epic: epic(), features: [{ feature: feature(), tasks: [task()] }] }],
        tickets: [ticket()],
        campaigns: [CAMPAIGN],
      });

      expect((await answer).map((row) => row.archetype)).toEqual(['EPIC', 'TICKET']);
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

    it('posts the map as an object keyed by entity, at the work transition path', async () => {
      const answer = api.transitionEntities(request);
      const posted = http.expectOne('/projects/api/work/transition');
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
        .expectOne('/projects/api/work/transition')
        .flush({ f1: { id: 'f1', archetype: 'EPIC', parent: null } });

      expect((await answer).get('f1')?.archetype).toBe('EPIC');
    });

    /** A refusal is one 400 carrying every violation, and it reaches the caller unmangled. */
    it('rejects with the service’s whole sentence when the request is refused', async () => {
      const answer = api.transitionEntities(request);
      http
        .expectOne('/projects/api/work/transition')
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

  describe('the writes about one entity', () => {
    it('posts a new ticket to POST /work and answers the entity', async () => {
      const answer = api.create('p1', {
        title: 'The cancelled badge is the wrong colour',
        impetus: 'The badge reads as success when a run is cancelled.',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      const request = http.expectOne('/projects/api/work');
      request.flush(workOfTicket(ticket()), { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        archetype: 'TICKET',
        project: 'p1',
        title: 'The cancelled badge is the wrong colour',
        impetus: 'The badge reads as success when a run is cancelled.',
        ticketType: 'BUG',
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
      const request = http.expectOne('/projects/api/work');
      request.flush(workOfTicket(ticket({ type: 'IMPROVEMENT' })));

      expect(request.request.body).toEqual({
        archetype: 'TICKET',
        project: 'p1',
        title: 'Tidy the spacing',
        impetus: 'The ticket cards should be easier to scan.',
        ticketType: 'IMPROVEMENT',
      });
      expect((await answer).type).toBe('IMPROVEMENT');
    });

    it('reads one ticket by its qualified id, with its workspaces', async () => {
      const answer = api.get('qits-41');
      const request = http.expectOne('/projects/api/work/qits-41');
      request.flush(workOfTicket(ticket()));
      http.expectOne('/projects/api/work/qits-41/workspaces').flush({ workspaces: [] });

      expect(request.request.method).toBe('GET');
      expect((await answer).slug).toBe('the-cancelled-badge-is-the-wrong-colour');
    });

    /** The retired PUT is never called: an edit is a restatement on the multi-entity door. */
    it('has no ticket PUT at all', () => {
      expect('update' in api).toBe(false);
    });

    it('moves an entity along the lifecycle through the status door, not a field edit', async () => {
      const answer = api.transition('qits-41', 'REFINED');
      const request = http.expectOne('/projects/api/work/qits-41/status');
      request.flush({ ...workOfTicket(ticket({ status: 'REFINED' })), statusBefore: 'REPORTED' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'REFINED' });
      expect((await answer).status).toBe('REFINED');
      expect(http.match('/projects/api/work/transition')).toEqual([]);
    });

    /**
     * Its own door, not a field on the edit: blocking is something that happens to an entity, and a
     * block sent through the edit would drag every other box on that form along with it.
     */
    it('blocks an entity through its blocked door, carrying the reason', async () => {
      const answer = api.setBlocked('qits-41', true, 'Waiting on qits-ci to redeploy.');
      const request = http.expectOne('/projects/api/work/qits-41/blocked');
      request.flush({
        block: { entityId: 't1', archetype: 'TICKET', status: 'REPORTED', blocked: true },
      });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        blocked: true,
        reason: 'Waiting on qits-ci to redeploy.',
      });
      expect((await answer).blocked).toBe(true);
    });

    /** The same door the other way, and the note is optional — coming back is self-explanatory. */
    it('unblocks through the same door, with or without a note', async () => {
      const answer = api.setBlocked('qits-41', false);
      const request = http.expectOne('/projects/api/work/qits-41/blocked');
      request.flush({
        block: { entityId: 't1', archetype: 'TICKET', status: 'REPORTED', blocked: false },
      });

      expect(request.request.body).toEqual({ blocked: false, reason: '' });
      expect((await answer).blocked).toBe(false);
    });

    /**
     * Absent means false, and the boundary is where that stops being a question — a model field left
     * `undefined` would have every reader of it remembering which way the missing value falls.
     */
    it('reads a ticket with no blocked field as not blocked', async () => {
      const answer = api.get('qits-41');
      const unblocked: Record<string, unknown> = { ...workOfTicket(ticket()) };
      delete unblocked['blocked'];
      http.expectOne('/projects/api/work/qits-41').flush(unblocked);
      http.expectOne('/projects/api/work/qits-41/workspaces').flush({ workspaces: [] });

      expect((await answer).blocked).toBe(false);
    });

    it('patches an entity as a merge patch', async () => {
      const answer = api.patch('qits-41', { acceptanceCriteria: ['It works.'] });
      const request = http.expectOne('/projects/api/work/qits-41');
      request.flush(workOfTicket(ticket({ acceptanceCriteria: ['It works.'] })));

      expect(request.request.method).toBe('PATCH');
      // A merge patch, sent as plain JSON — see the note above `EntitiesApi`.
    expect(request.request.headers.has('Content-Type')).toBe(false);
      expect((await answer).acceptanceCriteria).toEqual(['It works.']);
    });

    /** The `success` body adds nothing a 200 has not said, so it is dropped rather than returned. */
    it('deletes an entity and drops the body that only says it worked', async () => {
      const answer = api.remove('qits-41');
      const request = http.expectOne('/projects/api/work/qits-41');
      request.flush({ success: true });

      expect(request.request.method).toBe('DELETE');
      await expect(answer).resolves.toBeUndefined();
    });

    it('reads the workspaces a dispatch stood on its branch', async () => {
      const answer = api.workspaces('qits-41');
      http.expectOne('/projects/api/work/qits-41/workspaces').flush({
        workspaces: [
          { workspaceRowId: 7, repositoryId: 'r1', workspaceId: 'w', branch: 'ticket/x' },
        ],
      });

      expect((await answer).map((workspace) => workspace.branch)).toEqual(['ticket/x']);
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
      const dispatched = api.dispatch('qits-41', 'FLOW');
      const request = http.expectOne('/projects/api/work/qits-41/dispatch');
      request.flush({ dispatch: answer });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ mode: 'FLOW' });
      expect(await dispatched).toEqual({ dispatch: answer });
    });

    it('posts Run the next phase as PHASE to the same door', async () => {
      const dispatched = api.dispatch('qits-12', 'PHASE');
      const request = http.expectOne('/projects/api/work/qits-12/dispatch');
      request.flush({ dispatch: { ...answer, entityId: 'e1', archetype: 'EPIC', mode: 'PHASE' } });

      expect(request.request.body).toEqual({ mode: 'PHASE' });
      const envelope = await dispatched;
      expect('dispatch' in envelope && envelope.dispatch.mode).toBe('PHASE');
    });

    /** On a campaign the press is its start (qits-417), and the answer is its progress instead. */
    it('answers a campaign’s start as its progress, discriminated by key', async () => {
      const progress = {
        campaign: {
          id: 'c1',
          qualifiedId: 'qits-430',
          title: 'Rename',
          status: 'REFINED',
          start: null,
        },
        evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
        members: [],
      };
      const dispatched = api.dispatch('qits-430', 'FLOW');
      http.expectOne('/projects/api/work/qits-430/dispatch').flush({ progress });

      const envelope = await dispatched;
      expect('progress' in envelope).toBe(true);
      expect('dispatch' in envelope).toBe(false);
    });

    it('never calls the retired per-archetype dispatch doors', async () => {
      const dispatched = api.dispatch('qits-41', 'FLOW');
      http.expectOne('/projects/api/work/qits-41/dispatch').flush({ dispatch: answer });
      await dispatched;

      expect(http.match(() => true)).toEqual([]);
      expect('dispatchAgent' in api).toBe(false);
    });

    it('reads what a press would start, unwrapping the state', async () => {
      const state = api.dispatchState('a/b');
      const request = http.expectOne('/projects/api/work/a%2Fb/dispatch');
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

    /** A root's audit answers its whole subtree. */
    it('reads the audit by the entity’s qualified id', async () => {
      const entries = api.audit('qits-41');
      const request = http.expectOne('/projects/api/work/qits-41/audit');
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
      const answer = api.comments('qits-12');
      const request = http.expectOne('/projects/api/work/qits-12/comments');
      request.flush({ entries: [{ comment: comment() }] });

      expect(request.request.method).toBe('GET');
      expect(await answer).toEqual([comment()]);
    });

    /** The author is stamped from the session, so a client that sent one would be asserting it. */
    it('posts only the body, because the author is the server’s to stamp', async () => {
      const answer = api.addComment('qits-12', 'Reproduced on dev.');
      const request = http.expectOne('/projects/api/work/qits-12/comments');
      request.flush({ comment: comment() }, { status: 201, statusText: 'Created' });

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
      expect((await answer).id).toBe('c1');
    });

    /**
     * A comment is addressed under the entity it is on, and the edit travels as a JSON merge patch,
     * the only property it carries being `body`.
     */
    it('patches a comment edit at <entity>/comments/<id>, as a merge patch', async () => {
      const answer = api.updateComment('qits-12', 'c1', 'Reproduced on dev and on stage.');
      const request = http.expectOne('/projects/api/work/qits-12/comments/c1');
      request.flush({ comment: comment({ body: 'Reproduced on dev and on stage.' }) });

      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev and on stage.' });
      // A merge patch, sent as plain JSON — see the note above `EntitiesApi`.
    expect(request.request.headers.has('Content-Type')).toBe(false);
      expect((await answer).body).toBe('Reproduced on dev and on stage.');
    });

    it('deletes a comment at the same address, and drops the body', async () => {
      const answer = api.removeComment('qits-12', 'c1');
      const request = http.expectOne('/projects/api/work/qits-12/comments/c1');
      request.flush({ success: true });

      expect(request.request.method).toBe('DELETE');
      await expect(answer).resolves.toBeUndefined();
    });

    it('escapes a comment id rather than pasting it into the path', async () => {
      const answer = api.removeComment('qits-12', 'a/b');
      http.expectOne('/projects/api/work/qits-12/comments/a%2Fb').flush({ success: true });

      await answer;
    });

    it('escapes an entity id rather than pasting it into the path', async () => {
      const answer = api.comments('a/b');
      http.expectOne('/projects/api/work/a%2Fb/comments').flush({ entries: [] });

      await answer;
    });
  });
});
