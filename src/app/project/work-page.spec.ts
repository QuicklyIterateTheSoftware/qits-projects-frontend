import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { EpicDto, TicketDto } from '../api/dto';
import { EVENT_SOURCE_FACTORY } from '../api/event-source';

const AT = '2026-09-07T09:00:00Z';
const WORDS = ['REPORTED', 'REFINED', 'IMPLEMENTED', 'VERIFIED', 'DONE', 'DROPPED'];

const REGISTRY = {
  properties: ['TITLE', 'STATUS'],
  serverOwned: [],
  archetypes: [
    {
      archetype: 'EPIC',
      depth: 0,
      mayBeRoot: true,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: WORDS,
    },
    {
      archetype: 'TICKET',
      depth: 0,
      mayBeRoot: true,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: WORDS,
    },
    {
      archetype: 'CAMPAIGN',
      depth: -1,
      mayBeRoot: true,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: WORDS,
    },
    {
      archetype: 'FEATURE',
      depth: 1,
      mayBeRoot: false,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: [],
    },
    {
      archetype: 'TASK',
      depth: 2,
      mayBeRoot: false,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: [],
    },
  ],
};

const EPIC: EpicDto = {
  id: 'e1',
  projectId: 'p1',
  title: 'One desk',
  slug: 'one-desk',
  description: null,
  number: 12,
  qualifiedId: 'qits-12',
  status: 'REPORTED',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const TICKET: TicketDto = {
  id: 't1',
  projectId: 'p1',
  title: 'The cancelled badge',
  slug: 'cancelled-badge',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REFINED',
  assignee: null,
  createdBy: 'kim',
  impetus: 'The run badge shows success when a run is cancelled.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const CAMPAIGN = {
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

const CLOSED: TicketDto = {
  ...TICKET,
  id: 't2',
  title: 'An old one',
  slug: 'old',
  number: 7,
  qualifiedId: 'qits-7',
  status: 'DONE',
};

/**
 * **The one desk** (qits-397, ticket 521a0bda): every archetype on one page, with the archetype as a
 * filter in the query string — not two routes, not two tabs that are routes.
 *
 * <p>What is pinned: the unfiltered desk reads both archetypes and draws them in one set of status
 * sections, in the served order; a filter reads **only** its archetype's endpoint; the filter's
 * options come from the registry; and every row links to its node's page by the qualified number.
 */
describe('WorkPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let urls: string[];
  let posts: { url: string; body: unknown }[];

  beforeEach(async () => {
    urls = [];
    posts = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
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

  function respond(request: TestRequest): object {
    const url = request.request.url;
    if (url === '/projects/api/projects') {
      return {
        entries: [{ project: { id: 'p1', name: 'Qits', slug: 'qits', description: null } }],
      };
    }
    if (url === '/projects/api/projects/p1/epics') return { entries: [{ epic: EPIC }] };
    if (url === '/projects/api/projects/p1/tickets') {
      return { entries: [{ ticket: TICKET }, { ticket: CLOSED }] };
    }
    if (url === '/projects/api/projects/p1/campaigns') {
      if (request.request.method === 'POST') {
        return {
          campaign: {
            ...CAMPAIGN,
            slug: 'rename-qits-x',
            description: null,
            status: 'REPORTED',
            start: null,
            members: [],
          },
        };
      }
      return { campaigns: [CAMPAIGN] };
    }
    if (url === '/projects/api/epics/e1/features') return { entries: [] };
    if (url === '/projects/api/entities/archetypes') return REGISTRY;
    // Whatever the campaign's own page reads once the create has gone there.
    if (url === '/projects/api/campaigns/c1') {
      return { campaign: { ...CAMPAIGN, slug: 'r', description: null, start: null, members: [] } };
    }
    if (url === '/projects/api/entities/c1/dispatch') {
      return { state: { entityId: 'c1', archetype: 'CAMPAIGN', status: 'REFINED', nextPhase: 'start', blocked: false, dispatchable: true, mode: null } };
    }
    if (url === '/projects/api/projects/p1/repositories') return { entries: [], wrapper: null };
    if (url === '/projects/api/campaigns/c1/progress') {
      return {
        progress: {
          campaign: { id: 'c1', qualifiedId: 'qits-430', title: 'Rename qits-x', status: 'REPORTED', start: null },
          evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
          members: [],
        },
      };
    }
    if (/\/audit$/.test(url)) return { entries: [] };
    throw new Error(`unanswered ${url}`);
  }

  async function serve(): Promise<void> {
    for (let round = 0; round < 8; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const request of http.match(() => true)) {
        urls.push(request.request.url);
        if (request.request.method === 'POST') {
          posts.push({ url: request.request.url, body: request.request.body });
        }
        request.flush(respond(request));
      }
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
  }

  async function open(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await serve();
  }

  function element(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function sections(): string[] {
    return Array.from(element().querySelectorAll<HTMLElement>('app-work-overview .group')).map(
      (group) => group.getAttribute('data-status') ?? '',
    );
  }

  function titles(): string[] {
    return Array.from(element().querySelectorAll<HTMLElement>('app-entity-card .title')).map(
      (title) => title.textContent?.trim() ?? '',
    );
  }

  it('draws every archetype on the one page, in status sections in the served order', async () => {
    await open('/qits/work');

    expect(urls).toContain('/projects/api/projects/p1/epics');
    expect(urls).toContain('/projects/api/projects/p1/tickets');
    expect(urls).toContain('/projects/api/projects/p1/campaigns');
    expect(sections()).toEqual(['REPORTED', 'REFINED', 'DONE']);
    expect(titles()).toEqual(['One desk', 'The cancelled badge', 'Rename qits-x']);
    // The endings are the record: collapsed, as rows rather than cards.
    expect(
      element().querySelector('details[data-status="DONE"] app-entity-summary-row'),
    ).not.toBeNull();
  });

  it('links every row to its node’s page by the qualified number', async () => {
    await open('/qits/work');

    const links = Array.from(
      element().querySelectorAll<HTMLAnchorElement>('app-work-overview a.qualified'),
    );
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/qits/work/qits-12',
      '/qits/work/qits-41',
      '/qits/work/qits-430',
      '/qits/work/qits-7',
    ]);
  });

  it('filters to one archetype on the same page, reading only that archetype', async () => {
    await open('/qits/work?archetype=ticket');

    expect(urls).toContain('/projects/api/projects/p1/tickets');
    expect(urls).not.toContain('/projects/api/projects/p1/epics');
    expect(urls).not.toContain('/projects/api/projects/p1/campaigns');
    expect(titles()).toEqual(['The cancelled badge']);
    expect(element().querySelector('app-new-ticket-form')).not.toBeNull();
    expect(element().querySelector('app-new-campaign-form')).toBeNull();
  });

  /** qits-419: a campaign is a root of work on the one desk, and `?archetype=campaign` reads only it. */
  it('lists campaigns on the desk, and filters to them reading only campaigns', async () => {
    await open('/qits/work?archetype=campaign');

    expect(urls).toContain('/projects/api/projects/p1/campaigns');
    expect(urls).not.toContain('/projects/api/projects/p1/epics');
    expect(urls).not.toContain('/projects/api/projects/p1/tickets');
    expect(titles()).toEqual(['Rename qits-x']);
    const card = element().querySelector('app-entity-card')!;
    expect(card.querySelector('.archetype')?.textContent).toContain('campaign');
    expect(card.querySelector('.progress')?.textContent).toBe('2 members · not started');
    // No reshape for a campaign: the multi-entity transition refuses one.
    expect(element().textContent).not.toContain('Reshape');
    expect(element().querySelector('app-new-campaign-form')).not.toBeNull();
    expect(element().querySelector('app-new-ticket-form')).toBeNull();
  });

  it('opens a new campaign from the desk and goes to its page', async () => {
    await open('/qits/work');

    const toggle = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === 'New campaign',
    )!;
    toggle.click();
    harness.detectChanges();
    const title = element().querySelector<HTMLInputElement>('.campaign-title')!;
    title.value = 'Rename qits-x';
    title.dispatchEvent(new Event('input'));
    harness.detectChanges();
    element().querySelector<HTMLButtonElement>('.create-campaign button')!.click();
    await serve();

    expect(posts).toEqual([
      { url: '/projects/api/projects/p1/campaigns', body: { title: 'Rename qits-x' } },
    ]);
    expect(TestBed.inject(Location).path()).toBe('/qits/work/qits-430');
  });

  it('offers the filter’s options from the registry’s lifecycle archetypes', async () => {
    await open('/qits/work');

    const options = Array.from(element().querySelectorAll<HTMLAnchorElement>('.filter .option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'All',
      'epics',
      'tickets',
      'campaigns',
    ]);
    expect(options[0].getAttribute('aria-current')).toBe('page');
    expect(options[2].getAttribute('href')).toBe('/qits/work?archetype=ticket');
  });

  it('switches the filter in place, as a query parameter', async () => {
    await open('/qits/work');

    element().querySelectorAll<HTMLAnchorElement>('.filter .option')[1].click();
    await serve();

    expect(TestBed.inject(Location).path()).toBe('/qits/work?archetype=epic');
    expect(titles()).toEqual(['One desk']);
  });

  /** One front desk agent, `project.work`, whatever the filter says (qits-403). */
  it('mounts one front desk agent at project.work, whatever the filter', async () => {
    for (const address of [
      '/qits/work',
      '/qits/work?archetype=epic',
      '/qits/work?archetype=ticket',
    ]) {
      await open(address);
      expect(element().querySelectorAll('app-refinement-panel')).toHaveLength(1);
      expect(element().textContent).toContain('Front desk agent');
      expect(element().textContent).not.toContain('Refinement agent');
      expect(element().textContent).not.toContain('Triage agent');
    }
    await open('/qits/work?archetype=epic');
    expect(element().querySelector('app-new-ticket-form')).toBeNull();
  });
});
