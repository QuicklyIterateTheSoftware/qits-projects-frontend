import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from '../api/event-source';
import { routes } from '../app.routes';
import { ProjectParam, firstSegment, replaceFirstSegment } from './project-param';

/** jsdom has no `EventSource`, and the epics overview opens one on the project page. */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  close: () => undefined,
});

const PROJECTS = {
  entries: [
    { project: { id: 'p1', name: 'Qits', slug: 'qits', description: null, dns: null } },
    { project: { id: 'p2', name: 'Other', slug: 'other', description: null, dns: null } },
  ],
};

/**
 * The two URL helpers, asserted directly: they are pure, and every redirect below is built out of
 * them.
 */
describe('firstSegment / replaceFirstSegment', () => {
  it('reads the first segment, decoded, and nothing at the root', () => {
    expect(firstSegment('/qits/services/qits-ci')).toBe('qits');
    expect(firstSegment('/qits?tab=chat')).toBe('qits');
    expect(firstSegment('/a%20b/x')).toBe('a b');
    expect(firstSegment('/')).toBe('');
  });

  /** The query and the fragment travel, which is what makes a deep link survive the correction. */
  it('swaps the first segment and leaves the rest of the address exactly as it was', () => {
    expect(replaceFirstSegment('/p1/epics/e/refining?tab=chat#x', 'qits')).toBe(
      '/qits/epics/e/refining?tab=chat#x',
    );
    expect(replaceFirstSegment('/p1', 'qits')).toBe('/qits');
  });
});

/**
 * Which project the address names.
 *
 * <p>The whole point of this service is that the two vocabularies are kept apart: the URL says the
 * **slug**, every request says the **id**, and one place maps between them. The legacy arm is the
 * other half — every address this application wrote before the convention spelled the id, so those
 * are corrected rather than refused.
 */
describe('ProjectParam', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: SILENT },
        // A repository address routes to a page that reads the scope, so the scope has to exist.
        provideQitsScope('repository'),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  /** Open an address and answer the project list, which is what resolves the first segment. */
  async function open(url: string, list: object = PROJECTS): Promise<ProjectParam> {
    await harness.navigateByUrl(url);
    await settle();
    http.expectOne('/projects/api/projects').flush(list);
    await settle();
    return TestBed.inject(ProjectParam);
  }

  /** Everything the routed page asked for, answered with nothing — this spec is about the address. */
  function drain(): void {
    for (const request of http.match(() => true)) {
      request.flush({ entries: [], refinements: [] });
    }
  }

  it('resolves a slug to the id every request is keyed on, and leaves the address alone', async () => {
    const param = await open('/qits');
    drain();

    expect(param.projectId()).toBe('p1');
    expect(param.projectSlug()).toBe('qits');
    expect(param.currentProject()().kind).toBe('ready');
    expect(TestBed.inject(Router).url).toBe('/qits');
  });

  it('reads the segment through the rest of the path, not only at the project route', async () => {
    const param = await open('/other/services/qits-ci');
    drain();

    expect(param.projectId()).toBe('p2');
    expect(param.projectSlug()).toBe('other');
  });

  /**
   * The legacy arm: an id resolves, the page renders, and the URL is corrected **in place** — a
   * replace rather than a push, because the id form is not a place worth having in the back button.
   */
  it('redirects an id in the first segment to the slug, keeping the rest of the address', async () => {
    const param = await open('/p1/project-setup');
    drain();

    expect(TestBed.inject(Router).url).toBe('/qits/project-setup');
    expect(param.projectId()).toBe('p1');
    expect(param.projectSlug()).toBe('qits');
  });

  /** A segment naming nothing is a 404 the pages draw, and it costs no request of its own. */
  it('reports a segment that names no project, and asks for nothing on its behalf', async () => {
    const param = await open('/nope');

    expect(param.projectId()).toBe('');
    expect(param.projectSlug()).toBe('nope');
    expect(param.currentProject()().kind).toBe('error');
    http.verify();
  });

  /** A list that never answered is pending, not wrong: the address may well name a real project. */
  it('stays pending when the list could not be read', async () => {
    await harness.navigateByUrl('/qits');
    await settle();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    const param = TestBed.inject(ProjectParam);
    expect(param.currentProject()().kind).toBe('error');
    expect(param.projectId()).toBe('');
    expect(param.projectSlug()).toBe('qits');
    http.verify();
  });
});
