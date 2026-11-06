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
import { workAnswer, type WorkFixture } from '../../testing/work-fixtures';

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
      // qits-763: a feature carries a status of its own now, same as an epic or a ticket — and it
      // must still not become a desk filter root. `mayBeRoot: false` is what the filter actually
      // reads; `legalStatuses` is non-empty here precisely to prove the filter does not key off it.
      archetype: 'FEATURE',
      depth: 1,
      mayBeRoot: false,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: WORDS,
    },
    {
      archetype: 'TASK',
      depth: 2,
      mayBeRoot: false,
      required: [],
      requiredOnTransition: [],
      permitted: [],
      legalStatuses: WORDS,
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

const FIXTURE: WorkFixture = { epics: [EPIC], tickets: [TICKET, CLOSED] };

/**
 * **The one desk** (qits-397, ticket 521a0bda): every archetype on one page, with the archetype as a
 * filter in the query string — not two routes, not two tabs that are routes.
 *
 * <p>What is pinned: the unfiltered desk reads every archetype from the one listing and draws them in
 * one set of status sections, in the served order; a filter reads **only** its archetype's roots;
 * the filter's options come from the registry; and every row links to its node's page by the
 * qualified number.
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
    if (url === '/projects/api/work/archetypes') return REGISTRY;
    const work = workAnswer('p1', FIXTURE, url, request.request.method);
    if (work) return work;
    if (url === '/projects/api/projects/p1/repositories') return { entries: [], wrapper: null };
    if (/\/audit$/.test(url)) return { entries: [] };
    // Any entity's own thread (qits-551): the detail page renders it for every archetype.
    if (/\/comments$/.test(url)) return { entries: [] };
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

    expect(urls).toContain('/projects/api/projects/p1/work');
    // qits-1815: the desk is the listing and the project's workspaces in one read — never a read
    // per epic or ticket.
    expect(urls).toContain('/projects/api/projects/p1/work/workspaces');
    expect(urls.filter((url) => /\/work\/qits-(12|41|7)\b/.test(url))).toEqual([]);
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

    expect(urls).toContain('/projects/api/projects/p1/work/workspaces');
    expect(urls).not.toContain('/projects/api/work/qits-41');
    expect(urls).not.toContain('/projects/api/work/qits-12');
    expect(titles()).toEqual(['The cancelled badge']);
    expect(element().querySelector('app-new-ticket-form')).not.toBeNull();
  });

  it('offers the filter’s options from the registry’s root archetypes, even once features and tasks carry a status too (qits-763)', async () => {
    await open('/qits/work');

    const options = Array.from(element().querySelectorAll<HTMLAnchorElement>('.filter .option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual(['All', 'epics', 'tickets']);
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
