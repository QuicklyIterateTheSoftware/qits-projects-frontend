import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsScope,
  QITS_NAVIGATION,
  toNavTree,
  type QitsNavigation,
  type QitsNavigationSource,
} from '@qits/ui-components';
import { routes } from '../app.routes';

/** The platform as the edge states it — with qits-ci publishing an api-docs path, or nothing. */
function navigation(apiDocs: boolean): QitsNavigation {
  return {
    environment: 'dev',
    origin: 'https://dev.example.test',
    slots: {
      'services.details': [
        {
          app: 'qits-ci',
          label: 'CI',
          host: 'ci',
          origin: 'https://ci.dev.example.test',
          path: '/ci',
          position: 2,
        },
      ],
    },
    applications: apiDocs ? { 'qits-ci': { apiDocs: '/ci/q/swagger-ui' } } : {},
  };
}

/**
 * The scope-aware wrapper around a service's own swagger-ui.
 *
 * <p>What is worth pinning is the composition and the three states around it: the frame's address
 * is the ENVIRONMENT origin plus the path the platform served for the repository in scope — never
 * this host, never a guess — and a repository without a published path gets words, not a frame
 * full of 404. The navigation failing is the third, distinct answer.
 */
describe('RepositoryApiDocsPage', () => {
  let harness: RouterTestingHarness;

  function configure(...providers: unknown[]): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The page reads the scope, never the route parameters — the platform's rule for every SPA.
        provideQitsScope('repository'),
        ...(providers as never[]),
      ],
    });
  }

  async function open(url = '/qits/services/qits-ci/api-docs'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await harness.fixture.whenStable();
    // Whatever the chrome around this page asked for is answered empty: none of it is under test.
    for (const request of TestBed.inject(HttpTestingController).match(() => true)) {
      request.flush({ entries: [] });
    }
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('frames the swagger-ui the platform names for the repository in scope', async () => {
    configure(provideQitsNavigationTree(navigation(true)));
    await open();

    const frame = page().querySelector<HTMLIFrameElement>('iframe.docs');
    // The environment origin on purpose: /<seg>/q/… is served there before, during and after a
    // host flip — never this application's own host.
    expect(frame?.getAttribute('src')).toBe('https://dev.example.test/ci/q/swagger-ui');
    expect(frame?.getAttribute('title')).toContain('qits-ci');
    // The escape hatch is the same URL, outside the frame.
    const escape = page().querySelector<HTMLAnchorElement>('a.open');
    expect(escape?.getAttribute('href')).toBe('https://dev.example.test/ci/q/swagger-ui');
    expect(escape?.getAttribute('target')).toBe('_blank');
  });

  it('says a repository without a published path has no documentation, with no frame', async () => {
    configure(provideQitsNavigationTree(navigation(false)));
    await open();

    expect(page().querySelector('iframe')).toBeNull();
    expect(page().textContent).toContain('qits-ci publishes no API documentation');
  });

  it('tells a broken navigation apart from a repository without docs', async () => {
    const source: QitsNavigationSource = {
      tree: signal(toNavTree(undefined)),
      failed: signal(true),
    };
    configure({ provide: QITS_NAVIGATION, useValue: source });
    await open();

    expect(page().querySelector('iframe')).toBeNull();
    expect(page().textContent).toContain('navigation is unavailable');
    expect(page().textContent).not.toContain('publishes no API documentation');
  });

  it('holds its words while the navigation is still being asked', async () => {
    const source: QitsNavigationSource = {
      tree: signal(undefined),
      failed: signal(false),
    };
    configure({ provide: QITS_NAVIGATION, useValue: source });
    await open();

    expect(page().querySelector('iframe')).toBeNull();
    expect(page().textContent).toContain('Loading the platform navigation');
  });

  it('is not an address outside the known categories', async () => {
    configure(provideQitsNavigationTree(navigation(true)));
    await open('/qits/epics/planning/api-docs');

    expect(page().querySelector('iframe')).toBeNull();
    expect(page().textContent).toContain('No such page here');
  });
});
