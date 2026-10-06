import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { goldenMaster } from '../../testing/golden-masters';
import { ProjectsApi } from './projects-api';

/**
 * qits-projects wraps every list in `entries`, and every entry in the name of the thing it holds.
 * The client unwraps rather than pushing the envelope into the pages.
 *
 * The create body is asserted **field by field**, because "exactly one of url and name" is a server
 * rule this client has to satisfy rather than merely believe: a body carrying both — or carrying
 * `name: undefined` beside a url, which is what a naive object literal produces — is a 400.
 */
describe('ProjectsApi', () => {
  let api: ProjectsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the project entries', async () => {
    const projects = api.projects();
    http.expectOne('/projects/api/projects').flush({
      entries: [
        { project: { id: 'p1', name: 'qits', slug: 'qits', description: null, dns: null } },
      ],
    });
    await expect(projects).resolves.toMatchObject([{ id: 'p1', name: 'qits' }]);
  });

  it('reads the repositories and the wrapper from the one response', async () => {
    const components = api.components('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({
      entries: [
        {
          repository: {
            id: 'r1',
            name: 'qits-ci',
            backupUrl: 'https://github.com/QuicklyIterate/qits-ci.git',
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: 'p1',
          },
          declared: true,
        },
      ],
      wrapper: {
        repositoryId: 'w1',
        branch: 'main',
        entries: [{ path: 'services/qits-ci', name: 'qits-ci', repositoryId: 'r1' }],
      },
    });

    await expect(components).resolves.toMatchObject({
      repositories: [{ id: 'r1', name: 'qits-ci', archetype: 'SERVICE' }],
      wrapper: { repositoryId: 'w1', branch: 'main' },
    });
  });

  /**
   * A half-flipped project, which is the ordinary state while the wrapper moves: one row already
   * mounted under `components/`, one still under its archetype directory. Both facts ride the same
   * row, and a moved row keeps the archetype it had — nothing under the component layout states a
   * kind, so re-deriving one would re-type a submodule that only moved.
   */
  it('carries a row’s component beside its archetype, and the absence of one', async () => {
    const components = api.components('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({
      entries: [
        {
          repository: {
            id: 'r1',
            name: 'qits-ci-service',
            backupUrl: null,
            mainBranch: 'main',
            archetype: 'SERVICE',
            component: 'qits-ci',
            projectId: 'p1',
          },
          declared: true,
        },
        {
          repository: {
            id: 'r2',
            name: 'qits-stt',
            backupUrl: null,
            mainBranch: 'main',
            archetype: 'SERVICE',
            component: null,
            projectId: 'p1',
          },
          declared: true,
        },
      ],
      wrapper: {
        repositoryId: 'w1',
        branch: 'main',
        entries: [
          {
            path: 'components/qits-ci/qits-ci-service',
            name: 'qits-ci-service',
            repositoryId: 'r1',
          },
          { path: 'services/qits-stt', name: 'qits-stt', repositoryId: 'r2' },
        ],
      },
    });

    await expect(components).resolves.toMatchObject({
      repositories: [
        { name: 'qits-ci-service', archetype: 'SERVICE', component: 'qits-ci' },
        { name: 'qits-stt', archetype: 'SERVICE', component: null },
      ],
    });
  });

  /**
   * Membership is per entry on the wire and a set of ids here, so the page can ask about one row
   * without walking the wrapper — and it is the server's verdict, kept rather than recomputed.
   */
  it('collects the undeclared rows by id', async () => {
    const components = api.components('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({
      entries: [
        { repository: { id: 'r1', name: 'qits-ci' }, declared: true },
        { repository: { id: 'r9', name: 'testing-repo' }, declared: false },
      ],
      wrapper: null,
    });

    await expect(components.then((answer) => [...answer.undeclared])).resolves.toEqual(['r9']);
  });

  /** A project with no wrapper is a project that cannot be reconciled, so the null survives. */
  it('keeps a missing wrapper as null rather than an empty one', async () => {
    const components = api.components('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({ entries: [], wrapper: null });
    await expect(components).resolves.toEqual({
      repositories: [],
      undeclared: new Set(),
      wrapper: null,
    });
  });

  /**
   * The delete takes the row and the repository on the git host. The body says `success`, which a
   * 200 already said, so the client resolves with nothing rather than passing an echo upwards.
   */
  it('deletes a repository by id', async () => {
    const deleted = api.deleteRepository('r9');
    const request = http.expectOne('/projects/api/repositories/r9');
    expect(request.request.method).toBe('DELETE');
    request.flush({ success: true });
    await expect(deleted).resolves.toBeUndefined();
  });

  /** The epic PUT is retired: a field edit is a restatement on the multi-entity transition door. */
  it('has no epic PUT and no epic dispatch door', () => {
    expect('updateEpic' in api).toBe(false);
    expect('dispatchEpicAgent' in api).toBe(false);
  });

  it('sends a name and no url for a blank repository', async () => {
    const created = api.createRepository('p1', { name: 'qits-widgets', archetype: 'SERVICE' });
    const request = http.expectOne('/projects/api/projects/p1/repositories');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'qits-widgets', archetype: 'SERVICE' });
    expect('url' in (request.request.body as object)).toBe(false);

    request.flush({
      repository: {
        id: 'r2',
        name: 'qits-widgets',
        backupUrl: null,
        mainBranch: 'main',
        archetype: 'SERVICE',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'services/qits-widgets',
    });
    await expect(created).resolves.toMatchObject({ wrapperPath: 'services/qits-widgets' });
  });

  /**
   * A stated component is what places the entry under `components/`, whatever layout the wrapper is
   * in — so this is also how a project starts its flip. The row's component comes back off the path
   * the wrapper commit used, not off the request.
   */
  it('sends the component that places the entry under the component layout', async () => {
    const created = api.createRepository('p1', {
      name: 'qits-widgets-service',
      archetype: 'SERVICE',
      component: 'qits-widgets',
    });
    const request = http.expectOne('/projects/api/projects/p1/repositories');

    expect(request.request.body).toEqual({
      name: 'qits-widgets-service',
      archetype: 'SERVICE',
      component: 'qits-widgets',
    });

    request.flush({
      repository: {
        id: 'r4',
        name: 'qits-widgets-service',
        backupUrl: null,
        mainBranch: 'main',
        archetype: 'SERVICE',
        component: 'qits-widgets',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'components/qits-widgets/qits-widgets-service',
    });
    await expect(created).resolves.toMatchObject({
      wrapperPath: 'components/qits-widgets/qits-widgets-service',
      repository: { component: 'qits-widgets' },
    });
  });

  it('sends a url and no name for an existing repository', async () => {
    const created = api.createRepository('p1', {
      url: 'https://github.com/QuicklyIterate/qits-widgets.git',
      archetype: 'LIBRARY',
    });
    const request = http.expectOne('/projects/api/projects/p1/repositories');

    expect(request.request.body).toEqual({
      url: 'https://github.com/QuicklyIterate/qits-widgets.git',
      archetype: 'LIBRARY',
    });
    expect('name' in (request.request.body as object)).toBe(false);

    request.flush({
      repository: {
        id: 'r3',
        name: 'qits-widgets',
        backupUrl: 'https://github.com/QuicklyIterate/qits-widgets.git',
        mainBranch: 'main',
        archetype: 'LIBRARY',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'libs/qits-widgets',
    });
    await expect(created).resolves.toMatchObject({ wrapperPath: 'libs/qits-widgets' });
  });

  /** Two different reconciles, two different paths — the components' one, and the domain's. */
  it('posts the wrapper reconcile to the repositories path', async () => {
    const reconciled = api.reconcileRepositories('p1');
    const request = http.expectOne('/projects/api/projects/p1/repositories/reconcile');

    expect(request.request.method).toBe('POST');
    request.flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        {
          path: 'services/qits-ci',
          name: 'qits-ci',
          repositoryId: 'r1',
          archetype: 'SERVICE',
          outcome: 'KEPT',
          warning: null,
        },
        // A warning rides the line it explains; there is no list of them beside the entries.
        {
          path: 'docs/handbook',
          name: 'handbook',
          repositoryId: null,
          archetype: null,
          outcome: 'SKIPPED',
          warning: "'docs' is not one of this project's component directories",
        },
      ],
    });

    await expect(reconciled).resolves.toMatchObject({
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [{ outcome: 'KEPT' }, { outcome: 'SKIPPED', warning: expect.any(String) }],
    });
  });

  /**
   * What a wrapper flip reads as: the submodule moved, so the row gained a component and kept
   * everything else. Without its own outcome a whole flip would report as a reconcile that did
   * nothing.
   */
  it('reads a moved entry as COMPONENT_UPDATED, with the component it moved under', async () => {
    const reconciled = api.reconcileRepositories('p1');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        {
          path: 'components/qits-ci/qits-ci-service',
          name: 'qits-ci-service',
          repositoryId: 'r1',
          archetype: 'SERVICE',
          component: 'qits-ci',
          outcome: 'COMPONENT_UPDATED',
          warning: null,
        },
      ],
    });

    await expect(reconciled).resolves.toMatchObject({
      entries: [{ outcome: 'COMPONENT_UPDATED', component: 'qits-ci', archetype: 'SERVICE' }],
    });
  });

  /** An undeclared row is a line about a row, not about a path, so it carries no path at all. */
  it('keeps an undeclared line’s null path rather than inventing one', async () => {
    const reconciled = api.reconcileRepositories('p1');
    http.expectOne('/projects/api/projects/p1/repositories/reconcile').flush({
      projectId: 'p1',
      wrapperRepositoryId: 'qits-qits',
      branch: 'main',
      entries: [
        {
          path: null,
          name: 'testing-repo',
          repositoryId: 'r9',
          archetype: 'SERVICE',
          outcome: 'UNDECLARED',
          warning: null,
        },
      ],
    });

    await expect(reconciled).resolves.toMatchObject({
      entries: [{ path: null, name: 'testing-repo', outcome: 'UNDECLARED' }],
    });
  });

  it('posts the dns reconcile to the project path', async () => {
    const reconciled = api.reconcileDomain('p1');
    http
      .expectOne('/projects/api/projects/p1/reconcile')
      .flush({ domain: 'REGISTERED', domainDetail: null });
    await expect(reconciled).resolves.toEqual({ domain: 'REGISTERED', domainDetail: null });
  });

  /**
   * The `/work` surface (epic qits-965): one listing for every archetype, and each entity addressed
   * by its qualified id. The answers are qits-projects' golden masters.
   */
  it("reads the project's whole tree from the one listing", async () => {
    const work = api.work('p1');
    http
      .expectOne('/projects/api/projects/p1/work')
      .flush(goldenMaster('an epic in detail', 'listProjectWork'));
    const rows = await work;
    expect(rows.map((row) => row.archetype)).toEqual(
      expect.arrayContaining(['CAMPAIGN', 'EPIC', 'FEATURE', 'TASK', 'TICKET']),
    );
    expect(rows.find((row) => row.archetype === 'FEATURE')?.parent).toBe(
      rows.find((row) => row.archetype === 'EPIC')?.id,
    );
  });

  it('reads one entity whole by its qualified id', async () => {
    const item = api.workItem('qits-2');
    http.expectOne('/projects/api/work/qits-2').flush(goldenMaster('an epic in detail', 'getWork'));
    await expect(item).resolves.toMatchObject({
      archetype: 'EPIC',
      acceptanceCriteria: ['It does what it says.'],
    });
  });

  it('files a new entity with one body shape', async () => {
    const created = api.createWork({ archetype: 'TICKET', project: 'p1', title: 'T' });
    const request = http.expectOne('/projects/api/work');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ archetype: 'TICKET', project: 'p1', title: 'T' });
    request.flush(goldenMaster('a project with no work', 'createWork'), {
      status: 201,
      statusText: 'Created',
    });
    await expect(created).resolves.toMatchObject({ archetype: 'TICKET', status: 'REPORTED' });
  });

  it('deletes an entity by its qualified id and drops the success body', async () => {
    const deleted = api.deleteWork('qits-1');
    const request = http.expectOne('/projects/api/work/qits-1');
    expect(request.request.method).toBe('DELETE');
    request.flush(goldenMaster('a reported ticket', 'deleteWork'));
    await expect(deleted).resolves.toBeUndefined();
  });

  /**
   * One lifecycle door for every archetype. `SUPERSEDED` is the supersede operation's name on it:
   * the answer is the epic, `DROPPED`, naming its successor in `supersededBy`.
   */
  it('posts the lifecycle target to the status door and keeps the answer', async () => {
    const moved = api.setStatus('qits-1', 'REFINED');
    const request = http.expectOne('/projects/api/work/qits-1/status');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ target: 'REFINED' });
    request.flush(goldenMaster('a reported epic', 'setWorkStatus'));
    await expect(moved).resolves.toMatchObject({ status: 'REFINED', statusBefore: 'REPORTED' });
  });

  it("reads a node's children, bodies included", async () => {
    const children = api.children('qits-2');
    http
      .expectOne('/projects/api/work/qits-2/children')
      .flush(goldenMaster('an epic in detail', 'listWorkChildren'));
    const rows = await children;
    expect(rows.map((row) => row.archetype)).toEqual(['FEATURE', 'FEATURE']);
    expect(rows[0].description).toContain('CSV');
  });

  it('reads a repository’s sync status', async () => {
    const status = api.syncStatus('w1');
    http.expectOne('/projects/api/repositories/w1/sync-status').flush({
      branch: 'main',
      remoteReachable: true,
      remoteExists: true,
      ahead: 0,
      behind: 2,
    });
    await expect(status).resolves.toMatchObject({ behind: 2 });
  });
});
