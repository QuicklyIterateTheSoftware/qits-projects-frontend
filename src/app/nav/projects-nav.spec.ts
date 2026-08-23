import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { ProjectsNav } from './projects-nav';

/** A destination for the router to land on, so a URL can be asserted without mounting a page. */
@Component({
  selector: 'app-nav-spec-blank',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class Blank {}

/**
 * The real route table is not used here on purpose: this spec is about the mapping between the URL
 * and the links, and mounting the real pages would drag their reads in and assert them by accident.
 */
const STUB_ROUTES: Routes = [{ path: '**', component: Blank }];

/**
 * The sub-navigation: the two places inside a project that this application serves.
 *
 * <b>The picker is not here any more</b> — it is in the chrome's top-left slot, and what it does
 * with the URL is `ProjectRouteScope`'s, asserted in its own spec. What is left to prove here is
 * narrower and still worth proving: the links exist only for a project that is really in the list,
 * and they follow the URL rather than the page they were rendered from.
 */
describe('ProjectsNav', () => {
  let http: HttpTestingController;
  let router: Router;
  let fixture: ComponentFixture<ProjectsNav>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(STUB_ROUTES),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  async function mount(names: readonly string[]): Promise<void> {
    fixture = TestBed.createComponent(ProjectsNav);
    await fixture.whenStable();
    http.expectOne('/projects/api/projects').flush({
      entries: names.map((name) => ({
        project: { id: name, name: `${name} project`, slug: name, description: null, dns: null },
      })),
    });
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function links(): string[] {
    return Array.from(element().querySelectorAll('.links a')).map(
      (link) => link.textContent?.trim() ?? '',
    );
  }

  function hrefs(): (string | null)[] {
    return Array.from(element().querySelectorAll('.links a')).map((link) =>
      link.getAttribute('href'),
    );
  }

  it('offers nothing at the root: both links are about a project', async () => {
    await mount(['p1', 'p2']);

    expect(links()).toEqual([]);
  });

  it('shows the two places to go from the project the URL names', async () => {
    await mount(['p1', 'p2']);

    await router.navigate(['/', 'p2']);
    await settle();

    expect(links()).toEqual(['Overview', 'Project setup']);
    // Both are addresses under the chosen project, so switching projects moves both at once.
    expect(hrefs()).toEqual(['/p2', '/p2/project-setup']);
  });

  /** The links follow the URL rather than the page, so they are right from a deep link too. */
  it('points the links at the project the setup page is showing', async () => {
    await router.navigate(['/', 'p1', 'project-setup']);
    await mount(['p1']);

    expect(hrefs()).toEqual(['/p1', '/p1/project-setup']);
  });

  it('reads the project id from the first segment of a deeper URL', async () => {
    await mount(['p1']);

    await router.navigate(['/', 'p1', 'repositories', 'new']);
    await settle();

    expect(hrefs()).toEqual(['/p1', '/p1/project-setup']);
  });

  /** Two links into a project nobody can visit are worse than none: the picker offers the choices. */
  it('shows no links for a URL naming a project the list does not contain', async () => {
    await mount(['p1']);

    await router.navigate(['/', 'nope']);
    await settle();

    expect(links()).toEqual([]);
  });

  it('says so when the list could not be read, rather than falling silent', async () => {
    fixture = TestBed.createComponent(ProjectsNav);
    await fixture.whenStable();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(element().textContent).toContain('Could not load projects');
    expect(links()).toEqual([]);
  });
});
