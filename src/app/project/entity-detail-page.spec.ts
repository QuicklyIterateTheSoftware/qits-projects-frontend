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
import type { EntityDispatchStateDto, EpicDto, FeatureDto, TaskDto, TicketDto } from '../api/dto';
import { EVENT_SOURCE_FACTORY } from '../api/event-source';

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

function spec(archetype: string, legalStatuses: readonly string[], permitted: readonly string[]) {
  return {
    archetype,
    depth: archetype === 'TASK' ? 2 : archetype === 'FEATURE' ? 1 : 0,
    mayBeRoot: archetype === 'EPIC' || archetype === 'TICKET',
    required: ['TITLE'],
    requiredOnTransition: ['TITLE'],
    permitted,
    legalStatuses,
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
    spec('FEATURE', [], ['TITLE', 'SLUG', 'DESCRIPTION', 'IMPLEMENTED_AT', 'DEPENDS_ON']),
    spec(
      'TASK',
      [],
      ['TITLE', 'SLUG', 'DESCRIPTION', 'REPOSITORY_ID', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
    ),
  ],
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

  beforeEach(async () => {
    sent = [];
    dispatchStates = {
      t1: stateOf(),
      e1: stateOf({ entityId: 'e1', archetype: 'EPIC', status: 'REFINED', nextPhase: 'implement' }),
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
    if (url === '/projects/api/projects/p1/epics') return { entries: [{ epic: EPIC }] };
    if (url === '/projects/api/projects/p1/tickets') return { entries: [{ ticket: TICKET }] };
    if (url === '/projects/api/epics/e1/features') return { entries: [{ feature: FEATURE }] };
    if (url === '/projects/api/features/f1/tasks') {
      return { entries: [{ task: TASK_DONE }, { task: TASK_OPEN }] };
    }
    if (url === '/projects/api/entities/archetypes') return REGISTRY;
    if (url === '/projects/api/projects/p1/repositories') {
      return {
        entries: [{ repository: { id: 'r1', name: 'qits-projects-frontend' }, declared: true }],
        wrapper: null,
      };
    }
    const dispatch = /^\/projects\/api\/entities\/([^/]+)\/dispatch$/.exec(url);
    if (dispatch && method === 'GET') return { state: dispatchStates[dispatch[1]] };
    if (dispatch && method === 'POST') {
      const mode = (request.request.body as { mode: string }).mode;
      return {
        dispatch: {
          entityId: dispatch[1],
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
    const room = /^\/projects\/api\/entities\/([^/]+)\/refinement$/.exec(url);
    if (room && method === 'GET') return { refinement: rooms[room[1]] ?? null };
    if (room && method === 'POST') return { refinement: { id: 9, entityId: room[1] } };
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
              ticketId: 't1',
              author: 'kim',
              body: 'Reproduced on **dev**.',
              createdAt: AT,
              updatedAt: AT,
            },
          },
        ],
      };
    }
    if (url === '/projects/api/tickets/t1/transition') {
      return { ticket: { ...TICKET, status: (request.request.body as { target: string }).target } };
    }
    if (url === '/projects/api/epics/e1/transition') return { epic: EPIC, successor: null };
    if (url === '/projects/api/entities/transition') return {};
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
        request.flush(respond(request) as object);
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

    it('draws a task’s page: its repository, its dependency and its own history only', async () => {
      await open('/qits/work/qits-15');

      expect(element().querySelector('.repository')?.textContent).toBe('qits-projects-frontend');
      expect(element().querySelector('.depends-on a')?.getAttribute('href')).toBe(
        '/qits/work/qits-14',
      );
      expect(element().querySelector('.parent a')?.textContent).toContain('qits-13');
      // The audit subtree is the epic's; a task's page picks out its own rows (none for k2).
      expect(sent.some((request) => request.url === '/projects/api/epics/e1/audit')).toBe(true);
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
        url: '/projects/api/entities/t1/dispatch',
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
        url: '/projects/api/entities/t1/dispatch',
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

    it('disables them for a blocked ticket and says why', async () => {
      dispatchStates['t1'] = stateOf({ blocked: true, dispatchable: false });
      await open('/qits/work/qits-41');

      expect(button('.dispatch').disabled).toBe(true);
      expect(element().querySelector('.flow-note')?.textContent).toContain('Blocked');
    });

    it('opens a refinement room through the entity door, then goes there', async () => {
      await open('/qits/work/qits-41');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      expect(button('.refine').disabled).toBe(false);
      button('.refine').click();
      await serve();

      expect(writes()).toEqual([
        { method: 'POST', url: '/projects/api/entities/t1/refinement', body: {} },
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

  describe('moves and edits', () => {
    it('moves a ticket through its lifecycle door, never the multi-entity transition', async () => {
      await open('/qits/work/qits-41');

      buttonNamed('Mark refined').click();
      await serve();

      expect(writes()).toEqual([
        { method: 'POST', url: '/projects/api/tickets/t1/transition', body: { target: 'REFINED' } },
      ]);
    });

    it('moves an epic through the epic lifecycle door', async () => {
      await open('/qits/work/qits-12');

      buttonNamed('Mark implemented').click();
      await serve();

      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/projects/api/epics/e1/transition',
          body: { target: 'IMPLEMENTED' },
        },
      ]);
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
          url: '/projects/api/entities/transition',
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
});
