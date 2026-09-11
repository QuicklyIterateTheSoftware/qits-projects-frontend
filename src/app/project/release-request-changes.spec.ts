import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsRepositoryList,
  provideQitsScope,
  type QitsNavigation,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type {
  CommitBuildStatusDto,
  ReleaseRequestChangesResponse,
  ReleaseRequestDto,
} from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

/** The repository the five-segment address names, and the project repository the short one does. */
const REPO = 'repo-ci';
const ESTATE = 'repo-qits';

const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';
const RE_ARMED = '5b91d0c4ee2f1a3b7c8d9e0f1a2b3c4d5e6f7081';

const reads = (repoId: string) => ({
  request: `/projects/api/repositories/${repoId}/release-requests/r1`,
  commits: `/projects/api/repositories/${repoId}/release-requests/r1/commits`,
  changes: `/projects/api/repositories/${repoId}/release-requests/r1/changes`,
  diff: `/projects/api/repositories/${repoId}/release-requests/r1/changes/diff`,
  builds: (sha: string) => `/projects/api/repositories/${repoId}/commits/${sha}/builds`,
});

const ON = reads(REPO);

const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-ci',
        label: 'CI',
        host: 'ci.dev.example.test',
        origin: 'https://ci.dev.example.test',
      },
    ],
  },
  applications: {},
};

const VERDICT: CommitBuildStatusDto = {
  runId: 'run-9',
  status: 'SUCCESS',
  branch: 'release/r1',
  gating: true,
  finishedAt: '2026-09-01T13:40:00Z',
};

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: REPO,
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [{ kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false }],
    mergedSha: FOLD,
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

function changeSet(
  overrides: Partial<ReleaseRequestChangesResponse> = {},
): ReleaseRequestChangesResponse {
  return {
    mergedSha: FOLD,
    base: 'aa11bb22cc33dd44ee55ff6677889900aabbccdd',
    baseTag: '2026.910.180413',
    files: [
      { path: '.gitmodules', oldPath: null, changeType: 'MODIFIED' },
      {
        path: 'components/qits-projects/qits-projects-service',
        oldPath: null,
        changeType: 'MODIFIED',
      },
    ],
    truncated: false,
    detail: null,
    ...overrides,
  };
}

/**
 * The Changes tab of a release request: the tab strip that opens it, the two panes it draws, and
 * the read budget behind them.
 *
 * <p>What is worth pinning here is not the markup — the tree and the diff viewer are
 * `@qits/ui-components` and carry their own tests. It is four things this SPA decided. **The
 * address**: the tab rides in `?tab=` and the open file in `?path=`, at both of the two addresses
 * that reach this page, and a switch between tabs keeps the file. **The read budget**: the change
 * set is a fact about the fold, so two polls at the same `mergedSha` cost one read and a re-fold
 * costs a second; the patch is keyed on the fold *and* the path. **The re-arm**: a fold that no
 * longer has the open file says so rather than leaving a patch of the fold that is gone up under
 * the approve button. **The gate**: the approval keeps running while somebody reads the diff,
 * because reading the diff is what being at the gate looks like.
 */
describe('the release request Changes tab', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  beforeEach(() => {
    // Only the two the page's poll uses; faking the whole clock stalls `whenStable()`.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function configure(wrapperId?: string): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsScope('repository'),
        provideQitsNavigationTree(PLATFORM),
        provideQitsProjectList([{ id: 'p1', slug: 'qits', name: 'QITS' }]),
        provideQitsRepositoryList([{ id: REPO, name: 'qits-ci', category: 'services' }], wrapperId),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  async function open(url: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    harness.fixture.detectChanges();
  }

  /** The page's own three reads, which happen on both tabs and are not this tab's business. */
  async function answerThePage(
    row: ReleaseRequestDto,
    verdicts: readonly CommitBuildStatusDto[] = [],
  ): Promise<void> {
    const on = reads(row.repoId);
    http.expectOne(on.request).flush({ request: row });
    await settle();
    http.expectOne(on.commits).flush({ mergedSha: row.mergedSha, commits: [], detail: null });
    await settle();
    if (row.mergedSha) {
      http.expectOne(on.builds(row.mergedSha)).flush({ builds: verdicts });
      await settle();
    }
    harness.fixture.detectChanges();
  }

  async function flushChanges(
    answer: ReleaseRequestChangesResponse = changeSet(),
    repoId = REPO,
  ): Promise<void> {
    http.expectOne(reads(repoId).changes).flush(answer);
    await settle();
    harness.fixture.detectChanges();
  }

  async function flushDiff(path: string, diff: string, repoId = REPO): Promise<void> {
    http
      .expectOne((entry) => entry.url === reads(repoId).diff && entry.params.get('path') === path)
      .flush({ path, changeType: 'MODIFIED', diff });
    await settle();
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function url(): string {
    return TestBed.inject(Router).url;
  }

  function tab(label: string): HTMLAnchorElement {
    return [...page().querySelectorAll('.tabs .tab')].find(
      (anchor) => (anchor.textContent ?? '').trim() === label,
    ) as HTMLAnchorElement;
  }

  /** The row a path is drawn as — a file or a folded directory, both keyed by `data-path`. */
  function row(path: string): HTMLButtonElement | null {
    return page().querySelector(`.qits-change-tree-entry[data-path="${path}"]`);
  }

  describe('the tab strip', () => {
    /**
     * A bare URL pins no tab, and "no tab pinned" is the overview by simple absence — no redirect,
     * no default written into the address.
     */
    it('shows the overview for an address with no ?tab= at all', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1');
      await answerThePage(request());

      expect(text()).toContain('What this release folds in');
      expect(page().querySelector('app-release-request-changes')).toBeNull();
      http.expectNone(ON.changes);
    });

    it('toggles ?tab= on the repository address and keeps ?path= across the switch', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes&path=.gitmodules');
      await answerThePage(request());
      await flushChanges();
      await flushDiff('.gitmodules', '@@ -1 +1 @@\n-old\n+new\n');

      expect(url()).toContain('tab=changes');
      expect(page().querySelector('.line.add')?.textContent).toContain('+new');

      tab('Overview').click();
      await settle();
      harness.fixture.detectChanges();

      expect(url()).toContain('tab=overview');
      // The merge is the whole point: the open file survives a tab that does not draw it.
      expect(url()).toContain('path=.gitmodules');
      expect(text()).toContain('What this release folds in');

      tab('Changes').click();
      await settle();
      harness.fixture.detectChanges();

      expect(url()).toContain('tab=changes');
      expect(url()).toContain('path=.gitmodules');
      // The address is what survives a tab switch, not the component: the tab is an `@if`, so
      // coming back builds a fresh one and it reads the fold it is handed — the same file, open
      // again, because `?path=` was merged through the tab that did not draw it.
      await flushChanges();
      await flushDiff('.gitmodules', '@@ -1 +1 @@\n-old\n+new\n');
      expect(page().querySelector('.line.add')?.textContent).toContain('+new');
    });

    /**
     * The estate's address carries no repository segment, and the tab is the same query parameter
     * there — the two addresses are one page, so they are one tab strip.
     */
    it('toggles ?tab= on the project-scoped address too', async () => {
      configure(ESTATE);
      await open('/qits/release-requests/r1?path=.gitmodules');
      await answerThePage(request({ repoId: ESTATE, repoName: 'qits' }));

      expect(text()).toContain("This is the project's own estate release");

      tab('Changes').click();
      await settle();
      harness.fixture.detectChanges();

      expect(url()).toBe('/qits/release-requests/r1?path=.gitmodules&tab=changes');
      await flushChanges(changeSet(), ESTATE);
      await flushDiff(
        '.gitmodules',
        '@@ -1 +1 @@\n-Subproject commit aaa\n+Subproject commit bbb\n',
        ESTATE,
      );

      expect(text()).toContain('2 files changed since 2026.910.180413.');
      expect(page().querySelector('.line.add')?.textContent).toContain('+Subproject commit bbb');
    });
  });

  describe('the read budget', () => {
    /**
     * The change set is a fact about the fold, not about the tick. The page polls the request every
     * six seconds while it is unsettled; two polls at the same `mergedSha` must cost no git read,
     * and the fold moving must cost exactly one.
     */
    it('reads the change set once for two polls at the same fold, and again when it moves', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges();

      expect(text()).toContain('2 files changed since 2026.910.180413.');

      for (const round of [1, 2]) {
        await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
        http.expectOne(ON.request).flush({ request: request({ detail: `poll ${round}` }) });
        await settle();
        http.expectNone(ON.changes);
      }

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(ON.request).flush({ request: request({ mergedSha: RE_ARMED }) });
      await settle();
      // The page's own fold-keyed reads move with it; so does this tab's.
      http.expectOne(ON.commits).flush({ mergedSha: RE_ARMED, commits: [], detail: null });
      await settle();
      http.expectOne(ON.builds(RE_ARMED)).flush({ builds: [] });
      await settle();
      await flushChanges(changeSet({ mergedSha: RE_ARMED, baseTag: '2026.911.104419' }));

      expect(text()).toContain('2 files changed since 2026.911.104419.');
    });

    /** A selection is an address, and one address is one patch. */
    it('puts a clicked file in ?path= and reads exactly one patch for it', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges();

      expect(text()).toContain('Select a changed file to view its diff.');

      row('.gitmodules')?.click();
      await settle();
      harness.fixture.detectChanges();

      expect(url()).toContain('path=.gitmodules');
      const patches = http.match((entry) => entry.url === ON.diff);
      expect(patches.length).toBe(1);
      expect(patches[0].request.params.get('path')).toBe('.gitmodules');
      patches[0].flush({
        path: '.gitmodules',
        changeType: 'MODIFIED',
        diff: '@@ -1 +1 @@\n-old\n+new\n',
      });
      await settle();
      harness.fixture.detectChanges();

      expect(page().querySelector('.line.add')?.textContent).toContain('+new');
      http.expectNone(ON.changes);
    });
  });

  describe('what the panes say', () => {
    /**
     * The re-arm, which is the whole reason the tab is keyed on the fold. A push lands, the request
     * re-folds, and the file the reader had open is not in the new change set: saying so is the
     * only honest answer, and leaving the old patch up would be the same failure the approve
     * button's 409 exists for.
     */
    it('says an open file is not changed by a fold that re-armed without it', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes&path=.gitmodules');
      await answerThePage(request());
      await flushChanges();
      await flushDiff('.gitmodules', '@@ -1 +1 @@\n-old\n+new\n');

      expect(page().querySelector('.line.add')).not.toBeNull();

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      http.expectOne(ON.request).flush({ request: request({ mergedSha: RE_ARMED }) });
      await settle();
      http.expectOne(ON.commits).flush({ mergedSha: RE_ARMED, commits: [], detail: null });
      await settle();
      http.expectOne(ON.builds(RE_ARMED)).flush({ builds: [] });
      await settle();
      await flushChanges(
        changeSet({
          mergedSha: RE_ARMED,
          files: [{ path: 'README.md', oldPath: null, changeType: 'MODIFIED' }],
        }),
      );

      expect(text()).toContain('.gitmodules is not changed by this fold.');
      // The stale patch is gone, and no patch is read for a file this fold has not got.
      expect(page().querySelector('.line.add')).toBeNull();
      http.expectNone((entry) => entry.url === ON.diff);
    });

    /** The cap is the service's sentence, naming the true total, drawn where the tree is. */
    it('draws the service’s sentence for a truncated change set', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges(
        changeSet({
          truncated: true,
          detail: 'Showing the first 2000 of 4137 changed files.',
        }),
      );

      expect(text()).toContain('Showing the first 2000 of 4137 changed files.');
      expect(row('.gitmodules')).not.toBeNull();
    });

    /** An empty list is an answer, and the reason for it is the service's prose and not ours. */
    it('draws the service’s sentence where the tree would be when nothing changed', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges(
        changeSet({
          files: [],
          detail: 'The fold changed nothing over what the previous release shipped',
        }),
      );

      expect(text()).toContain('The fold changed nothing over what the previous release shipped');
      expect(page().querySelector('qits-change-tree')).toBeNull();
    });

    /** A repository that has never released is diffed against the empty tree, and says so. */
    it('names the empty tree rather than a tag on a repository that has never released', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges(changeSet({ base: null, baseTag: null }));

      expect(text()).toContain('this repository has not released yet');
    });
  });

  /**
   * The gate keeps running on this tab, and that is the point of keeping the request on the page
   * rather than in a route of its own: a reader who opened Changes has not stopped being at the
   * gate, they have started reading it.
   */
  it('still draws the gates panel and can approve with the Changes tab open', async () => {
    configure();
    await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
    await answerThePage(request({ approvalRequired: true, approvalState: 'WAITING' }), [VERDICT]);
    await flushChanges();

    expect(page().querySelector('.gates .verdict')?.textContent).toContain('success');

    const approve = [...page().querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('Approve release'),
    ) as HTMLButtonElement;
    approve.click();
    await settle();
    harness.fixture.detectChanges();
    approve.click();
    await settle();

    const posted = http.expectOne(`${ON.request}/approve`);
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

    expect(text()).toContain('approved by someone');
    // The decision did not move the fold, so the tab's change set is not read again.
    http.expectNone(ON.changes);
    expect(text()).toContain('2 files changed since 2026.910.180413.');
  });
});
