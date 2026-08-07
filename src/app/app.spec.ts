import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks, type QitsNavLink } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * The shell owns one thing — the outlet — so that is what is asserted here, plus the route table
 * actually reaching the shared layout behind it. What the layout itself renders is the
 * ui-components package's business; this only checks that this app mounts it.
 */

/**
 * The navigation the layout is handed, standing in for the gateway's `/main-navigation`.
 *
 * `provideQitsNavigationLinks` rather than `provideHttpClientTesting`, and the reason is not taste:
 * an `HttpClient` request contributes to application stability, so a `/main-navigation` nobody
 * flushed would keep `RouterTestingHarness.create()` from ever resolving. The literal source fetches
 * nothing, so a spec about routing does not have to know the navigation exists.
 */
const NAV: readonly QitsNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Events', href: '/events/' },
];

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideLocationMocks(), provideQitsNavigationLinks(NAV)],
    });
  });

  it('is an outlet and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('qits-main-layout')).toBeNull();
  });

  it('routes the root URL to the shared layout', async () => {
    const harness = await RouterTestingHarness.create('/');

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('.qits-layout-brand')?.textContent).toContain('qits');
    // The count is this fixture's, and only this fixture's. What the assertion proves is that the
    // app mounts the chrome and the chrome renders what it is told — how many doors the platform
    // really has is a deployment fact the gateway answers from its own route table, so asserting
    // that number is qits-gateway's spec's job, not this one's.
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(NAV.length);
    expect(layout.querySelector('.qits-layout-content router-outlet')).not.toBeNull();
  });
});
