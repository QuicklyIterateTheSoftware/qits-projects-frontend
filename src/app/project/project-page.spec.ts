import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type {
  ReconcileEntryDto,
  RepositoryArchetype,
  RepositoryDto,
  SyncStatusDto,
  WrapperDto,
  WrapperEntryDto,
} from '../api/dto';
import { groupComponents } from './project-page';

function repository(
  id: string,
  archetype: RepositoryArchetype,
  over: Partial<RepositoryDto> = {},
): RepositoryDto {
  return {
    id,
    name: id,
    url: `https://example.test/QuicklyIterate/${id}.git`,
    mainBranch: 'main',
    archetype,
    projectId: 'p1',
    ...over,
  };
}

/**
 * One line of a reconcile report. Every field but `outcome` is nullable on the wire, so the default
 * here is the *ordinary* line — a wrapper entry that was kept — and each test overrides only the
 * fields whose nullness is the thing it is about.
 */
function entry(over: Partial<ReconcileEntryDto> = {}): ReconcileEntryDto {
  return {
    path: 'services/qits-ci',
    name: 'qits-ci',
    repositoryId: 'qits-ci',
    archetype: 'SERVICE',
    outcome: 'KEPT',
    warning: null,
    ...over,
  };
}

/**
 * Grouping, asserted directly, because every one of these rules loses a repository when it breaks
 * and the page still looks fine.
 */
describe('groupComponents', () => {
  it('always draws the six groups, empty or not', () => {
    expect(groupComponents([]).map((group) => group.key)).toEqual([
      'SERVICE',
      'DAEMON',
      'LIBRARY',
      'FRONTEND',
      'CLI',
      'IMAGE',
    ]);
  });

  it('files the two legacy archetypes under their successors', () => {
    const groups = groupComponents([
      repository('old-integration', 'INTEGRATION'),
      repository('old-application', 'APPLICATION'),
    ]);

    expect(groups.find((group) => group.key === 'LIBRARY')?.repositories).toHaveLength(1);
    expect(groups.find((group) => group.key === 'FRONTEND')?.repositories).toHaveLength(1);
    expect(groups.find((group) => group.key === 'OTHER')).toBeUndefined();
  });

  /** The wrapper is not a component of itself; it is the configuration, drawn above the groups. */
  it('leaves the wrapper out of every group', () => {
    const groups = groupComponents([repository('qits-qits', 'PROJECT')]);

    expect(groups.flatMap((group) => group.repositories)).toEqual([]);
    expect(groups.find((group) => group.key === 'OTHER')).toBeUndefined();
  });

  it('puts anything else in a visible other bucket rather than dropping it', () => {
    const groups = groupComponents([
      repository('qits-backend', 'FORK'),
      repository('mystery', 'WIDGET' as RepositoryArchetype),
    ]);

    const other = groups.find((group) => group.key === 'OTHER');
    expect(other?.repositories.map((entry) => entry.id)).toEqual(['qits-backend', 'mystery']);
    // No "New other" link — the bucket is a report, not an affordance.
    expect(other?.archetype).toBeNull();
  });
});

/**
 * The page itself: what it reads, what it draws, and what the two reconciles do.
 */
describe('ProjectPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const WRAPPER: WrapperDto = {
    repositoryId: 'qits-qits',
    branch: 'main',
    entries: [{ path: 'services/qits-ci', name: 'qits-ci', repositoryId: 'qits-ci' }],
  };

  const IN_SYNC: SyncStatusDto = {
    branch: 'main',
    remoteReachable: true,
    remoteExists: true,
    ahead: 0,
    behind: 0,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function open(url = '/p1'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  async function click(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  function flushProjects(): void {
    http.expectOne('/projects/api/projects').flush({
      entries: [
        { project: { id: 'p1', name: 'qits', slug: 'qits', description: null, dns: null } },
      ],
    });
  }

  function flushComponents(
    repositories: readonly RepositoryDto[],
    wrapper: WrapperDto | null = WRAPPER,
  ): void {
    http
      .expectOne('/projects/api/projects/p1/repositories')
      .flush({ entries: repositories.map((entry) => ({ repository: entry })), wrapper });
  }

  function flushSync(status: SyncStatusDto = IN_SYNC): void {
    http.expectOne('/projects/api/repositories/qits-qits/sync-status').flush(status);
  }

  /** The page's whole load: the shared project list, the components, and the wrapper's probe. */
  async function load(
    repositories: readonly RepositoryDto[],
    wrapper: WrapperDto | null = WRAPPER,
  ): Promise<void> {
    flushProjects();
    flushComponents(repositories, wrapper);
    await settle();
    if (wrapper) {
      flushSync();
    }
    await settle();
  }

  it('names the project and draws every group, with a create link on each', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    expect(text()).toContain('qits');
    for (const heading of ['Services', 'Daemons', 'Libraries', 'Frontends', 'Command line']) {
      expect(text()).toContain(heading);
    }
    // Every group is an affordance, including the empty ones — that is how the first daemon is made.
    const adds = Array.from(page().querySelectorAll('a.add')).map((link) =>
      link.textContent?.trim(),
    );
    expect(adds).toContain('New service');
    expect(adds).toContain('New daemon');
    expect(adds).toContain('New image');
  });

  it('prefills the create page from the group the link was in', async () => {
    await open();
    await load([]);

    const daemon = Array.from(page().querySelectorAll<HTMLAnchorElement>('a.add')).find((link) =>
      (link.textContent ?? '').includes('New daemon'),
    );
    expect(daemon?.getAttribute('href')).toBe('/p1/repositories/new?type=DAEMON');
  });

  it('says a group is empty rather than leaving blank space', async () => {
    await open();
    await load([]);

    expect(text()).toContain('None yet.');
  });

  it('draws a card with the name, the normalised archetype, the origin and the branch', async () => {
    await open();
    await load([repository('qits-angular', 'INTEGRATION')]);

    const card = page().querySelector('app-component-card');
    expect(card?.textContent).toContain('qits-angular');
    expect(card?.textContent).toContain('LIBRARY');
    expect(card?.textContent).toContain('https://example.test/QuicklyIterate/qits-angular.git');
    expect(card?.textContent).toContain('main');
    // Nothing on a card links anywhere: there is no repository detail page to link to.
    expect(card?.querySelector('a')).toBeNull();
  });

  it('says a blank repository has no origin of its own', async () => {
    await open();
    await load([repository('qits-widgets', 'SERVICE', { url: null })]);

    expect(text()).toContain('this platform’s git host');
  });

  it('badges the wrapper in sync when every submodule has a row and every row a submodule', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE'), repository('qits-qits', 'PROJECT')]);

    expect(page().querySelector('app-wrapper-status')?.textContent).toContain('in sync');
    expect(text()).toContain('1 submodule');
    expect(text()).toContain('Its main matches the remote.');
  });

  it('badges it out of sync and names both kinds of drift', async () => {
    const entries: readonly WrapperEntryDto[] = [
      { path: 'services/qits-ci', name: 'qits-ci', repositoryId: 'qits-ci' },
      { path: 'libs/qits-gone', name: 'qits-gone', repositoryId: null },
    ];
    await open();
    await load([repository('qits-ci', 'SERVICE'), repository('qits-stray', 'DAEMON')], {
      ...WRAPPER,
      entries,
    });

    const status = page().querySelector('app-wrapper-status');
    expect(status?.textContent).toContain('out of sync');
    expect(status?.textContent).toContain('libs/qits-gone');
    expect(status?.textContent).toContain('qits-stray');
  });

  /** A fork is deliberately not a member, so reporting it as drift would be wrong on every load. */
  it('does not call an unplaceable row a stray', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE'), repository('qits-backend', 'FORK')]);

    expect(page().querySelector('app-wrapper-status')?.textContent).toContain('in sync');
  });

  it('reconciles from the wrapper, reports every line, and re-reads the list', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await click('Reconcile from wrapper');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        entry({ path: 'services/qits-ci', name: 'qits-ci', repositoryId: 'qits-ci' }),
        entry({
          path: 'libs/qits-new',
          name: 'qits-new',
          repositoryId: 'qits-new',
          archetype: 'LIBRARY',
          outcome: 'CREATED',
        }),
      ],
    });
    await settle();

    expect(text()).toContain('libs/qits-new');
    expect(text()).toContain('CREATED');

    // The reconcile rewrote rows, so the page reads them again rather than trusting the outcomes.
    // It does not blank while it does — the report above is what the reader is looking at — and it
    // does not re-probe the wrapper's remote, whose identity did not change.
    flushComponents([repository('qits-ci', 'SERVICE'), repository('qits-new', 'LIBRARY')]);
    await settle();

    expect(text()).toContain('qits-new');
    expect(text()).toContain('libs/qits-new');
    http.verify();
  });

  /** The warning belongs to the line it explains, so it is drawn on that line and nowhere else. */
  it('shows a skipped line’s warning beside the line it is about', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await click('Reconcile from wrapper');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        entry({
          path: 'docs/handbook',
          name: 'handbook',
          repositoryId: null,
          outcome: 'SKIPPED',
          warning: "'docs' is not one of this project's component directories",
        }),
      ],
    });
    await settle();
    flushComponents([repository('qits-ci', 'SERVICE')]);
    await settle();

    const line = page().querySelector('.outcomes li');
    expect(line?.textContent).toContain('docs/handbook');
    expect(line?.textContent).toContain('SKIPPED');
    expect(line?.querySelector('.warning')?.textContent).toContain('component directories');
  });

  /** No entry named it, which is why its row went — so there is no path to report it under. */
  it('reports a deregistration by its alias, because it has no wrapper path', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await click('Reconcile from wrapper');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        entry({
          path: null,
          name: 'testing-repo',
          repositoryId: 'r9',
          outcome: 'DEREGISTERED',
        }),
      ],
    });
    await settle();
    flushComponents([]);
    await settle();

    const line = page().querySelector('.outcomes li');
    expect(line?.textContent).toContain('testing-repo');
    expect(line?.textContent).toContain('DEREGISTERED');
    expect(line?.textContent).not.toContain('null');
  });

  /** An empty .gitmodules is answered with one line about nothing, and it must still read. */
  it('names the wrapper itself for a line carrying neither path nor name', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await click('Reconcile from wrapper');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        entry({
          path: null,
          name: null,
          repositoryId: 'qits-qits',
          outcome: 'SKIPPED',
          warning: 'The wrapper declares no submodules, so nothing was registered.',
        }),
      ],
    });
    await settle();
    flushComponents([repository('qits-ci', 'SERVICE')]);
    await settle();

    const line = page().querySelector('.outcomes li');
    expect(line?.textContent).toContain('this wrapper');
    expect(line?.textContent).toContain('declares no submodules');
    expect(line?.textContent).not.toContain('null');
  });

  it('re-asserts the dns record without touching the components', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await click('Re-assert DNS');
    http
      .expectOne('/projects/api/projects/p1/reconcile')
      .flush({ domain: 'NO_MATCHING_ZONE', domainDetail: 'no zone contains qits.example' });
    await settle();

    expect(text()).toContain('NO_MATCHING_ZONE');
    expect(text()).toContain('no zone contains qits.example');
    // No repository list was re-read: the dns reconcile changes nothing here.
    http.verify();
  });

  it('says a project with no wrapper cannot be reconciled at all', async () => {
    await open();
    await load([], null);

    const status = page().querySelector('app-wrapper-status');
    expect(status?.textContent).toContain('no wrapper repository');
    expect(status?.querySelector('qits-button')).toBeNull();
  });

  it('reports a sync probe that failed as unmeasured, not as behind', async () => {
    await open();
    flushProjects();
    flushComponents([repository('qits-ci', 'SERVICE')]);
    await settle();
    http
      .expectOne('/projects/api/repositories/qits-qits/sync-status')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Its remote could not be measured.');
    expect(text()).toContain('in sync');
  });

  it('offers a retry when the components could not be read', async () => {
    await open();
    flushProjects();
    http
      .expectOne('/projects/api/projects/p1/repositories')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load this project — 503');
    expect(text()).not.toContain('Services');

    await click('Retry');
    flushComponents([repository('qits-ci', 'SERVICE')]);
    await settle();
    flushSync();
    await settle();
    expect(text()).toContain('qits-ci');
  });

  /** The instance is re-used across a project hop, so the read has to follow the parameter. */
  it('re-reads when the route moves to another project', async () => {
    await open();
    await load([repository('qits-ci', 'SERVICE')]);

    await TestBed.inject(Router).navigate(['/', 'p2']);
    await settle();

    http.expectOne('/projects/api/projects/p2/repositories').flush({ entries: [], wrapper: null });
    await settle();

    expect(text()).not.toContain('qits-ci');
    expect(text()).toContain('p2');
  });
});
