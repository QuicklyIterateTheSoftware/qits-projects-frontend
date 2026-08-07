import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks, type QitsNavLink } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * The navigation the layout is handed, standing in for the gateway's `/main-navigation`.
 *
 * `provideQitsNavigationLinks` rather than a flushed request, and the reason is not taste: an
 * `HttpClient` request contributes to application stability, so a `/main-navigation` nobody flushed
 * would keep `RouterTestingHarness.create()` from ever resolving. The literal source fetches
 * nothing, so a spec about routing does not have to know the navigation exists.
 */
const NAV: readonly QitsNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Events', href: '/events/' },
];

/**
 * The shell owns two things — the outlet, and the sub-menu it hands to the chrome — so those are
 * what is asserted here, plus the route table actually reaching the shared layout.
 */
describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function flushProjects(ids: readonly string[]): void {
    http.expectOne('/projects/api/projects').flush({
      entries: ids.map((id) => ({
        project: { id, name: id, slug: id, description: null, dns: null },
      })),
    });
  }

  it('is an outlet and a sub-menu, and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    // The sub-menu is a *template*: the shell renders none of it, and nothing inside it is even
    // built until a layout instantiates it — which is why the picker has asked for nothing here.
    expect(shell.querySelector('app-projects-nav')).toBeNull();
    expect(shell.querySelector('qits-main-layout')).toBeNull();
    http.verify();
  });

  it('routes the root URL to the shared layout', async () => {
    const harness = await RouterTestingHarness.create('/');
    flushProjects([]);
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('.qits-layout-brand')?.textContent).toContain('qits');
    // The count is this fixture's, and only this fixture's: how many front doors the platform has
    // is a deployment fact the gateway answers, so asserting it is qits-gateway's spec's job.
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(NAV.length);
    expect(layout.querySelector('.qits-layout-content router-outlet')).not.toBeNull();
  });

  /** A URL under `/projects/` with a shape no route claims is a 404 drawn inside the chrome. */
  it('draws an unknown URL as a page, not as a hand-off', async () => {
    const harness = await RouterTestingHarness.create('/p1/repositories/new/extra');
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.textContent).toContain('No such page here');
    // Nothing was fetched for it: a 404 asks the service nothing.
    http.verify();
  });
});
