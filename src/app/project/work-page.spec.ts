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

  beforeEach(async () => {
    urls = [];
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
    if (url === '/projects/api/epics/e1/features') return { entries: [] };
    if (url === '/projects/api/entities/archetypes') return REGISTRY;
    throw new Error(`unanswered ${url}`);
  }

  async function serve(): Promise<void> {
    for (let round = 0; round < 8; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const request of http.match(() => true)) {
        urls.push(request.request.url);
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
    expect(sections()).toEqual(['REPORTED', 'REFINED', 'DONE']);
    expect(titles()).toEqual(['One desk', 'The cancelled badge']);
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
      '/qits/work/qits-7',
    ]);
  });

  it('filters to one archetype on the same page, reading only that archetype', async () => {
    await open('/qits/work?archetype=ticket');

    expect(urls).toContain('/projects/api/projects/p1/tickets');
    expect(urls).not.toContain('/projects/api/projects/p1/epics');
    expect(titles()).toEqual(['The cancelled badge']);
    expect(element().querySelector('app-new-ticket-form')).not.toBeNull();
  });

  it('offers the filter’s options from the registry’s lifecycle archetypes', async () => {
    await open('/qits/work');

    const options = Array.from(element().querySelectorAll<HTMLAnchorElement>('.filter .option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'All',
      'epics',
      'tickets',
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

  /** One front desk agent: its surface follows the filter, one mounted instance at a time. */
  it('mounts one front desk agent, at the surface the filter implies', async () => {
    await open('/qits/work?archetype=epic');
    expect(element().querySelectorAll('app-refinement-panel')).toHaveLength(1);
    expect(element().textContent).toContain('Refinement agent');
    expect(element().querySelector('app-new-ticket-form')).toBeNull();

    await open('/qits/work?archetype=ticket');
    expect(element().querySelectorAll('app-refinement-panel')).toHaveLength(1);
    expect(element().textContent).toContain('Triage agent');
  });
});
