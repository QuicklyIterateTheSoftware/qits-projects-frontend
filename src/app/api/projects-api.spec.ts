import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
            url: 'ssh://git@example/QuicklyIterate/qits-ci.git',
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: 'p1',
          },
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

  /** A project with no wrapper is a project that cannot be reconciled, so the null survives. */
  it('keeps a missing wrapper as null rather than an empty one', async () => {
    const components = api.components('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({ entries: [], wrapper: null });
    await expect(components).resolves.toEqual({ repositories: [], wrapper: null });
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
        url: null,
        mainBranch: 'main',
        archetype: 'SERVICE',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'services/qits-widgets',
    });
    await expect(created).resolves.toMatchObject({ wrapperPath: 'services/qits-widgets' });
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
        url: 'https://github.com/QuicklyIterate/qits-widgets.git',
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

  /** A deregistration is a line about a row, not about a path, so it carries no path at all. */
  it('keeps a deregistration’s null path rather than inventing one', async () => {
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
          outcome: 'DEREGISTERED',
          warning: null,
        },
      ],
    });

    await expect(reconciled).resolves.toMatchObject({
      entries: [{ path: null, name: 'testing-repo', outcome: 'DEREGISTERED' }],
    });
  });

  it('posts the dns reconcile to the project path', async () => {
    const reconciled = api.reconcileDomain('p1');
    http
      .expectOne('/projects/api/projects/p1/reconcile')
      .flush({ domain: 'REGISTERED', domainDetail: null });
    await expect(reconciled).resolves.toEqual({ domain: 'REGISTERED', domainDetail: null });
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
