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
  CommitBuildStatusDto,
  ListCommitBuildsResponse,
  ReleaseArtifactsResponse,
  ReleaseRequestCommitsResponse,
  ReleaseRequestDto,
} from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

/**
 * Every read this page makes, for one repository ROW ID — which is the whole of what the two arms
 * of `repoId()` produce, so addressing the expectations by id is what proves the right arm ran.
 */
const reads = (repoId: string) => ({
  request: `/projects/api/repositories/${repoId}/release-requests/r1`,
  commits: `/projects/api/repositories/${repoId}/release-requests/r1/commits`,
  artifacts: `/projects/api/repositories/${repoId}/release-requests/r1/artifacts`,
  /** The verdicts are addressed by the COMMIT rather than by the request — the service's shape. */
  builds: (sha: string) => `/projects/api/repositories/${repoId}/commits/${sha}/builds`,
});

/** The repository the five-segment address names, and the project repository the short one does. */
const REPO = 'repo-ci';
const ESTATE = 'repo-qits';

const REQUEST = reads(REPO).request;
const COMMITS = reads(REPO).commits;
const ARTIFACTS = reads(REPO).artifacts;
const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';

const builds = reads(REPO).builds;

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
      // The gates panel's one link. qits-ci serves `runs/:runId` at its own root and under no
      // repository-scoped address, which is why that href is composed with no scope at all.
      {
        app: 'qits-ci',
        label: 'CI',
        host: 'ci.dev.example.test',
        origin: 'https://ci.dev.example.test',
      },
    ],
    // The maintenance client hangs under the platform heading rather than a repository's, which is
    // where its own `deployments.yml` puts it — and `href` reads the first entry for an application
    // whichever slot it is filed under, so the row's placement is not this page's business.
    platform: [
      {
        app: 'qits-platform-maintenance',
        label: 'Maintenance',
        host: 'maintenance.dev.example.test',
        origin: 'https://maintenance.dev.example.test',
      },
    ],
  },
  applications: {},
};

/**
 * The same platform with qits-platform-maintenance served nowhere — the "cannot spell it" case, and
 * the only honest way to produce one: `QitsAppLinks.href` answers `undefined` for an application the
 * navigation names in no entry.
 */
const WITHOUT_MAINTENANCE: QitsNavigation = {
  ...PLATFORM,
  slots: { 'services.details': PLATFORM.slots?.['services.details'] ?? [] },
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
      provideQitsRepositoryList([{ id: REPO, name: 'qits-ci', category: 'services' }]),
      ...providers,
    );
  }

  /**
   * The same chrome, also naming the project's wrapper — its second argument, and deliberately not
   * one of the rows: a wrapper is not its own submodule, so the project-scoped address has to learn
   * the estate's id from `wrapperRepositoryId` and could not find it in the list if it tried.
   */
  function withEstate(...providers: unknown[]): void {
    configure(
      provideQitsRepositoryList([{ id: REPO, name: 'qits-ci', category: 'services' }], ESTATE),
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
   * Answer the request read, and then whatever it triggered: the commits always, the CI verdicts
   * wherever there is a fold to ask about, the artifacts only once the answer says RELEASED — which
   * is the read budget itself, asserted by construction.
   *
   * <p>The verdicts read is skipped for a request with no `mergedSha` on purpose and not as a
   * convenience: that route is addressed by a commit hash there is nothing to put in, so the page
   * does not ask, and a helper that flushed one anyway would hide the day it started asking.
   *
   * <p><b>The addresses come from the ROW's own `repoId`</b>, which is what makes this helper say
   * something about the two arms of `repoId()`: the page resolved an id from the chrome, and every
   * read below is expected at the id the answered request belongs to. A page that resolved the
   * wrong one — the wrapper for a named repository, or a name for the project-scoped address — has
   * no expectation to satisfy and fails here rather than quietly reading somebody else's request.
   */
  async function answer(
    row: ReleaseRequestDto,
    commits: Partial<ReleaseRequestCommitsResponse> = {},
    artifacts: Partial<ReleaseArtifactsResponse> | null = null,
    verdicts: readonly CommitBuildStatusDto[] = [],
  ): Promise<void> {
    const on = reads(row.repoId);
    http.expectOne(on.request).flush({ request: row });
    await settle();
    http.expectOne(on.commits).flush({
      mergedSha: row.mergedSha,
      commits: [],
      detail: null,
      ...commits,
    } satisfies ReleaseRequestCommitsResponse);
    await settle();
    if (row.mergedSha) {
      http
        .expectOne(on.builds(row.mergedSha))
        .flush({ builds: verdicts } satisfies ListCommitBuildsResponse);
      await settle();
    }
    if (row.state === 'RELEASED') {
      http
        .expectOne(on.artifacts)
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
     * Four reads and no more. The name-to-id resolution is the chrome's list, which the shared
     * layout has already fetched — so nothing here reaches the project's component listing, which
     * refreshes the wrapper's git mirror.
     */
    it('costs the request, its commits, its verdicts and — once released — its artifacts', async () => {
      withRepositories();
      await open();

      // One at a time, in order: each read is triggered by the answer before it, so a page that
      // fanned out or asked twice would show up as a different list at one of these four steps.
      const first = http.match(() => true);
      expect(first.map((entry) => entry.request.url)).toEqual([REQUEST]);
      first[0].flush({ request: released() });
      await settle();

      const second = http.match(() => true);
      expect(second.map((entry) => entry.request.url)).toEqual([COMMITS]);
      second[0].flush({ mergedSha: null, commits: [], detail: null });
      await settle();

      const third = http.match(() => true);
      expect(third.map((entry) => entry.request.url)).toEqual([builds(FOLD)]);
      third[0].flush({ builds: [] });
      await settle();

      const fourth = http.match(() => true);
      expect(fourth.map((entry) => entry.request.url)).toEqual([ARTIFACTS]);
      fourth[0].flush(NOTHING_PUBLISHED);
      await settle();

      http.expectNone(() => true);
    });

    /**
     * The verdicts route is addressed by a commit hash, and a request that has not been folded has
     * none. Asking anyway would be a read with a made-up coordinate in it; the page draws the empty
     * answer, which the panel says as "no verdict yet" — exactly true of a fold that does not exist.
     */
    it('asks for no verdicts about a request with no fold', async () => {
      withRepositories();
      await open();
      await answer(request({ mergedSha: null }), NOTHING_FOLDED);

      http.expectNone((entry) => entry.url.includes('/builds'));
      expect(page().textContent).toContain('No verdict yet');
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
    it('re-reads the commits and the verdicts when the fold moves, and not when it does not', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }));

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(REQUEST).flush({ request: request({ state: 'PENDING', detail: 'still' }) });
      await settle();
      http.expectNone(COMMITS);
      http.expectNone(builds(FOLD));

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http
        .expectOne(REQUEST)
        .flush({ request: request({ state: 'PENDING', mergedSha: 'aaaa1111bbbb2222' }) });
      await settle();
      http.expectOne(COMMITS).flush({ mergedSha: 'aaaa1111bbbb2222', commits: [], detail: null });
      await settle();
      // A verdict is a fact about a commit, so the new fold is a new question by construction.
      http.expectOne(builds('aaaa1111bbbb2222')).flush({ builds: [] });
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

    /** The request's own badge is the highest of its branches, and it says so on hover. */
    it('badges the effective priority, and nothing where the service gave none', async () => {
      withRepositories();
      await open();
      await answer(request({ priority: 'HIGHER' }));

      expect(page().querySelector('.head .priority')?.textContent).toContain('higher');
      expect(page().querySelector('.head .priority')?.getAttribute('title')).toContain(
        'highest priority among',
      );

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(REQUEST).flush({ request: request() });
      await settle();
      harness.fixture.detectChanges();
      expect(page().querySelector('.head .priority')).toBeNull();
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

  /**
   * What is holding the request, drawn between the facts and the conflict. The panel owns the two
   * verbs and this page owns the read behind it — so what is worth pinning here is the wiring: the
   * verdicts of the fold reach it, the badge above it agrees with it, and a decision replaces the row
   * rather than costing the page its four reads over again.
   */
  describe('the gates', () => {
    const VERDICT: CommitBuildStatusDto = {
      runId: 'run-9',
      status: 'SUCCESS',
      branch: 'release/r1',
      gating: true,
      finishedAt: '2026-09-01T13:40:00Z',
    };

    /** The run link carries **no scope**: qits-ci serves `runs/:runId` at its own root and nowhere else. */
    it('draws the verdicts of the fold and links the run in qits-ci', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING' }), {}, null, [VERDICT]);

      expect(page().querySelector('.gates .verdict')?.textContent).toContain('success');
      expect(hrefs()).toContain('https://ci.dev.example.test/runs/run-9');
    });

    /**
     * An ordinary repository releases on a green build alone, so there is no approve affordance
     * anywhere on the page — the service answers 409 to approving what has no gate.
     */
    it('offers no approval affordance on a request nobody has to approve', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'PENDING', approvalRequired: false }), {}, null, [VERDICT]);

      expect(page().textContent).not.toContain('Approval');
      expect(page().querySelector('.gates .ask')).toBeNull();
    });

    /**
     * The wrapper's case, end to end: the badge says a person is needed, the panel asks, and the
     * answered request goes in place of the row — no re-read, because the whole request came back and
     * a decision does not move the fold.
     */
    it('says a gated request is awaiting approval, and replaces the row when it is approved', async () => {
      withRepositories();
      await open();
      await answer(
        request({ state: 'PENDING', approvalRequired: true, approvalState: 'WAITING' }),
        {},
        null,
        [VERDICT],
      );

      expect(page().querySelector('.head qits-badge')?.textContent).toContain('awaiting approval');

      const approve = [...page().querySelectorAll('button')].find((button) =>
        (button.textContent ?? '').includes('Approve release'),
      ) as HTMLButtonElement;
      approve.click();
      await settle();
      harness.fixture.detectChanges();
      approve.click();
      await settle();

      const posted = http.expectOne(`${REQUEST}/approve`);
      expect(posted.request.body).toEqual({ mergedSha: FOLD });
      posted.flush({
        request: request({
          state: 'READY',
          approvalRequired: true,
          approvalState: 'APPROVED',
          approvedBy: 'someone',
          approvedAt: '2026-09-01T13:45:00Z',
        }),
      });
      await settle();
      harness.fixture.detectChanges();

      expect(page().querySelector('.head qits-badge')?.textContent).toContain('ready');
      expect(page().textContent).toContain('approved by someone');
      // The fold did not move, so neither read behind it is asked for again.
      http.expectNone(COMMITS);
      http.expectNone(builds(FOLD));
    });
  });

  /**
   * The one place a priority can be changed. This page is where somebody has already decided which
   * release they care about, which is why the control is here and not on the lists — and what is
   * worth pinning is that the answer replaces the row instead of costing three reads over again.
   */
  describe('changing what a branch is worth', () => {
    const BRANCHES: readonly ReleaseRequestDto['sources'][number][] = [
      { kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false, priority: 'MEDIUM' },
      {
        kind: 'BRANCH',
        name: 'adhoc-changes',
        ref: 'refs/heads/adhoc-changes',
        implicit: false,
        priority: 'MEDIUM',
      },
      {
        kind: 'RELEASED_TAG',
        name: '2026.903.1',
        ref: 'refs/tags/2026.903.1',
        implicit: true,
      },
    ];

    function pickers(): readonly HTMLSelectElement[] {
      return [...page().querySelectorAll('select')];
    }

    /** The derived tag has no priority to have, so it is not offered one. */
    it('offers a select on every named branch and none on the tags', async () => {
      withRepositories();
      await open();
      await answer(request({ sources: BRANCHES, priority: 'MEDIUM' }));

      expect(pickers().map((picker) => picker.getAttribute('aria-label'))).toEqual([
        'Priority of main',
        'Priority of adhoc-changes',
      ]);
    });

    /**
     * The whole request comes back with its effective priority recomputed, and it is put in place of
     * the row that was there. Nothing else is re-read: a priority does not move the fold, so the
     * commits on screen are the same commits.
     */
    it('posts the change and takes the answer in place of a re-read', async () => {
      withRepositories();
      await open();
      await answer(request({ sources: BRANCHES, priority: 'MEDIUM' }));

      pickers()[1].value = 'BLOCKING';
      pickers()[1].dispatchEvent(new Event('change'));
      await settle();

      const posted = http.expectOne(`${REQUEST}/sources/priority`);
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({ branch: 'adhoc-changes', priority: 'BLOCKING' });
      posted.flush({
        request: request({
          sources: [BRANCHES[0], { ...BRANCHES[1], priority: 'BLOCKING' }, BRANCHES[2]],
          priority: 'BLOCKING',
        }),
      });
      await settle();
      harness.fixture.detectChanges();

      expect(page().querySelector('.head .priority')?.textContent).toContain('blocking');
      // The fold did not move, so neither read behind it is asked for again.
      http.expectNone(COMMITS);
      http.expectNone(ARTIFACTS);
    });

    /**
     * A released request refuses every change, and the service would answer 409. The control stays
     * on the page and goes inert: what each branch was worth is part of what shipped.
     */
    it('leaves the selects inert once the request is released', async () => {
      withRepositories();
      await open();
      await answer(released({ sources: BRANCHES }));

      expect(pickers()).toHaveLength(2);
      expect(pickers().every((picker) => picker.disabled)).toBe(true);
    });

    it('leaves them inert on a withdrawn request too', async () => {
      withRepositories();
      await open();
      await answer(request({ state: 'WITHDRAWN', sources: BRANCHES }));

      expect(pickers().every((picker) => picker.disabled)).toBe(true);
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

    /**
     * **The train link's scope is the PROJECT alone**, the same shape and the same reason the
     * deployment link has: qits-platform-maintenance serves its addresses bare and under a project
     * slug and under no repository-scoped one. It is addressed by repository NAME rather than by the
     * row id, because that inventory is keyed by name and the name is the coordinate the two
     * services share.
     */
    it('links the release train of the version, scoped to the project alone', async () => {
      withRepositories();
      await open();
      await answer(released());

      expect(page().textContent).toContain('The release train of this version');
      expect(hrefs()).toContain(
        'https://maintenance.dev.example.test/qits/trains/by-release/qits-ci/2026.904.161524',
      );
    });

    /**
     * Unlike the deployment link, this one is offered for a release that deploys nothing: a library
     * is precisely the case a train is most about, because the hops its release opens are its whole
     * effect on the platform.
     */
    it('links the train of a release nothing deploys', async () => {
      withRepositories();
      await open();
      await answer(released(), {}, { deployable: false });

      expect(page().textContent).toContain('The release train of this version');
    });

    /** An application the platform serves nowhere has no address, and gets no anchor. */
    it('offers no train link where the platform serves no maintenance client', async () => {
      withRepositories(provideQitsNavigationTree(WITHOUT_MAINTENANCE));
      await open();
      await answer(released());

      expect(page().textContent).not.toContain('The release train of this version');
      // The tag still links, so this is the one application missing rather than a bare navigation.
      expect(hrefs()).toContain(
        'https://githost.dev.example.test/qits/services/qits-ci/tags/2026.904.161524',
      );
    });

    /** A request from before the service recorded the repository's name cannot spell the address. */
    it('offers no train link for a release that names no repository', async () => {
      withRepositories();
      await open();
      await answer(released({ repoName: null }));

      expect(page().textContent).not.toContain('The release train of this version');
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

  /**
   * The project's own release request, at `/qits/release-requests/r1`.
   *
   * <p>Two things are under test and the markup is neither. **The second arm**: the address names no
   * repository, so the id every read is keyed by comes from the chrome's wrapper — which is asserted
   * by construction, because the helper expects each read at the answered row's own repository.
   * **The framing**: the same page says what is being released when the repository is the project
   * itself, and puts the approval above the fold, because on the estate the outstanding question is
   * the approval and not which branches folded together.
   */
  describe('the project’s own release request', () => {
    const AT = '/qits/release-requests/r1';

    /** The estate's request: the row the service answers for the project repository. */
    function estate(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
      return request({ repoId: ESTATE, repoName: 'qits-qits', ...overrides });
    }

    /** Where the two panels sit relative to one another, in document order. */
    function panelOrder(): readonly string[] {
      return [...page().querySelectorAll('app-release-gates-panel, app-release-sources')].map(
        (element) => element.tagName.toLowerCase(),
      );
    }

    /**
     * No repository segment, and that is not an omission: the address is the project's, so the
     * request it names is the project's own — and the id it is read by is the chrome's wrapper.
     */
    it('reads by the wrapper’s row id, which the address never spells', async () => {
      withEstate();
      await open(AT);
      await answer(estate());

      expect(page().textContent).toContain('A change worth releasing');
      // The helper expected every read at `repo-qits`; nothing was asked of the named repository.
      http.expectNone((entry) => entry.url.includes(REPO));
    });

    it('says what is being released is the project’s estate', async () => {
      withEstate();
      await open(AT);
      await answer(estate());

      expect(page().textContent).toContain('estate release');
      expect(page().textContent).toContain('which commit of every component');
    });

    /** The approval first, the fold after it — the whole of the wrapper's framing. */
    it('asks the approval before the fold', async () => {
      withEstate();
      await open(AT);
      await answer(estate());

      expect(panelOrder()).toEqual(['app-release-gates-panel', 'app-release-sources']);
    });

    /** One page, two addresses — and a repository's version is still a repository's version. */
    it('frames a named repository’s request exactly as it did', async () => {
      withEstate();
      await open();
      await answer(request());

      expect(page().textContent).not.toContain('estate release');
      expect(panelOrder()).toEqual(['app-release-sources', 'app-release-gates-panel']);
    });

    /**
     * A project with no project repository has no estate to release, so its address is the 404 it
     * is — told apart from a chrome still fetching and from one that gave up, as the three answers
     * below always were.
     */
    it('draws the ordinary not-found where the chrome holds no wrapper', async () => {
      withRepositories();
      await open(AT);

      expect(page().textContent).toContain('No such page here');
      http.expectNone(() => true);
    });

    /** The wrapper's id arrives from the same read the names do, so the waiting arm is unchanged. */
    it('says it is loading the repositories until that read has answered', async () => {
      configure({
        provide: QITS_REPOSITORIES,
        useValue: {
          repositories: signal(undefined),
          wrapperRepositoryId: signal(undefined),
          failed: signal(false),
        } satisfies QitsRepositoriesSource,
      });
      await open(AT);

      expect(page().textContent).toContain('Loading the repositories');
      http.expectNone(() => true);
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
