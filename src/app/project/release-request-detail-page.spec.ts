import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  QITS_REPOSITORIES,
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsRepositoryList,
  provideQitsScope,
  type QitsNavigation,
  type QitsRepositoriesSource,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type {
  ReleaseArtifactsResponse,
  ReleaseRequestCommitsResponse,
  ReleaseRequestDto,
} from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

const REQUEST = '/projects/api/repositories/repo-ci/release-requests/r1';
const COMMITS = `${REQUEST}/commits`;
const ARTIFACTS = `${REQUEST}/artifacts`;

/**
 * The chrome, answered from literals — and every application this page can link to is served on a
 * host of its own, because that is the shape `QitsAppLinks.href` answers an address for. An
 * application missing from here is exactly the "cannot spell it" case one test needs.
 */
const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-githost',
        label: 'Code',
        host: 'githost.dev.example.test',
        origin: 'https://githost.dev.example.test',
      },
      {
        app: 'qits-artifacts',
        label: 'Artifacts',
        host: 'artifacts.dev.example.test',
        origin: 'https://artifacts.dev.example.test',
      },
      {
        app: 'qits-docs',
        label: 'Docs',
        host: 'docs.dev.example.test',
        origin: 'https://docs.dev.example.test',
      },
      {
        app: 'qits-deployments',
        label: 'Deployments',
        host: 'deployments.dev.example.test',
        origin: 'https://deployments.dev.example.test',
      },
    ],
  },
  applications: {},
};

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-ci',
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [
      { kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false },
      { kind: 'BRANCH', name: 'adhoc-changes', ref: 'refs/heads/adhoc-changes', implicit: false },
    ],
    mergedSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: null,
    version: null,
    releasedSha: null,
    mergedToMainAt: null,
    retryable: false,
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
    ...overrides,
  };
}

function released(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return request({
    state: 'RELEASED',
    version: '2026.904.161524',
    releasedSha: '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
    ...overrides,
  });
}

const NOTHING_FOLDED: ReleaseRequestCommitsResponse = {
  mergedSha: null,
  commits: [],
  detail: 'Nothing has been folded yet',
};

const NOTHING_PUBLISHED: ReleaseArtifactsResponse = {
  version: '2026.904.161524',
  releasedSha: '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
  deployable: false,
  artifacts: [],
  detail: null,
};

/**
 * One release request, whole.
 *
 * <p>Four things are worth pinning and none of them is the markup. **The read budget**: three reads
 * open the page and each is asked once per answer that could change it — the request per poll, the
 * commits per FOLD, the artifacts once and only once released. **The timer**: the same rule the
 * lists keep, so a settled request arms nothing. **The links**: every address is composed through
 * the platform's navigation, and one this platform cannot spell is DROPPED rather than drawn dead —
 * including the deployment link, whose scope is the project alone because the deployments SPA has no
 * repository-scoped route to land on. **The edges**: a request with no fold, a conflict, a
 * withdrawal whose commits were pruned, and a release made before the service recorded its sha.
 */
describe('ReleaseRequestDetailPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  beforeEach(() => {
    // Only the two the page uses. Faking the whole clock stalls `fixture.whenStable()`, which
    // schedules its own work — the narrowing both list specs make.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function configure(...providers: unknown[]): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The page reads the scope, never the route parameters — the platform's rule for every SPA.
        provideQitsScope('repository'),
        provideQitsNavigationTree(PLATFORM),
        provideQitsProjectList([{ id: 'p1', slug: 'qits', name: 'QITS' }]),
        ...(providers as never[]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  /** The chrome knowing the repository, which is how the page learns the row id it reads by. */
  function withRepositories(...providers: unknown[]): void {
    configure(
      provideQitsRepositoryList([{ id: 'repo-ci', name: 'qits-ci', category: 'services' }]),
      ...providers,
    );
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  async function open(url = '/qits/services/qits-ci/release-requests/r1'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    harness.fixture.detectChanges();
  }

  /**
   * Answer the request read, and then whatever it triggered: the commits always, the artifacts only
   * once the answer says RELEASED — which is the read budget itself, asserted by construction.
   */
  async function answer(
    row: ReleaseRequestDto,
    commits: Partial<ReleaseRequestCommitsResponse> = {},
    artifacts: Partial<ReleaseArtifactsResponse> | null = null,
  ): Promise<void> {
    http.expectOne(REQUEST).flush({ request: row });
    await settle();
    http.expectOne(COMMITS).flush({
      mergedSha: row.mergedSha,
      commits: [],
      detail: null,
      ...commits,
    } satisfies ReleaseRequestCommitsResponse);
    await settle();
    if (row.state === 'RELEASED') {
      http
        .expectOne(ARTIFACTS)
        .flush({ ...NOTHING_PUBLISHED, ...(artifacts ?? {}) } satisfies ReleaseArtifactsResponse);
      await settle();
    }
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function hrefs(): readonly string[] {
    return [...page().querySelectorAll('a')]
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('http'));
  }

  describe('the read budget', () => {
    /**
     * Three reads and no more. The name-to-id resolution is the chrome's list, which the shared
     * layout has already fetched — so nothing here reaches the project's component listing, which
     * refreshes the wrapper's git mirror.
     */
    it('costs the request, its commits and — once released — its artifacts', async () => {
      withRepositories();
      await open();

      // One at a time, in order: each read is triggered by the answer before it, so a page that
      // fanned out or asked twice would show up as a different list at one of these three steps.
      const first = http.match(() => true);
      expect(first.map((entry) => entry.request.url)).toEqual([REQUEST]);
      first[0].flush({ request: released() });
      await settle();

      const second = http.match(() => true);
      expect(second.map((entry) => entry.request.url)).toEqual([COMMITS]);
      second[0].flush({ mergedSha: null, commits: [], detail: null });
      await settle();

      const third = http.match(() => true);
      expect(third.map((entry) => entry.request.url)).toEqual([ARTIFACTS]);
      third[0].flush(NOTHING_PUBLISHED);
      await settle();

      http.expectNone(() => true);
    });

    /** Before a release there is nothing published to ask about, and the page does not ask. */
    it('does not ask what an unreleased request published', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }));

      http.expectNone(ARTIFACTS);
    });

    /**
     * The commits are keyed on the FOLD. A poll that brings back the same `mergedSha` has brought
     * back the same commits by construction, and asking again would put a git read behind a timer.
     */
    it('re-reads the commits when the fold moves, and not when it does not', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }));

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(REQUEST).flush({ request: request({ state: 'PENDING', detail: 'still' }) });
      await settle();
      http.expectNone(COMMITS);

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http
        .expectOne(REQUEST)
        .flush({ request: request({ state: 'PENDING', mergedSha: 'aaaa1111bbbb2222' }) });
      await settle();
      http.expectOne(COMMITS).flush({ mergedSha: 'aaaa1111bbbb2222', commits: [], detail: null });
      await settle();
    });

    it('arms no timer once the request has settled', async () => {
      withRepositories();
      await open();
      await answer(released());

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).not.toContain('Watching for changes');
    });

    it('keeps watching while the request is still moving', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }));

      expect(page().textContent).toContain('Watching for changes');
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(REQUEST).flush({ request: request({ state: 'PENDING' }) });
      await settle();
    });
  });

  describe('what the page says', () => {
    it('draws the state, the summary, the sources, the fold and who asked', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'REJECTED', requester: 'dyn-workspace-601', detail: 'red' }));

      const text = page().textContent ?? '';
      expect(text).toContain('rejected');
      expect(text).toContain('A change worth releasing');
      expect(text).toContain('adhoc-changes');
      expect(text).toContain('release/r1');
      expect(text).toContain('20c377e');
      expect(text).toContain('dyn-workspace-601');
      expect(text).toContain('red');
    });

    it('lists the commits the fold brought in', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }), {
        commits: [
          {
            hash: '20c377ee71fabe6f32429d1506989efecec7798b',
            shortHash: '20c377e',
            author: 'Someone',
            email: 'someone@example.test',
            date: '2026-09-01T13:30:00Z',
            message: 'Release request r1: A change worth releasing',
            files: [],
          },
          {
            hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
            shortHash: 'aaaa111',
            author: 'Someone Else',
            email: 'else@example.test',
            date: '2026-09-01T12:00:00Z',
            message: 'Fix the thing',
            files: ['pom.xml'],
          },
        ],
      });

      const commits = [...page().querySelectorAll('li.commit')].map((li) => li.textContent ?? '');
      expect(commits).toHaveLength(2);
      expect(commits[0]).toContain('20c377e');
      expect(commits[0]).toContain('Release request r1');
      expect(commits[1]).toContain('Fix the thing');
      expect(commits[1]).toContain('Someone Else');
    });

    /**
     * An empty list has three causes and only the sentence tells them apart — so the sentence is
     * what is drawn, never a bare "no commits".
     */
    it('draws the service sentence where there are no commits to draw', async () => {
      withRepositories();
      await open();
      await answer(request({ mergedSha: null }), NOTHING_FOLDED);

      expect(page().textContent).toContain('Nothing has been folded yet');
    });

    it('says so when the fold has been pruned out of the repository', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'WITHDRAWN', detail: 'Withdrawn: the branch was deleted' }), {
        detail: "The fold is no longer in the repository's history",
      });

      expect(page().textContent).toContain('Withdrawn: the branch was deleted');
      expect(page().textContent).toContain('no longer in the repository');
    });

    it('draws the conflict panel on a conflicted request', async () => {
      withRepositories();
      await open();
      await answer(
        request({
          state: 'CONFLICTED',
          mergedSha: null,
          conflict: {
            target: 'release/r1',
            conflicts: [
              {
                path: 'pom.xml',
                head: 'refs/tags/2026.903.1',
                headSha: '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
                reason: 'content',
              },
            ],
          },
        }),
        NOTHING_FOLDED,
      );

      const panel = page().querySelector('.conflict')?.textContent ?? '';
      expect(panel).toContain('pom.xml');
      expect(panel).toContain('2026.903.1');
    });
  });

  describe('the released panel', () => {
    it('names the version, links the tag and links the released commit', async () => {
      withRepositories();
      await open();
      await answer(released());

      expect(page().textContent).toContain('2026.904.161524');
      expect(page().textContent).toContain('not on main yet');
      expect(hrefs()).toContain(
        'https://githost.dev.example.test/qits/services/qits-ci/tags/2026.904.161524',
      );
      expect(hrefs()).toContain(
        'https://githost.dev.example.test/qits/services/qits-ci/commit/' +
          '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
      );
    });

    /**
     * A release made before the service recorded the sha: the tag link is composed from the VERSION
     * and still works, and the anchor that has no address is simply not there.
     */
    it('still links the tag of a release that recorded no sha, and drops the commit link', async () => {
      withRepositories();
      await open();
      await answer(released({ releasedSha: null }));

      expect(hrefs()).toContain(
        'https://githost.dev.example.test/qits/services/qits-ci/tags/2026.904.161524',
      );
      expect(page().textContent).not.toContain('The released commit');
    });

    it('says a release has reached main once it has', async () => {
      withRepositories();
      await open();
      await answer(released({ mergedToMainAt: '2026-09-04T17:02:11Z' }));

      expect(page().textContent).toContain('on main');
      expect(page().textContent).not.toContain('not on main yet');
    });
  });

  describe('what it published', () => {
    /**
     * The docker case, with both of its addresses: the image under the registry's application name
     * (the `qits/` scope stripped) and the SBOM under its own coordinate. The image is a page of
     * the artifacts SPA and rides the scope; the SBOM is a wire route at the store's root, so its
     * address carries no scope at all — a scoped spelling is served by nothing.
     */
    it('links an image and its SBOM', async () => {
      withRepositories();
      await open();
      await answer(
        released(),
        {},
        {
          artifacts: [{ type: 'docker', name: 'qits/qits-ci', version: '2026.904.161524' }],
        },
      );

      expect(hrefs()).toContain(
        'https://artifacts.dev.example.test/qits/services/qits-ci/repositories/qits/images/qits-ci',
      );
      expect(hrefs()).toContain(
        'https://artifacts.dev.example.test/artifacts/sboms/docker/qits/qits-ci/-/2026.904.161524',
      );
    });

    /** The userflow bundle is a docs site, and its version is the FOLD's sha rather than the calver. */
    it('links the userflow bundle at the sha its pipeline published it under', async () => {
      withRepositories();
      await open();
      await answer(
        released(),
        {},
        {
          artifacts: [
            {
              type: 'userflows',
              name: '@userflows/qits-ci',
              version: '20c377ee71fabe6f32429d1506989efecec7798b',
            },
          ],
        },
      );

      expect(hrefs()).toContain(
        'https://docs.dev.example.test/qits/services/qits-ci/read/@userflows/qits-ci/-/' +
          '20c377ee71fabe6f32429d1506989efecec7798b',
      );
    });

    /** A kind this build cannot address is named and given no anchor, never a link to nowhere. */
    it('names an artifact it cannot address and links nothing for it', async () => {
      withRepositories();
      await open();
      await answer(
        released(),
        {},
        {
          artifacts: [{ type: 'daemon', name: 'qits-ci-daemon', version: '2026.904.161524' }],
        },
      );

      expect(page().textContent).toContain('qits-ci-daemon');
      expect(page().querySelector('.artifact a')).toBeNull();
      expect(page().querySelector('.artifact .unlinked')?.textContent?.trim()).toBe(
        'qits-ci-daemon',
      );
    });

    /**
     * **The deployment link's scope is the PROJECT alone.** qits-deployments serves
     * `deployment-requests/by-release/:repoId/:version` under its bare and its per-project addresses
     * and under no repository-scoped one, so spelling the group and the repository into it would
     * compose a URL that 404s.
     */
    it('links the deployment of a deployable release, scoped to the project alone', async () => {
      withRepositories();
      await open();
      await answer(released(), {}, { deployable: true });

      expect(hrefs()).toContain(
        'https://deployments.dev.example.test/qits/deployment-requests/by-release/' +
          'repo-ci/2026.904.161524',
      );
    });

    /** A library deploys nothing, so there is no deployment to look at and no link offered. */
    it('offers no deployment link for a release nothing deploys', async () => {
      withRepositories();
      await open();
      await answer(released(), {}, { deployable: false });

      expect(page().textContent).not.toContain('The deployment of this release');
    });

    it('draws the service sentence when it could not read what was published', async () => {
      withRepositories();
      await open();
      await answer(released(), {}, { detail: 'qits-githost answered 503' });

      expect(page().textContent).toContain('qits-githost answered 503');
    });

    /** Publishing nothing is an answer — every SPA is in this case — and it needs no warning. */
    it('says a repository that publishes nothing publishes nothing', async () => {
      withRepositories();
      await open();
      await answer(released());

      expect(page().textContent).toContain('publishes nothing of its own');
    });
  });

  describe('the three answers before there is a request', () => {
    it('says so while the chrome is still fetching the repositories', async () => {
      configure({
        provide: QITS_REPOSITORIES,
        useValue: {
          repositories: signal(undefined),
          wrapperRepositoryId: signal(undefined),
          failed: signal(false),
        } satisfies QitsRepositoriesSource,
      });
      await open();

      expect(page().textContent).toContain('Loading the repositories');
      http.expectNone(() => true);
    });

    it('tells a broken chrome apart from a name this project does not hold', async () => {
      configure(provideQitsRepositoryList([], undefined, { failed: true }));
      await open();

      expect(page().textContent).toContain('navigation is unavailable');
      http.expectNone(() => true);
    });

    it('draws the ordinary not-found for a repository the project does not hold', async () => {
      configure(
        provideQitsRepositoryList([{ id: 'other', name: 'qits-docs', category: 'services' }]),
      );
      await open();

      expect(page().textContent).toContain('No such page here');
      http.expectNone(() => true);
    });
  });
});
