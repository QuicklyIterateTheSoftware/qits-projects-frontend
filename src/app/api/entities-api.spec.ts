import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import {
  workAnswer,
  workOfTicket,
  type EpicFixture,
  type WorkFixture,
} from '../../testing/work-fixtures';
import { EntitiesApi, PROGRESS_IN_FLIGHT } from './entities-api';
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
 * tree, and the desk is built from it alone (qits-1815): an epic's features and tasks are its rows
 * by `parent`, every root's workspaces are one more read for the whole project, and a campaign's
 * summary is its progress — at most six at a time. Nothing else is read per root; a body is read
 * whole, for the one entity a page is about.
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
    it('lists a project’s tickets as entities, from their summary rows, stamped TICKET', async () => {
      const answer = api.list('p1', 'TICKET');
      const urls = await serve({
        epics: [epic()],
        tickets: [
          ticket({
            description: 'The **badge**.',
            workspaces: [{ workspaceRowId: 3, repositoryId: 'r1', workspaceId: 'w', branch: 'b' }],
          }),
          ticket({ id: 't2', qualifiedId: 'qits-42' }),
        ],
      });

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['TICKET', 'TICKET']);
      expect(rows.map((row) => row.id)).toEqual(['t1', 't2']);
      expect(rows[0].qualifiedId).toBe('qits-41');
      // The listing has no description, and nothing reads one for the desk.
      expect(rows[0].description).toBeNull();
      expect(rows[0].workspaces.map((workspace) => workspace.workspaceRowId)).toEqual([3]);
      expect(rows[1].workspaces).toEqual([]);
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
      ]);
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
      http.expectOne('/projects/api/projects/a%2Fb/work/workspaces').flush({ workspaces: [] });

      await answer;
    });

    /**
     * An epic is a tree, and its features and tasks are the listing's own rows under it, by
     * `parent` — not a `/children` read per epic and per feature (qits-1815).
     */
    it('assembles an epic with its features and their tasks out of the listing, as one entity', async () => {
      const answer = api.list('p1', 'EPIC');
      const urls = await serve({
        epics: [
          {
            epic: epic({
              workspaces: [
                { workspaceRowId: 7, repositoryId: 'r1', workspaceId: 'w', branch: 'epic/x' },
              ],
            }),
            features: [
              { feature: feature({ description: 'the feature' }), tasks: [task()] },
              { feature: feature({ id: 'f2', number: 15, qualifiedId: 'qits-15' }) },
            ],
          },
        ],
        tickets: [ticket()],
      });

      const [entity] = await answer;
      expect(entity.archetype).toBe('EPIC');
      expect(entity.id).toBe('e1');
      expect(entity.qualifiedId).toBe('qits-12');
      expect(entity.workspaces.map((workspace) => workspace.workspaceRowId)).toEqual([7]);
      const features = entity.archetype === 'EPIC' ? entity.features : [];
      expect(features.map((node) => node.feature.id)).toEqual(['f1', 'f2']);
      expect(features[0].tasks.map((row) => row.id)).toEqual(['k1']);
      expect(features[1].tasks).toEqual([]);
      // A summary: the body is the whole read's, and the desk does not make one.
      expect(features[0].feature.description).toBeNull();
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
      ]);
    });

    /**
     * The count that broke the desk on project `qits` (qits-1815): 743 roots answered about 1,900
     * requests at once and headless Chromium refused them. Now a listing of any size is the listing,
     * one workspaces read, and one progress read per campaign — and nothing per epic or ticket.
     */
    it('reads a 200-root project in the listing, one workspaces read and a progress per campaign', async () => {
      const epics: EpicFixture[] = Array.from({ length: 60 }, (_, at) => ({
        epic: epic({
          id: `e${at}`,
          number: 1000 + at,
          qualifiedId: `qits-${1000 + at}`,
          workspaces:
            at % 7 === 0
              ? [{ workspaceRowId: at, repositoryId: 'r1', workspaceId: 'w', branch: `epic/${at}` }]
              : [],
        }),
        features: [0, 1].map((f) => ({
          feature: feature({
            id: `e${at}-f${f}`,
            epicId: `e${at}`,
            number: 5000 + at * 10 + f,
            qualifiedId: `qits-${5000 + at * 10 + f}`,
          }),
          tasks: [
            task({
              id: `e${at}-f${f}-k`,
              featureId: `e${at}-f${f}`,
              number: 9000 + at * 10 + f,
              qualifiedId: `qits-${9000 + at * 10 + f}`,
            }),
          ],
        })),
      }));
      const tickets = Array.from({ length: 138 }, (_, at) =>
        ticket({
          id: `t${at}`,
          number: 2000 + at,
          qualifiedId: `qits-${2000 + at}`,
          workspaces:
            at % 5 === 0
              ? [{ workspaceRowId: 300 + at, repositoryId: 'r1', workspaceId: 'w', branch: 't' }]
              : [],
        }),
      );
      const campaigns = [CAMPAIGN, { ...CAMPAIGN, id: 'c2', number: 431, qualifiedId: 'qits-431' }];
      const answer = api.list('p1');
      const urls = await serve({ epics, tickets, campaigns });

      const rows = await answer;
      expect(rows).toHaveLength(200);
      expect([...urls].sort()).toEqual(
        [
          '/projects/api/projects/p1/work',
          '/projects/api/projects/p1/work/workspaces',
          '/projects/api/work/qits-430/progress',
          '/projects/api/work/qits-431/progress',
        ].sort(),
      );
      // Every workspace lands on its own row, and a row with none has none.
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get('e0')?.workspaces.map((w) => w.workspaceRowId)).toEqual([0]);
      expect(byId.get('e7')?.workspaces.map((w) => w.workspaceRowId)).toEqual([7]);
      expect(byId.get('e1')?.workspaces).toEqual([]);
      expect(byId.get('t5')?.workspaces.map((w) => w.workspaceRowId)).toEqual([305]);
      expect(byId.get('t6')?.workspaces).toEqual([]);
      const e3 = byId.get('e3');
      expect(e3?.archetype === 'EPIC' && e3.features.map((node) => node.tasks[0].id)).toEqual([
        'e3-f0-k',
        'e3-f1-k',
      ]);
      expect(rows.filter((row) => row.archetype === 'CAMPAIGN').map((row) => row.id)).toEqual([
        'c1',
        'c2',
      ]);
    });

    /**
     * The workspaces read goes out beside the listing, not after it — and with no filter, the
     * campaigns' progress reads follow the listing as one round.
     */
    it('asks for the workspaces beside the listing, and the campaigns’ progress after it', async () => {
      const fixture = { epics: [epic()], tickets: [ticket()], campaigns: [CAMPAIGN] };
      const answer = api.list('p1');
      const first = http.match(() => true);
      expect(first.map((request) => request.request.url)).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
      ]);
      for (const request of first) {
        request.flush(workAnswer('p1', fixture, request.request.url) as object);
      }
      const rest = await serve(fixture);
      expect(rest).toEqual(['/projects/api/work/qits-430/progress']);

      const rows = await answer;
      expect(rows.map((row) => row.archetype)).toEqual(['EPIC', 'TICKET', 'CAMPAIGN']);
    });

    /** A workspace link is the least of what a card draws: its read failing costs only the links. */
    it('draws the desk without workspaces when the workspaces read fails', async () => {
      const fixture = { tickets: [ticket()] };
      const answer = api.list('p1', 'TICKET');
      http
        .expectOne('/projects/api/projects/p1/work/workspaces')
        .flush({ message: 'nope' }, { status: 503, statusText: 'Unavailable' });
      await serve(fixture);

      const rows = await answer;
      expect(rows.map((row) => row.id)).toEqual(['t1']);
      expect(rows[0].workspaces).toEqual([]);
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
      // A campaign has no workspaces of its own, so the campaigns desk asks for none.
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/work/qits-430/progress',
      ]);
    });

    /** The one per-root read left is bounded: never more than six progress reads pending. */
    it('keeps at most six campaign progress reads in flight', async () => {
      const campaigns = Array.from({ length: 15 }, (_, at) => ({
        ...CAMPAIGN,
        id: `c${at}`,
        number: 600 + at,
        qualifiedId: `qits-${600 + at}`,
      }));
      const fixture = { campaigns };
      const answer = api.list('p1', 'CAMPAIGN');
      http
        .expectOne('/projects/api/projects/p1/work')
        .flush(workAnswer('p1', fixture, '/projects/api/projects/p1/work') as object);
      let most = 0;
      let answered = 0;
      while (answered < campaigns.length) {
        await settle();
        const pending = http.match(() => true);
        expect(pending.length).toBeGreaterThan(0);
        most = Math.max(most, pending.length);
        for (const request of pending) {
          request.flush(workAnswer('p1', fixture, request.request.url) as object);
          answered += 1;
        }
      }
      expect(most).toBe(PROGRESS_IN_FLIGHT);
      expect((await answer).map((row) => row.id)).toEqual(campaigns.map((c) => c.id));
    });

    it('leaves the epics’ features and tasks to the epic, never listing them as roots', async () => {
      const answer = api.epicsAndTickets('p1');
      const urls = await serve({
        epics: [{ epic: epic(), features: [{ feature: feature(), tasks: [task()] }] }],
        tickets: [ticket()],
        campaigns: [CAMPAIGN],
      });

      expect((await answer).map((row) => row.archetype)).toEqual(['EPIC', 'TICKET']);
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
      ]);
    });
  });

  /**
   * What a reader that draws a body — or writes one back — reads instead of the summary: the one
   * entity, whole (qits-1815).
   */
  describe('the whole reads', () => {
    it('reads an epic whole: the epic, its workspaces, and its features’ and tasks’ bodies', async () => {
      const answer = api.epic('qits-12');
      const urls = await serve({
        epics: [
          {
            epic: epic({
              description: 'The epic.',
              acceptanceCriteria: ['It reads.'],
              workspaces: [
                { workspaceRowId: 7, repositoryId: 'r1', workspaceId: 'w', branch: 'e' },
              ],
            }),
            features: [
              {
                feature: feature({ description: 'the feature' }),
                tasks: [task({ description: 'the task' })],
              },
            ],
          },
        ],
      });

      const entity = await answer;
      expect(entity.description).toBe('The epic.');
      expect(entity.acceptanceCriteria).toEqual(['It reads.']);
      expect(entity.workspaces.map((w) => w.workspaceRowId)).toEqual([7]);
      expect(entity.features[0].feature.description).toBe('the feature');
      expect(entity.features[0].tasks[0].description).toBe('the task');
      expect([...urls].sort()).toEqual(
        [
          '/projects/api/work/qits-12',
          '/projects/api/work/qits-12/children',
          '/projects/api/work/qits-12/workspaces',
          '/projects/api/work/qits-13/children',
        ].sort(),
      );
    });

    it('reads a campaign whole: its body from the entity, its counts from its progress', async () => {
      const answer = api.campaign('qits-430');
      const urls = await serve({ campaigns: [{ ...CAMPAIGN, started: true, active: true }] });

      const campaign = await answer;
      expect(campaign).toEqual(
        expect.objectContaining({ id: 'c1', archetype: 'CAMPAIGN', members: 3, active: true }),
      );
      expect([...urls].sort()).toEqual(
        ['/projects/api/work/qits-430', '/projects/api/work/qits-430/progress'].sort(),
      );
    });

    /** A page addressed by number: the listing, then the root holding the number, read whole. */
    it('lists the project with the root holding a number read whole, the rest left summary', async () => {
      const fixture: WorkFixture = {
        epics: [
          {
            epic: epic({ description: 'The epic.' }),
            features: [{ feature: feature({ description: 'the feature' }), tasks: [task()] }],
          },
        ],
        tickets: [ticket({ description: 'The ticket.' })],
      };
      // A task's number: its epic is the root read whole.
      const answer = api.listWithWhole('p1', 14);
      const urls = await serve(fixture);

      const items = await answer;
      const read = items.find((item) => item.id === 'e1');
      expect(read?.description).toBe('The epic.');
      expect(read?.archetype === 'EPIC' && read.features[0].feature.description).toBe(
        'the feature',
      );
      expect(items.find((item) => item.id === 't1')?.description).toBeNull();
      expect(urls).toContain('/projects/api/work/qits-12');
      expect(urls.filter((url) => url.includes('qits-41'))).toEqual([]);
    });

    it('answers the listing as it is for a number it does not hold', async () => {
      const answer = api.listWithWhole('p1', 99);
      const urls = await serve({ tickets: [ticket()] });

      expect((await answer).map((item) => item.id)).toEqual(['t1']);
      expect(urls).toEqual([
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
      ]);
    });

    it('reads a root row whole by its own address, and a child out of its parent’s children', async () => {
      const fixture: WorkFixture = {
        epics: [
          {
            epic: epic({ description: 'The epic.' }),
            features: [{ feature: feature({ description: 'the feature' }) }],
          },
        ],
      };
      const root = api.wholeRow({ id: 'e1', qualifiedId: 'qits-12' }, null);
      const child = api.wholeRow({ id: 'f1', qualifiedId: 'qits-13' }, 'qits-12');
      const urls = await serve(fixture);

      expect((await root).description).toBe('The epic.');
      expect((await child).description).toBe('the feature');
      expect([...urls].sort()).toEqual(
        ['/projects/api/work/qits-12', '/projects/api/work/qits-12/children'].sort(),
      );
    });

    it('refuses a child its parent no longer holds, rather than answering less', async () => {
      const answer = api.wholeRow({ id: 'gone', qualifiedId: 'qits-99' }, 'qits-12');
      http.expectOne('/projects/api/work/qits-12/children').flush({ children: [] });

      await expect(answer).rejects.toThrow(/no longer under qits-12/);
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
