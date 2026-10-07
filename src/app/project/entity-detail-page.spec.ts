import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import { routes } from '../app.routes';
import type {
  CampaignSummaryDto,
  EntityDispatchStateDto,
  EpicDto,
  FeatureDto,
  TaskDto,
  TicketDto,
} from '../api/dto';
import { EVENT_SOURCE_FACTORY } from '../api/event-source';
import { workAnswer, workOfCampaign, workOfEpic, workOfTicket } from '../../testing/work-fixtures';

const AT = '2026-09-07T09:00:00Z';

const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-workspaces',
        label: 'Workspaces',
        host: 'workspaces.dev.example.test',
        origin: 'https://workspaces.dev.example.test',
      },
    ],
  },
};

const WORDS = ['REPORTED', 'REFINED', 'IMPLEMENTED', 'VERIFIED', 'DONE', 'DROPPED'];

/** The served moves: forward, back, then drop/reopen — and DONE, final, with none. */
const TRANSITIONS = {
  REPORTED: [
    { to: 'REFINED', kind: 'FORWARD' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  REFINED: [
    { to: 'IMPLEMENTED', kind: 'FORWARD' },
    { to: 'REPORTED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  IMPLEMENTED: [
    { to: 'VERIFIED', kind: 'FORWARD' },
    { to: 'REFINED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  VERIFIED: [
    { to: 'DONE', kind: 'FORWARD' },
    { to: 'IMPLEMENTED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  DONE: [],
  DROPPED: [{ to: 'REPORTED', kind: 'REOPEN' }],
};

function spec(archetype: string, lifecycle: readonly string[], permitted: readonly string[]) {
  return {
    archetype,
    depth: archetype === 'TASK' ? 2 : archetype === 'FEATURE' ? 1 : 0,
    // A campaign may sit at the top of a project too — this fixture only left it out because no test
    // here used to read `mayBeRoot`. qits-763 made it load-bearing: the component gates the agent
    // surface (Dispatch, Run the next phase, Refine) on it as well as on having a lifecycle, so that a
    // feature or a task growing a status does not grow that surface along with it.
    mayBeRoot: archetype !== 'FEATURE' && archetype !== 'TASK',
    required: ['TITLE'],
    requiredOnTransition: ['TITLE'],
    permitted,
    legalStatuses: [...lifecycle].sort(),
    lifecycle,
    transitions: lifecycle.length > 0 ? TRANSITIONS : {},
  };
}

const REGISTRY = {
  properties: [
    'TITLE',
    'SLUG',
    'DESCRIPTION',
    'STATUS',
    'TICKET_TYPE',
    'IMPETUS',
    'ASSIGNEE',
    'CREATED_BY',
    'REPOSITORY_ID',
    'IMPLEMENTED_AT',
    'DEPENDS_ON',
  ],
  serverOwned: ['SLUG', 'CREATED_BY'],
  archetypes: [
    spec('EPIC', WORDS, ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS']),
    spec('TICKET', WORDS, [
      'TITLE',
      'SLUG',
      'DESCRIPTION',
      'STATUS',
      'TICKET_TYPE',
      'IMPETUS',
      'ASSIGNEE',
      'CREATED_BY',
    ]),
    spec('CAMPAIGN', WORDS, ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS']),
    spec('FEATURE', [], ['TITLE', 'SLUG', 'DESCRIPTION', 'IMPLEMENTED_AT', 'DEPENDS_ON']),
    spec(
      'TASK',
      [],
      ['TITLE', 'SLUG', 'DESCRIPTION', 'REPOSITORY_ID', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
    ),
  ],
};

/**
 * The service after qits-763: a feature and a task hold the same eight-word lifecycle an epic or a
 * ticket does. `mayBeRoot` stays false for both — that is the one thing that does not change — so the
 * component must keep their pages free of Dispatch/Refine even though {@link REGISTRY}'s old signal
 * for that, "has a lifecycle", no longer tells the two cases apart.
 */
const REGISTRY_WITH_FEATURE_LIFECYCLE = {
  ...REGISTRY,
  archetypes: REGISTRY.archetypes.map((entry) =>
    entry.archetype === 'FEATURE' || entry.archetype === 'TASK'
      ? spec(entry.archetype, WORDS, [...entry.permitted, 'STATUS'])
      : entry,
  ),
};

/**
 * qits-887: the service once it permits `ACCEPTANCE_CRITERIA` on EPIC and TICKET, walks
 * READY_FOR_DEV, and serves the gates of REFINED → READY_FOR_DEV. {@link REGISTRY} stays the
 * *before* fixture, so the same page is pinned against both.
 */
const WALK_887 = [
  'REPORTED',
  'REFINED',
  'READY_FOR_DEV',
  'IMPLEMENTED',
  'VERIFIED',
  'DONE',
  'DROPPED',
];
const REGISTRY_887 = {
  ...REGISTRY,
  properties: [...REGISTRY.properties, 'ACCEPTANCE_CRITERIA'],
  archetypes: REGISTRY.archetypes.map((entry) =>
    entry.archetype === 'EPIC' || entry.archetype === 'TICKET'
      ? {
          ...entry,
          permitted: [...entry.permitted, 'ACCEPTANCE_CRITERIA'],
          legalStatuses: [...WALK_887].sort(),
          lifecycle: WALK_887,
          transitions: {
            ...TRANSITIONS,
            REFINED: [
              {
                to: 'READY_FOR_DEV',
                kind: 'FORWARD',
                gates: ['ACCEPTANCE_CRITERIA', 'PERSON_APPROVAL'],
              },
              { to: 'REPORTED', kind: 'BACK' },
              { to: 'DROPPED', kind: 'DROP' },
            ],
            READY_FOR_DEV: [
              { to: 'IMPLEMENTED', kind: 'SKIP' },
              { to: 'REFINED', kind: 'BACK' },
              { to: 'DROPPED', kind: 'DROP' },
            ],
          },
        }
      : entry,
  ),
};

const EPIC: EpicDto = {
  id: 'e1',
  projectId: 'p1',
  title: 'One desk',
  slug: 'one-desk',
  description: 'Collapse the **two** desks.',
  number: 12,
  qualifiedId: 'qits-12',
  status: 'REFINED',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

/** The draft a supersede of {@link EPIC} spawns. */
const SUCCESSOR: EpicDto = {
  ...EPIC,
  id: 'e2',
  slug: 'one-desk-2',
  number: 99,
  qualifiedId: 'qits-99',
  status: 'REPORTED',
};

const FEATURE: FeatureDto = {
  id: 'f1',
  epicId: 'e1',
  projectId: 'p1',
  title: 'The desk',
  slug: 'the-desk',
  description: 'One route.',
  number: 13,
  qualifiedId: 'qits-13',
  dependsOnFeatureId: null,
  implementedOn: null,
  createdAt: AT,
  updatedAt: AT,
};

const TASK_DONE: TaskDto = {
  id: 'k1',
  featureId: 'f1',
  repositoryId: 'r1',
  projectId: 'p1',
  title: 'Route the desk',
  slug: 'route-the-desk',
  description: null,
  number: 14,
  qualifiedId: 'qits-14',
  dependsOnTaskId: null,
  implementedAt: AT,
  createdAt: AT,
  updatedAt: AT,
};

const TASK_OPEN: TaskDto = {
  ...TASK_DONE,
  id: 'k2',
  title: 'Draw the filter',
  slug: 'draw-the-filter',
  number: 15,
  qualifiedId: 'qits-15',
  implementedAt: null,
  dependsOnTaskId: 'k1',
};

const TICKET: TicketDto = {
  id: 't1',
  projectId: 'p1',
  title: 'The cancelled badge is the wrong colour',
  slug: 'cancelled-badge',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REPORTED',
  assignee: 'kim',
  createdBy: 'kim',
  impetus: 'The run badge shows success when a run is cancelled.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

/** A campaign on the desk: its listing row, and its full read with two members. */
const CAMPAIGN_ROW: CampaignSummaryDto = {
  id: 'c1',
  number: 430,
  qualifiedId: 'qits-430',
  projectId: 'p1',
  title: 'Rename qits-x',
  status: 'REFINED',
  started: false,
  active: false,
  members: 2,
};

function campaignMember(id: string, qualified: string, position: number, groups: object[] = []) {
  return {
    membershipId: `m-${id}`,
    position,
    entity: {
      id,
      archetype: 'TICKET',
      qualifiedId: qualified,
      title: `Member ${qualified}`,
      status: 'REPORTED',
      blocked: false,
    },
    claimedAt: null,
    joinedRunning: false,
    dispatchedAt: null,
    dispatch: { workspaceId: null, branch: null, agentLaunch: null },
    dispatchRefusal: null,
    dispatchRefusedAt: null,
    dispatchError: null,
    groups,
  };
}

const CAMPAIGN = {
  ...CAMPAIGN_ROW,
  slug: 'rename-qits-x',
  description: 'Rename it **in order**.',
  start: null,
  members: [
    campaignMember('t1', 'qits-41', 0),
    campaignMember('e1', 'qits-12', 1, [
      {
        id: 'g1',
        criteria: [
          {
            id: 'k1',
            kind: 'ENTITY_STATUS',
            predicate: { entityId: 't1', status: 'VERIFIED' },
            seeded: true,
            satisfiedAt: null,
            evidence: null,
            approval: null,
          },
        ],
      },
    ]),
  ],
};

/** The entity each qualified id in a `/work` path names. */
const ID_OF: Readonly<Record<string, string>> = {
  'qits-12': 'e1',
  'qits-13': 'f1',
  'qits-14': 'k1',
  'qits-15': 'k2',
  'qits-41': 't1',
  'qits-430': 'c1',
};

function stateOf(over: Partial<EntityDispatchStateDto> = {}): EntityDispatchStateDto {
  return {
    entityId: 't1',
    archetype: 'TICKET',
    status: 'REPORTED',
    nextPhase: 'refine',
    blocked: false,
    dispatchable: true,
    mode: null,
    ...over,
  };
}

/**
 * **One node's page, for every archetype** (qits-397): a frame — title, status, the three actions,
 * parent, children, history — and an archetype-shaped body.
 *
 * <p>What is worth pinning is where each press goes, and that the page asks rather than decides:
 * Dispatch and Run the next phase are `POST /entities/{id}/dispatch` with `FLOW` and `PHASE`, enabled
 * only as the dispatch state allows; Refine opens the room through the entity door and is enabled
 * where the next phase is `refine`; a status step goes through the archetype's lifecycle door; an edit
 * is a restatement on `POST /entities/transition`; and no `PUT` is ever sent.
 *
 * <p>The HTTP side is a small fake server: every request is answered from a table, recorded, and the
 * loop runs until nothing is pending — the reads a page makes are many and parallel, and asserting
 * their exact order would pin the implementation rather than the contract.
 */
describe('EntityDetailPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let sent: { method: string; url: string; body: unknown }[];
  let dispatchStates: Record<string, EntityDispatchStateDto>;
  let rooms: Record<string, object | null>;
  let registry: object;
  let ticketPatch: Partial<TicketDto>;
  let epicPatch: Partial<EpicDto>;
  let featurePatch: Partial<FeatureDto>;
  let taskDonePatch: Partial<TaskDto>;
  let campaignRowPatch: Partial<typeof CAMPAIGN_ROW>;
  let superseded: boolean;
  let failures: Record<string, { status: number; body: object }>;

  beforeEach(async () => {
    sent = [];
    registry = REGISTRY;
    ticketPatch = {};
    epicPatch = {};
    featurePatch = {};
    taskDonePatch = {};
    campaignRowPatch = {};
    superseded = false;
    failures = {};
    dispatchStates = {
      t1: stateOf(),
      e1: stateOf({ entityId: 'e1', archetype: 'EPIC', status: 'REFINED', nextPhase: 'implement' }),
      c1: stateOf({ entityId: 'c1', archetype: 'CAMPAIGN', status: 'REFINED', nextPhase: 'start' }),
    };
    rooms = {};
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree(PLATFORM),
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: () => ({
            onopen: null,
            onmessage: null,
            onerror: null,
            close: () => undefined,
          }),
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  function respond(request: TestRequest): unknown {
    const { method, url } = request.request;
    if (url === '/projects/api/projects') {
      return {
        entries: [{ project: { id: 'p1', name: 'Qits', slug: 'qits', description: null } }],
      };
    }
    const progress = {
      progress: {
        campaign: {
          id: 'c1',
          qualifiedId: 'qits-430',
          title: 'Rename qits-x',
          status: 'REFINED',
          start: null,
        },
        evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
        members: [],
      },
    };
    if (url === '/projects/api/work/qits-430' && method === 'GET') {
      return {
        ...workOfCampaign({ ...CAMPAIGN_ROW, ...campaignRowPatch }),
        slug: CAMPAIGN.slug,
        description: CAMPAIGN.description,
      };
    }
    if (url === '/projects/api/work/qits-430/members') return { members: CAMPAIGN.members };
    if (url === '/projects/api/work/qits-430/progress') return progress;
    const status = /^\/projects\/api\/work\/([^/]+)\/status$/.exec(url);
    if (status && method === 'POST') {
      const target = (request.request.body as { target: string }).target;
      const id = ID_OF[status[1]];
      if (id === 't1')
        return { ...workOfTicket({ ...TICKET, status: target }), statusBefore: TICKET.status };
      if (id === 'c1') return { ...workOfCampaign({ ...CAMPAIGN_ROW, status: target }) };
      if (target === 'SUPERSEDED') {
        superseded = true;
        return {
          ...workOfEpic({ ...EPIC, status: 'DROPPED', supersededByEpicId: SUCCESSOR.id }),
          statusBefore: EPIC.status,
        };
      }
      return { ...workOfEpic({ ...EPIC, status: target }), statusBefore: EPIC.status };
    }
    const work = workAnswer(
      'p1',
      {
        epics: [
          {
            epic: { ...EPIC, ...epicPatch },
            features: [
              {
                feature: { ...FEATURE, ...featurePatch },
                tasks: [{ ...TASK_DONE, ...taskDonePatch }, TASK_OPEN],
              },
            ],
          },
          ...(superseded ? [SUCCESSOR] : []),
        ],
        tickets: [{ ...TICKET, ...ticketPatch }],
        campaigns: [{ ...CAMPAIGN_ROW, ...campaignRowPatch }],
      },
      url,
      method,
    );
    if (work) return work;
    if (url === '/projects/api/work/archetypes') return registry;
    if (url === '/projects/api/projects/p1/repositories') {
      return {
        entries: [{ repository: { id: 'r1', name: 'qits-projects-frontend' }, declared: true }],
        wrapper: null,
      };
    }
    const dispatch = /^\/projects\/api\/work\/([^/]+)\/dispatch$/.exec(url);
    if (dispatch && method === 'GET') return { state: dispatchStates[ID_OF[dispatch[1]]] };
    if (dispatch && method === 'POST' && ID_OF[dispatch[1]] === 'c1') {
      return {
        progress: {
          campaign: {
            id: 'c1',
            qualifiedId: 'qits-430',
            title: 'Rename qits-x',
            status: 'REFINED',
            start: null,
          },
          evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
          members: [],
        },
      };
    }
    if (dispatch && method === 'POST') {
      const mode = (request.request.body as { mode: string }).mode;
      return {
        dispatch: {
          entityId: ID_OF[dispatch[1]],
          archetype: 'TICKET',
          phase: 'refine',
          mode,
          workspaceRowId: 7,
          repositoryId: 'wrapper',
          branch: 'ticket/cancelled-badge',
          fresh: true,
          agentLaunch: 'SCHEDULED',
        },
      };
    }
    const room = /^\/projects\/api\/work\/([^/]+)\/refinement$/.exec(url);
    if (room && method === 'GET') return { refinement: rooms[ID_OF[room[1]]] ?? null };
    if (room && method === 'POST') return { refinement: { id: 9, entityId: ID_OF[room[1]] } };
    if (/\/audit$/.test(url)) {
      return {
        entries: [
          {
            id: 'a1',
            entityType: 'TASK',
            entityId: 'k1',
            epicId: 'e1',
            operation: 'UPDATE',
            changedBy: 'agent',
            changedAt: AT,
            snapshot: null,
          },
          {
            id: 'a2',
            entityType: 'EPIC',
            entityId: 'e1',
            epicId: 'e1',
            operation: 'CREATE',
            changedBy: 'kim',
            changedAt: AT,
            snapshot: null,
          },
        ],
      };
    }
    if (/\/dossier$/.test(url)) return { pages: [] };
    if (/\/comments$/.test(url)) {
      return {
        entries: [
          {
            comment: {
              id: 'c1',
              entityId: 't1',
              author: 'kim',
              body: 'Reproduced on **dev**.',
              createdAt: AT,
              updatedAt: AT,
            },
          },
        ],
      };
    }
    if (url === '/projects/api/work/transition') return {};
    if (method === 'PATCH' && /^\/projects\/api\/work\/[^/]+$/.test(url)) return {};
    const blocked = /^\/projects\/api\/work\/([^/]+)\/blocked$/.exec(url);
    if (blocked && method === 'POST') {
      const body = request.request.body as { blocked: boolean };
      const id = ID_OF[blocked[1]];
      const archetype = id === 'e1' ? 'EPIC' : id === 'c1' ? 'CAMPAIGN' : 'TICKET';
      if (id === 'e1') epicPatch = { blocked: body.blocked };
      if (id === 't1') ticketPatch = { blocked: body.blocked };
      if (id === 'c1') campaignRowPatch = { blocked: body.blocked };
      return {
        block: { entityId: id, archetype, status: 'REFINED', blocked: body.blocked },
      };
    }
    throw new Error(`unanswered ${method} ${url}`);
  }

  /** Answer everything pending, and whatever that sets off, until the page is quiet. */
  async function serve(): Promise<void> {
    for (let round = 0; round < 12; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const pending = http.match(() => true);
      if (pending.length === 0) {
        await harness.fixture.whenStable();
        harness.detectChanges();
        continue;
      }
      for (const request of pending) {
        sent.push({
          method: request.request.method,
          url: request.request.url,
          body: request.request.body,
        });
        const failure = failures[`${request.request.method} ${request.request.url}`];
        if (failure) {
          request.flush(failure.body, { status: failure.status, statusText: 'Refused' });
        } else {
          request.flush(respond(request) as object);
        }
      }
    }
    harness.detectChanges();
  }

  async function open(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await serve();
  }

  function element(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent ?? '';
  }

  function button(selector: string): HTMLButtonElement {
    const host = element().querySelector(selector);
    const found = host?.querySelector('button') ?? (host as HTMLButtonElement | null);
    expect(found, `no button at ${selector}`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  function writes(): { method: string; url: string; body: unknown }[] {
    return sent.filter((request) => request.method !== 'GET');
  }

  describe('the frame', () => {
    it('resolves the qualified number across the project and draws a ticket', async () => {
      await open('/qits/work/qits-41');

      expect(element().querySelector('h1')?.textContent).toContain(
        'The cancelled badge is the wrong colour',
      );
      expect(element().querySelector('.qualified')?.textContent).toBe('qits-41');
      expect(element().querySelector('.status')?.textContent).toContain('reported');
      expect(element().querySelector('.impetus')?.textContent).toContain('run badge');
      // The ticket's thread is its body.
      expect(text()).toContain('Reproduced on dev.');
    });

    it('reads the bare number as well as the qualified form', async () => {
      await open('/qits/work/41');

      expect(element().querySelector('h1')?.textContent).toContain('cancelled badge');
    });

    it('says so for a number the project does not hold', async () => {
      await open('/qits/work/qits-999');

      expect(text()).toContain('This project has no entity numbered 999.');
      expect(element().querySelector('h1')).toBeNull();
    });

    it('draws an epic’s feature/task tree with the implemented markers', async () => {
      await open('/qits/work/qits-12');

      const rows = Array.from(element().querySelectorAll<HTMLElement>('.tree .row'));
      expect(rows.map((row) => row.querySelector('.qualified')?.textContent)).toEqual([
        'qits-13',
        'qits-14',
        'qits-15',
      ]);
      expect(
        rows.map((row) => row.querySelector('.implemented-marker')?.textContent?.trim()),
      ).toEqual(['open', 'implemented', 'open']);
      expect(rows[1].querySelector('.repo')?.textContent).toBe('qits-projects-frontend');
      expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/qits/work/qits-14');
      expect(element().querySelector('.description strong')?.textContent).toBe('two');
    });

    /** Features and tasks get a page for the first time: parent, children, repository, history. */
    it('draws a feature’s page: its epic as parent and its tasks as children', async () => {
      await open('/qits/work/qits-13');

      expect(element().querySelector('.parent a')?.getAttribute('href')).toBe('/qits/work/qits-12');
      expect(element().querySelectorAll('.tree .row')).toHaveLength(2);
      // No lifecycle, so no dispatching actions — the registry says so, not a list here.
      expect(element().querySelector('.flow')).toBeNull();
      expect(element().querySelector('.marker')?.textContent).toContain('open');
    });

    /**
     * qits-763: once the registry gives a feature and a task a lifecycle, their badge is the status —
     * not the marker — and the Dispatch/Refine surface still does not appear, because `mayBeRoot`
     * stays false for both even though "has a lifecycle" no longer says so.
     */
    it('draws a feature’s own status once the registry serves one, with no dispatching actions', async () => {
      registry = REGISTRY_WITH_FEATURE_LIFECYCLE;
      featurePatch = { status: 'REFINED' };

      await open('/qits/work/qits-13');

      expect(element().querySelector('.status')?.textContent).toContain('refined');
      expect(element().querySelector('.marker')).toBeNull();
      expect(element().querySelector('.flow')).toBeNull();
    });

    it('draws a task’s own status in the epic’s tree once the registry serves one', async () => {
      registry = REGISTRY_WITH_FEATURE_LIFECYCLE;
      taskDonePatch = { status: 'VERIFIED' };

      await open('/qits/work/qits-12');

      const rows = Array.from(element().querySelectorAll<HTMLElement>('.tree .row'));
      expect(
        rows.map((row) => row.querySelector('.implemented-marker')?.textContent?.trim()),
      ).toEqual(['open', 'verified', 'open']);
    });

    it('draws a task’s page: its repository, its dependency and its own history only', async () => {
      await open('/qits/work/qits-15');

      expect(element().querySelector('.repository')?.textContent).toBe('qits-projects-frontend');
      expect(element().querySelector('.depends-on a')?.getAttribute('href')).toBe(
        '/qits/work/qits-14',
      );
      expect(element().querySelector('.parent a')?.textContent).toContain('qits-13');
      // The audit subtree is the epic's; a task's page picks out its own rows (none for k2).
      expect(sent.some((request) => request.url === '/projects/api/work/qits-12/audit')).toBe(true);
      expect(element().querySelectorAll('.audit-entry')).toHaveLength(0);
    });

    it('shows an epic its whole audit subtree', async () => {
      await open('/qits/work/qits-12');

      expect(element().querySelectorAll('.audit-entry')).toHaveLength(2);
    });

    it('links back to the desk filtered to the node’s archetype', async () => {
      await open('/qits/work/qits-41');

      expect(element().querySelector('.back a')?.getAttribute('href')).toBe(
        '/qits/work?archetype=ticket',
      );
    });
  });

  describe('the three actions', () => {
    it('posts Dispatch as FLOW and Run the next phase as PHASE to the entity door', async () => {
      await open('/qits/work/qits-41');

      button('.dispatch').click();
      await serve();
      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/projects/api/work/qits-41/dispatch',
        body: { mode: 'FLOW' },
      });
      expect(element().querySelector('.dispatched a')?.getAttribute('href')).toContain(
        'repositories/wrapper/workspaces/7',
      );

      sent = [];
      button('.next-phase').click();
      await serve();
      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/projects/api/work/qits-41/dispatch',
        body: { mode: 'PHASE' },
      });
      expect(text()).toContain('stopping after it');
      expect(sent.some((request) => request.url.includes('dispatch-agent'))).toBe(false);
    });

    it('says which phase a press starts, as the dispatch state names it', async () => {
      await open('/qits/work/qits-12');

      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'starts the implement phase',
      );
    });

    it('disables both dispatching presses where the state says nothing is dispatchable', async () => {
      dispatchStates['t1'] = stateOf({ status: 'VERIFIED', nextPhase: null, dispatchable: false });
      await open('/qits/work/qits-41');

      expect(button('.dispatch').disabled).toBe(true);
      expect(button('.next-phase').disabled).toBe(true);
      expect(button('.refine').disabled).toBe(true);
      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'Nothing to dispatch at verified',
      );
    });

    /**
     * qits-887: implement starts from READY_FOR_DEV, and REFINED starts nothing. The page maps no
     * status to a phase itself — both answers are the dispatch state's, drawn as served.
     */
    it('enables Dispatch on a READY_FOR_DEV epic the state calls dispatchable', async () => {
      epicPatch = { status: 'READY_FOR_DEV' };
      dispatchStates['e1'] = stateOf({
        entityId: 'e1',
        archetype: 'EPIC',
        status: 'READY_FOR_DEV',
        nextPhase: 'implement',
      });
      await open('/qits/work/qits-12');

      expect(button('.dispatch').disabled).toBe(false);
      expect(button('.next-phase').disabled).toBe(false);
      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'starts the implement phase',
      );
    });

    /**
     * qits-1075: a person's FLOW press at an unblocked REFINED is no longer refused — it schedules
     * the ticket (REFINED → READY_FOR_DEV, as that person) and starts implementing, rather than
     * starting a phase. So `dispatchable` turns true there while `nextPhase` stays null: Dispatch
     * reads `dispatchable` alone and turns on, Run the next phase additionally wants a phase and
     * stays off.
     */
    it('enables Dispatch but not Run the next phase on an unblocked refined entity', async () => {
      dispatchStates['e1'] = stateOf({
        entityId: 'e1',
        archetype: 'EPIC',
        status: 'REFINED',
        nextPhase: null,
        dispatchable: true,
      });
      await open('/qits/work/qits-12');

      expect(button('.dispatch').disabled).toBe(false);
      expect(button('.next-phase').disabled).toBe(true);
      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'A press schedules it and starts implementing.',
      );
    });

    it('says there is nothing to dispatch at a blocked refined entity', async () => {
      dispatchStates['e1'] = stateOf({
        entityId: 'e1',
        archetype: 'EPIC',
        status: 'REFINED',
        nextPhase: null,
        dispatchable: false,
        blocked: true,
      });
      await open('/qits/work/qits-12');

      expect(button('.dispatch').disabled).toBe(true);
      expect(button('.next-phase').disabled).toBe(true);
      expect(element().querySelector('.flow-note')?.textContent).toContain('Blocked');
    });

    it('disables them for a blocked ticket and says why', async () => {
      dispatchStates['t1'] = stateOf({ blocked: true, dispatchable: false });
      await open('/qits/work/qits-41');

      expect(button('.dispatch').disabled).toBe(true);
      expect(button('.next-phase').disabled).toBe(true);
      expect(element().querySelector('.flow-note')?.textContent).toContain('Blocked');
    });

    /**
     * qits-1075: `preApprovedBy` names the person whose FLOW press on REPORTED pre-approved
     * scheduling — it is the more specific story and reads ahead of the generic dispatch/phase note.
     */
    it('shows who pre-approved it when the dispatch state names them', async () => {
      dispatchStates['t1'] = stateOf({ preApprovedBy: 'pat' });
      await open('/qits/work/qits-41');

      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'Pre-approved by pat: the platform schedules it once refined.',
      );
    });

    it('opens a refinement room through the entity door, then goes there', async () => {
      await open('/qits/work/qits-41');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      expect(button('.refine').disabled).toBe(false);
      button('.refine').click();
      await serve();

      expect(writes()).toEqual([
        { method: 'POST', url: '/projects/api/work/qits-41/refinement', body: null },
      ]);
      expect(navigate).toHaveBeenCalledWith(['/', 'qits', 'work', 'qits-41', 'refinement']);
    });

    /** Refinement is the REPORTED phase: past it, Refine is off unless a room already stands. */
    it('offers Refine only where the next phase is refine, or where a room already stands', async () => {
      await open('/qits/work/qits-12');
      expect(button('.refine').disabled).toBe(true);
      expect(button('.refine').textContent?.trim()).toBe('Refine');

      rooms['e1'] = { id: 3, entityId: 'e1' };
      await harness.navigateByUrl('/qits/work/qits-41');
      await serve();
      await harness.navigateByUrl('/qits/work/qits-12');
      await serve();

      expect(button('.refine').disabled).toBe(false);
      expect(button('.refine').textContent?.trim()).toBe('Open refinement');
    });
  });

  /**
   * Block and Unblock are offered on every lifecycle archetype now — an epic and a campaign as well
   * as a ticket — through the one entity door, `POST /entities/{id}/blocked`.
   */
  describe('blocking', () => {
    it('offers Block on an epic with a next phase, the same as on a ticket', async () => {
      await open('/qits/work/qits-12');

      expect(buttonNamed('Block')).toBeTruthy();
    });

    it('does not offer Block on a feature or a task, which have no lifecycle', async () => {
      await open('/qits/work/qits-13');
      expect(element().querySelectorAll('qits-button.block, qits-button.unblock')).toHaveLength(0);

      await harness.navigateByUrl('/qits/work/qits-15');
      await serve();
      expect(element().querySelectorAll('qits-button.block, qits-button.unblock')).toHaveLength(0);
    });

    it('does not offer Block where the dispatch state names no next phase', async () => {
      dispatchStates['e1'] = stateOf({
        entityId: 'e1',
        archetype: 'EPIC',
        status: 'DONE',
        nextPhase: null,
      });
      await open('/qits/work/qits-12');

      expect(element().querySelectorAll('qits-button.block, qits-button.unblock')).toHaveLength(0);
    });

    it('blocks an epic through the entity door, carrying the reason, and refreshes', async () => {
      await open('/qits/work/qits-12');

      buttonNamed('Block').click();
      harness.detectChanges();
      const note = element().querySelector<HTMLTextAreaElement>('.block-note')!;
      note.value = 'Waiting on a design decision.';
      note.dispatchEvent(new Event('input'));
      harness.detectChanges();
      sent = [];
      button('.send-block').click();
      await serve();

      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/projects/api/work/qits-12/blocked',
        body: { blocked: true, reason: 'Waiting on a design decision.' },
      });
      // The reload after the write is what draws the badge — the write itself answers only the flag.
      expect(element().querySelector('.badges .blocked')).toBeTruthy();
      expect(buttonNamed('Unblock')).toBeTruthy();
    });

    it('shows the blocked badge for a blocked campaign, offers Unblock and sends no reason to unblock', async () => {
      campaignRowPatch = { blocked: true };
      await open('/qits/work/qits-430');

      expect(element().querySelector('.badges .blocked')).toBeTruthy();
      buttonNamed('Unblock').click();
      harness.detectChanges();
      sent = [];
      button('.send-block').click();
      await serve();

      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/projects/api/work/qits-430/blocked',
        body: { blocked: false, reason: '' },
      });
    });
  });

  describe('moves and edits', () => {
    it('moves a ticket through its lifecycle door, never the multi-entity transition', async () => {
      await open('/qits/work/qits-41');

      buttonNamed('Mark refined').click();
      await serve();

      expect(writes()).toEqual([
        { method: 'POST', url: '/projects/api/work/qits-41/status', body: { target: 'REFINED' } },
      ]);
    });

    it('moves an epic through the epic lifecycle door', async () => {
      await open('/qits/work/qits-12');

      buttonNamed('Mark implemented').click();
      await serve();

      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/projects/api/work/qits-12/status',
          body: { target: 'IMPLEMENTED' },
        },
      ]);
    });

    /**
     * The supersede is the status door's `SUPERSEDED`: the epic lands DROPPED naming its successor,
     * and the page goes there once the project is read again.
     */
    it('supersedes an epic on a second press, and goes to the successor its answer names', async () => {
      await open('/qits/work/qits-12');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      buttonNamed('Supersede').click();
      await serve();
      expect(writes()).toEqual([]);
      buttonNamed('Confirm supersede?').click();
      await serve();

      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/projects/api/work/qits-12/status',
          body: { target: 'SUPERSEDED' },
        },
      ]);
      expect(navigate).toHaveBeenCalledWith(['/', 'qits', 'work', 'qits-99']);
    });

    /** The moves are the registry's `transitions`, labelled by kind — none held by this client. */
    it('offers a refined ticket the step forward as primary, the step back and the drop', async () => {
      ticketPatch = { status: 'REFINED' };
      await open('/qits/work/qits-41');

      const moves = Array.from(element().querySelectorAll('qits-button.move'));
      expect(moves.map((host) => host.textContent?.trim())).toEqual([
        'Mark implemented',
        'Back to reported',
        'Drop',
      ]);
      expect(moves[0].classList).toContain('forward');
      expect(moves[1].classList).toContain('back');
      expect(element().querySelector('.final-note')).toBeNull();
    });

    it('offers a done ticket no move at all, and says it is final', async () => {
      ticketPatch = { status: 'DONE' };
      await open('/qits/work/qits-41');

      expect(element().querySelectorAll('qits-button.move').length).toBe(0);
      expect(text()).not.toContain('Mark verified');
      expect(element().querySelector('.final-note')?.textContent).toContain('Done — final.');
    });

    it('offers a dropped ticket the reopen', async () => {
      ticketPatch = { status: 'DROPPED' };
      await open('/qits/work/qits-41');

      const moves = Array.from(element().querySelectorAll('qits-button.move'));
      expect(moves.map((host) => host.textContent?.trim())).toEqual(['Reopen']);
    });

    /** An older server mid-rollout: no guess and no hardcoded fallback. */
    it('offers no move where the registry serves no transitions', async () => {
      registry = {
        ...REGISTRY,
        archetypes: REGISTRY.archetypes.map(({ transitions: _transitions, ...rest }) => rest),
      };
      await open('/qits/work/qits-41');

      expect(element().querySelectorAll('qits-button.move').length).toBe(0);
      expect(element().querySelector('.final-note')).toBeNull();
      expect(buttonNamed('Edit')).toBeTruthy();
    });

    /** The retired PUT is replaced by a restatement of the whole row, emptied boxes clearing. */
    it('saves an edit as a restatement on the transition door, and sends no PUT', async () => {
      await open('/qits/work/qits-41');

      buttonNamed('Edit').click();
      harness.detectChanges();
      const title = element().querySelector<HTMLInputElement>('.edit-title')!;
      title.value = 'Renamed';
      title.dispatchEvent(new Event('input'));
      const assignee = element().querySelector<HTMLInputElement>('.edit-assignee')!;
      assignee.value = '  ';
      assignee.dispatchEvent(new Event('input'));
      harness.detectChanges();
      button('.save').click();
      await serve();

      expect(sent.some((request) => request.method === 'PUT')).toBe(false);
      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/projects/api/work/transition',
          body: {
            t1: {
              archetype: 'TICKET',
              membership: { parent: null },
              title: 'Renamed',
              status: 'REPORTED',
              ticketType: 'BUG',
              impetus: 'The run badge shows success when a run is cancelled.',
            },
          },
        },
      ]);
    });

    it('offers only bug and improvement on an ordinary ticket', async () => {
      await open('/qits/work/qits-41');

      buttonNamed('Edit').click();
      harness.detectChanges();
      const options = Array.from(
        element().querySelectorAll<HTMLOptionElement>('.edit-type option'),
      );
      expect(options.map((option) => option.value)).toEqual(['BUG', 'IMPROVEMENT']);
    });

    it('offers maintenance too, as the opt-out, on a ticket that already carries it', async () => {
      ticketPatch = { type: 'MAINTENANCE' };
      await open('/qits/work/qits-41');

      buttonNamed('Edit').click();
      harness.detectChanges();
      const options = Array.from(
        element().querySelectorAll<HTMLOptionElement>('.edit-type option'),
      );
      expect(options.map((option) => option.value)).toEqual(['BUG', 'IMPROVEMENT', 'MAINTENANCE']);
    });

    it('keeps a task’s place among its siblings when it is edited', async () => {
      await open('/qits/work/qits-15');

      buttonNamed('Edit').click();
      harness.detectChanges();
      button('.save').click();
      await serve();

      const body = writes()[0].body as Record<string, { membership: unknown; dependsOn: string }>;
      expect(body['k2'].membership).toEqual({ parent: 'f1', position: 1 });
      expect(body['k2'].dependsOn).toBe('k1');
    });
  });
  /**
   * qits-887: the assignee is drawn and edited wherever the registry permits `ASSIGNEE` — an epic
   * too, once the service says so — never by archetype.
   */
  describe('the assignee', () => {
    const permittingEpic = () => ({
      ...REGISTRY,
      archetypes: REGISTRY.archetypes.map((entry) =>
        entry.archetype === 'EPIC'
          ? { ...entry, permitted: [...entry.permitted, 'ASSIGNEE'] }
          : entry,
      ),
    });

    it('draws an epic’s assignee where the registry permits it', async () => {
      registry = permittingEpic();
      epicPatch = { assignee: 'coding-agent-7' };
      await open('/qits/work/qits-12');

      expect(element().querySelector('.assignee')?.textContent).toBe('coding-agent-7');
      expect(element().querySelector('.reporter')).toBeNull();
    });

    it('draws no assignee on an archetype the registry does not permit one', async () => {
      epicPatch = { assignee: 'coding-agent-7' };
      await open('/qits/work/qits-12');

      expect(element().querySelector('.assignee')).toBeNull();
      buttonNamed('Edit').click();
      harness.detectChanges();
      expect(element().querySelector('.edit-assignee')).toBeNull();
    });

    it('edits an epic’s assignee, and a restatement keeps one it did not touch', async () => {
      registry = permittingEpic();
      epicPatch = { assignee: 'coding-agent-7' };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      expect(element().querySelector<HTMLInputElement>('.edit-assignee')!.value).toBe(
        'coding-agent-7',
      );
      button('.save').click();
      await serve();
      expect((writes()[0].body as Record<string, Record<string, unknown>>)['e1']['assignee']).toBe(
        'coding-agent-7',
      );

      sent = [];
      buttonNamed('Edit').click();
      harness.detectChanges();
      const box = element().querySelector<HTMLInputElement>('.edit-assignee')!;
      box.value = 'kim';
      box.dispatchEvent(new Event('input'));
      harness.detectChanges();
      button('.save').click();
      await serve();
      expect((writes()[0].body as Record<string, Record<string, unknown>>)['e1']['assignee']).toBe(
        'kim',
      );
    });
  });

  /**
   * qits-887: the acceptance criteria — drawn and edited only where the registry permits them, saved
   * whole through the merge patch, closed from READY_FOR_DEV on; and a gated move says so.
   */
  describe('acceptance criteria', () => {
    function type(selector: string, value: string, index = 0): void {
      const input = element().querySelectorAll<HTMLInputElement>(selector)[index];
      expect(input, `no input at ${selector}[${index}]`).toBeTruthy();
      input.value = value;
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
    }

    function criteriaBoxes(): string[] {
      return Array.from(element().querySelectorAll<HTMLInputElement>('.edit-criterion')).map(
        (input) => input.value,
      );
    }

    it('draws nothing, and edits nothing, where the registry does not permit them', async () => {
      epicPatch = { acceptanceCriteria: ['It reads one desk.'] };
      await open('/qits/work/qits-12');

      expect(element().querySelector('.criteria')).toBeNull();
      buttonNamed('Edit').click();
      harness.detectChanges();
      expect(element().querySelector('.criteria-editor')).toBeNull();
    });

    it('draws each item as inline markdown where the registry permits them', async () => {
      registry = REGISTRY_887;
      epicPatch = { acceptanceCriteria: ['It reads **one** desk.', '1. stays a sentence'] };
      await open('/qits/work/qits-12');

      const items = Array.from(element().querySelectorAll('.criteria .criterion'));
      expect(items.length).toBe(2);
      expect(items[0].querySelector('strong')?.textContent).toBe('one');
      expect(items[1].querySelector('ol, p')).toBeNull();
      expect(items[1].textContent?.trim()).toBe('1. stays a sentence');
    });

    it('says when there are none yet', async () => {
      registry = REGISTRY_887;
      await open('/qits/work/qits-41');

      expect(element().querySelector('.criteria .absent')?.textContent).toContain('None yet');
    });

    it('saves the edited list whole through the merge patch, and the restatement keeps it', async () => {
      registry = REGISTRY_887;
      epicPatch = { acceptanceCriteria: ['First.', 'Second'] };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      expect(criteriaBoxes()).toEqual(['First.', 'Second']);
      type('.edit-criterion', 'First, edited.', 0);
      button('.criterion-add').click();
      harness.detectChanges();
      type('.edit-criterion', 'Third', 2);
      element().querySelectorAll<HTMLElement>('.criterion-up button')[2].click();
      harness.detectChanges();
      expect(criteriaBoxes()).toEqual(['First, edited.', 'Third', 'Second']);
      element().querySelectorAll<HTMLElement>('.criterion-remove button')[2].click();
      harness.detectChanges();
      button('.save').click();
      await serve();

      const [patch, restated] = writes();
      expect(patch).toEqual({
        method: 'PATCH',
        url: '/projects/api/work/qits-12',
        body: { acceptanceCriteria: ['First, edited.', 'Third'] },
      });
      expect(restated.url).toBe('/projects/api/work/transition');
      expect(
        (restated.body as Record<string, Record<string, unknown>>)['e1']['acceptanceCriteria'],
      ).toEqual(['First, edited.', 'Third']);
    });

    it('clears them with a null when every item is removed', async () => {
      registry = REGISTRY_887;
      epicPatch = { acceptanceCriteria: ['Only'] };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      button('.criterion-remove').click();
      harness.detectChanges();
      button('.save').click();
      await serve();

      expect(writes()[0]).toEqual({
        method: 'PATCH',
        url: '/projects/api/work/qits-12',
        body: { acceptanceCriteria: null },
      });
      expect('acceptanceCriteria' in (writes()[1].body as Record<string, object>)['e1']).toBe(
        false,
      );
    });

    it('sends no patch when the list is unchanged', async () => {
      registry = REGISTRY_887;
      epicPatch = { acceptanceCriteria: ['Only'] };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      button('.save').click();
      await serve();

      expect(writes().map((write) => write.method)).toEqual(['POST']);
    });

    it('says what is wrong with an item, and will not save it', async () => {
      registry = REGISTRY_887;
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      button('.criterion-add').click();
      harness.detectChanges();
      type('.edit-criterion', 'Two. Stops.');

      expect(element().querySelector('.criterion-problem')?.textContent).toBe(
        'This criterion has more than one “.”.',
      );
      expect(button('.save').disabled).toBe(true);
    });

    it('shows the service’s 400 as it worded it, and writes nothing more', async () => {
      registry = REGISTRY_887;
      failures['PATCH /projects/api/work/qits-12'] = {
        status: 400,
        body: { message: 'acceptanceCriteria[0]: fewer than 20 whitespace characters' },
      };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      button('.criterion-add').click();
      harness.detectChanges();
      type('.edit-criterion', 'Fine here');
      button('.save').click();
      await serve();

      expect(element().querySelector('.failed')?.textContent?.trim()).toBe(
        'acceptanceCriteria[0]: fewer than 20 whitespace characters',
      );
      expect(writes().map((write) => write.method)).toEqual(['PATCH']);
    });

    it('closes the editor from READY_FOR_DEV on, and patches nothing', async () => {
      registry = REGISTRY_887;
      epicPatch = { status: 'READY_FOR_DEV', acceptanceCriteria: ['Scheduled'] };
      await open('/qits/work/qits-12');

      buttonNamed('Edit').click();
      harness.detectChanges();
      const editor = element().querySelector<HTMLFieldSetElement>('.criteria-editor')!;
      expect(editor.disabled).toBe(true);
      expect(editor.querySelector('.frozen')?.textContent).toContain('Frozen at ready for dev');
      button('.save').click();
      await serve();

      expect(writes().map((write) => write.method)).toEqual(['POST']);
      expect(
        (writes()[0].body as Record<string, Record<string, unknown>>)['e1']['acceptanceCriteria'],
      ).toEqual(['Scheduled']);
    });

    it('hints a gated move’s gates beside it, and shows a gate’s 409 as worded', async () => {
      registry = REGISTRY_887;
      failures['POST /projects/api/work/qits-12/status'] = {
        status: 409,
        body: {
          message: 'epic e1 cannot move to READY_FOR_DEV: ACCEPTANCE_CRITERIA: it has none',
        },
      };
      await open('/qits/work/qits-12');

      expect(element().querySelector('.gate-hint')?.textContent?.trim()).toBe(
        'Mark ready for dev needs acceptance criteria, needs a person',
      );
      expect(element().querySelectorAll('.gate-hint').length).toBe(1);
      buttonNamed('Mark ready for dev').click();
      await serve();

      expect(element().querySelector('.failed')?.textContent?.trim()).toBe(
        'epic e1 cannot move to READY_FOR_DEV: ACCEPTANCE_CRITERIA: it has none',
      );
    });
  });

  /**
   * qits-419: a campaign resolves at its number like every other node, draws its own body, moves
   * through its own door, and its one press — Start — is asked twice because it authorises every
   * ungated dispatch in the campaign.
   */
  describe('a campaign', () => {
    it('resolves at :project/work/:number and draws the CAMPAIGN body', async () => {
      await open('/qits/work/qits-430');

      expect(element().querySelector('h1')?.textContent).toContain('Rename qits-x');
      expect(element().querySelector('.archetype')?.textContent).toContain('campaign');
      const body = element().querySelector('.body[data-archetype="CAMPAIGN"]');
      expect(body?.querySelector('app-campaign-members')).toBeTruthy();
      expect(body?.querySelector('.description strong')?.textContent).toBe('in order');
      expect(
        Array.from(body!.querySelectorAll('.member .qualified')).map((node) => node.textContent),
      ).toEqual(['qits-41', 'qits-12']);
      expect(body?.querySelector('.seeded')?.textContent).toBe('seeded');
      expect(sent.map((request) => request.url)).toContain('/projects/api/work/qits-430');
      // qits-420: the running view reads the progress, beside the members.
      expect(body?.querySelector('app-campaign-progress')).toBeTruthy();
      expect(sent.map((request) => request.url)).toContain('/projects/api/work/qits-430/progress');
    });

    it('re-reads the progress after its own start press', async () => {
      await open('/qits/work/qits-430');
      const before = sent.filter((request) => request.url.endsWith('/qits-430/progress')).length;

      buttonNamed('Start campaign').click();
      await serve();
      buttonNamed('Confirm start campaign?').click();
      await serve();

      expect(
        sent.filter((request) => request.url.endsWith('/qits-430/progress')).length,
      ).toBeGreaterThan(before);
    });

    it('offers Start, and not Run the next phase, Refine, Edit or Reshape', async () => {
      await open('/qits/work/qits-430');

      expect(buttonNamed('Start campaign').disabled).toBe(false);
      // Outside the comments thread: a campaign's own thread (qits-551) carries an "Edit" button
      // per comment, which is a different thing from editing the campaign's own fields — the fact
      // this test pins.
      const labels = Array.from(element().querySelectorAll('button'))
        .filter((node) => !node.closest('.comments'))
        .map((node) => node.textContent?.trim());
      for (const absent of [
        'Run the next phase',
        'Refine',
        'Open refinement',
        'Edit',
        'Reshape',
        'Dispatch',
      ]) {
        expect(labels).not.toContain(absent);
      }
      // A campaign has no refinement room, so none is looked for.
      expect(sent.some((request) => request.url.endsWith('/c1/refinement'))).toBe(false);
    });

    it('starts only on the confirm press, which names what it authorises', async () => {
      await open('/qits/work/qits-430');

      buttonNamed('Start campaign').click();
      await serve();
      expect(writes()).toEqual([]);
      expect(element().querySelector('.start-caption')?.textContent).toBe(
        'Start — this authorises every dispatch in this campaign that no approval gates',
      );

      buttonNamed('Confirm start campaign?').click();
      await serve();
      expect(writes()).toEqual([
        { method: 'POST', url: '/projects/api/work/qits-430/dispatch', body: { mode: 'FLOW' } },
      ]);
      expect(element().querySelector('.start-caption')).toBeNull();
      expect(element().querySelector('.dispatched')).toBeNull();
    });

    it('reads Re-check members once a start is live', async () => {
      dispatchStates['c1'] = stateOf({
        entityId: 'c1',
        archetype: 'CAMPAIGN',
        status: 'REFINED',
        nextPhase: 'recheck',
      });
      await open('/qits/work/qits-430');

      expect(buttonNamed('Re-check members')).toBeTruthy();
    });

    it('is not startable where the state says so', async () => {
      dispatchStates['c1'] = stateOf({
        entityId: 'c1',
        archetype: 'CAMPAIGN',
        status: 'REPORTED',
        nextPhase: 'start',
        dispatchable: false,
      });
      await open('/qits/work/qits-430');

      expect(buttonNamed('Start campaign').disabled).toBe(true);
    });

    /** qits-887: READY_FOR_DEV is a start's status too, as the dispatch state answers it. */
    it('offers Start on a READY_FOR_DEV campaign the state calls startable', async () => {
      campaignRowPatch = { status: 'READY_FOR_DEV' };
      dispatchStates['c1'] = stateOf({
        entityId: 'c1',
        archetype: 'CAMPAIGN',
        status: 'READY_FOR_DEV',
        nextPhase: 'start',
      });
      await open('/qits/work/qits-430');

      expect(buttonNamed('Start campaign').disabled).toBe(false);
      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'A press starts the campaign.',
      );
    });

    it('names both statuses a campaign starts from where it cannot start', async () => {
      dispatchStates['c1'] = stateOf({
        entityId: 'c1',
        archetype: 'CAMPAIGN',
        status: 'REPORTED',
        nextPhase: 'start',
        dispatchable: false,
      });
      await open('/qits/work/qits-430');

      expect(element().querySelector('.flow-note')?.textContent).toContain(
        'a campaign starts from refined or ready for dev',
      );
    });

    it('shows a non-admin’s 403 the way the dispatch press does', async () => {
      failures['POST /projects/api/work/qits-430/dispatch'] = {
        status: 403,
        body: { message: 'only an admin starts a campaign' },
      };
      await open('/qits/work/qits-430');

      buttonNamed('Start campaign').click();
      await serve();
      buttonNamed('Confirm start campaign?').click();
      await serve();

      expect(element().querySelector('.failed')?.textContent).toContain(
        '403 only an admin starts a campaign',
      );
    });

    it('moves its status through the campaign door, never the multi-entity transition', async () => {
      await open('/qits/work/qits-430');

      button('.move.forward').click();
      await serve();

      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/projects/api/work/qits-430/status',
          body: { target: 'IMPLEMENTED' },
        },
      ]);
    });
  });
});
