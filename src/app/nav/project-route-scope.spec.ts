import { provideLocationMocks } from '@angular/common/testing';
import { ApplicationRef, ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { ProjectRouteScope } from './project-route-scope';

/** A destination for the router to land on, so a URL can be asserted without mounting a page. */
@Component({
  selector: 'app-scope-spec-blank',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class Blank {}

const STUB_ROUTES: Routes = [{ path: '**', component: Blank }];

/**
 * What the chrome's picker reads while a reader is inside this application.
 *
 * Every assertion is the same rule seen from a different side: the URL decides, in both directions,
 * including the two directions that are easy to get wrong — a deep link that arrives before any
 * `NavigationEnd`, and a project id no list contains.
 */
describe('ProjectRouteScope', () => {
  let router: Router;
  let scope: ProjectRouteScope;

  function start(): void {
    TestBed.configureTestingModule({
      providers: [provideRouter(STUB_ROUTES), provideLocationMocks()],
    });
    router = TestBed.inject(Router);
  }

  /** `select` navigates without handing the promise back, so the navigation is drained here. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await TestBed.inject(ApplicationRef).whenStable();
    }
  }

  it('reports nothing at the root, where no project is named', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    expect(scope.projectId()).toBeUndefined();
  });

  it('reports the first path segment as the project', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    await router.navigate(['/', 'p2']);

    expect(scope.projectId()).toBe('p2');
  });

  it('reads it from the first segment of a deeper URL', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    await router.navigate(['/', 'p1', 'repositories', 'new']);

    expect(scope.projectId()).toBe('p1');
  });

  it('ignores a query string and a fragment, which are not segments', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    await router.navigate(['/', 'p1'], { queryParams: { tab: 'epics' }, fragment: 'top' });

    expect(scope.projectId()).toBe('p1');
  });

  /** The seed matters as much as the stream: no NavigationEnd arrives before the first read. */
  it('reports the project of a URL that was already current when it was built', async () => {
    start();
    await router.navigate(['/', 'p1']);

    expect(TestBed.inject(ProjectRouteScope).projectId()).toBe('p1');
  });

  /**
   * Passed through rather than blanked. The guard belongs to the picker, which resolves a value
   * against its options and shows the list again when nothing matches — this service has no list.
   */
  it('reports an id naming no project, and leaves the guarding to the picker', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    await router.navigate(['/', 'nope']);

    expect(scope.projectId()).toBe('nope');
  });

  it('navigates to the project that is picked', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    scope.select('p2');
    await settle();

    expect(router.url).toBe('/p2');
  });

  it('goes back to the landing page when the pick is cleared', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);
    await router.navigate(['/', 'p1']);

    scope.select(undefined);
    await settle();

    expect(router.url).toBe('/');
  });

  it('decodes a project id that had to be escaped in the URL', async () => {
    start();
    scope = TestBed.inject(ProjectRouteScope);

    await router.navigate(['/', 'a b']);

    expect(scope.projectId()).toBe('a b');
  });
});
