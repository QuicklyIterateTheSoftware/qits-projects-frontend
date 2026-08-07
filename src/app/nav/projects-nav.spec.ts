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
 * and the pill, and mounting the real pages would drag their reads in and assert them by accident.
 */
const STUB_ROUTES: Routes = [{ path: '**', component: Blank }];

/**
 * The sub-navigation, which is the whole navigation of this app.
 *
 * The assertions are all about one rule: the URL decides what the pill shows, in both directions
 * and including the direction nobody tests — a URL naming a project that is not in the list.
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

  function options(): string[] {
    return Array.from(element().querySelectorAll('.qits-picker-option')).map(
      (row) => row.textContent?.trim() ?? '',
    );
  }

  function pill(): string | null {
    return element().querySelector('.qits-picker-value')?.textContent?.trim() ?? null;
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

  it('offers one option per project and nothing chosen at the root', async () => {
    await mount(['p1', 'p2']);

    expect(options()).toEqual(['p1 project', 'p2 project']);
    expect(pill()).toBeNull();
    // Nowhere to go until a project is chosen: the two links are about a project.
    expect(links()).toEqual([]);
  });

  it('shows the project the URL names, and the two places to go from it', async () => {
    await mount(['p1', 'p2']);

    await router.navigate(['/', 'p2']);
    await settle();

    expect(pill()).toBe('p2 project');
    expect(links()).toEqual(['Overview', 'Project setup']);
    // Both are addresses under the chosen project, so switching projects moves both at once.
    expect(hrefs()).toEqual(['/p2', '/p2/project-setup']);
  });

  /** The links follow the picker rather than the page, so they are right from a deep link too. */
  it('points the links at the project the setup page is showing', async () => {
    await router.navigate(['/', 'p1', 'project-setup']);
    await mount(['p1']);

    expect(pill()).toBe('p1 project');
    expect(hrefs()).toEqual(['/p1', '/p1/project-setup']);
  });

  /** Deep link: the seed matters as much as the stream — no NavigationEnd arrives before render. */
  it('shows the project of a URL that was already current when it was built', async () => {
    await router.navigate(['/', 'p1']);
    await mount(['p1']);

    expect(pill()).toBe('p1 project');
  });

  it('reads the project id from the first segment of a deeper URL', async () => {
    await mount(['p1']);

    await router.navigate(['/', 'p1', 'repositories', 'new']);
    await settle();

    expect(pill()).toBe('p1 project');
  });

  /** A pill for a project nobody can visit would be a label the picker cannot even draw. */
  it('shows nothing for a URL naming a project the list does not contain', async () => {
    await mount(['p1']);

    await router.navigate(['/', 'nope']);
    await settle();

    expect(pill()).toBeNull();
    expect(options()).toEqual(['p1 project']);
  });

  it('navigates to the project that is picked', async () => {
    await mount(['p1', 'p2']);

    const rows = element().querySelectorAll<HTMLElement>('.qits-picker-option');
    rows[1].click();
    await settle();

    expect(router.url).toBe('/p2');
  });

  it('goes back to the landing page when the pick is cleared', async () => {
    await mount(['p1']);
    await router.navigate(['/', 'p1']);
    await settle();

    element().querySelector<HTMLButtonElement>('.qits-picker-clear')?.click();
    await settle();

    expect(router.url).toBe('/');
  });

  it('says so when the list could not be read, rather than showing an empty picker', async () => {
    fixture = TestBed.createComponent(ProjectsNav);
    await fixture.whenStable();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(element().textContent).toContain('Could not load projects');
    expect(element().querySelector('qits-picker')).toBeNull();
  });
});
