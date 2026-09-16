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
  CommitFileChangeDto,
  ReleaseRequestChangesResponse,
  ReleaseRequestDto,
  SubmoduleChangesDto,
  SubmoduleRefDto,
} from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

/** The repository the five-segment address names, and the project repository the short one does. */
const REPO = 'repo-ci';
const ESTATE = 'repo-qits';

const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';
const RE_ARMED = '5b91d0c4ee2f1a3b7c8d9e0f1a2b3c4d5e6f7081';

/** One gitlink of an estate fold, at the path the component layout mounts a submodule on. */
const GITLINK = 'components/qits-projects/qits-projects-service';
const PIN_WAS = '1111111111111111111111111111111111111111';
const PIN_NOW = '2222222222222222222222222222222222222222';

const reads = (repoId: string) => ({
  request: `/projects/api/repositories/${repoId}/release-requests/r1`,
  commits: `/projects/api/repositories/${repoId}/release-requests/r1/commits`,
  changes: `/projects/api/repositories/${repoId}/release-requests/r1/changes`,
  diff: `/projects/api/repositories/${repoId}/release-requests/r1/changes/diff`,
  submodule: `/projects/api/repositories/${repoId}/release-requests/r1/changes/submodule`,
  submoduleDiff: `/projects/api/repositories/${repoId}/release-requests/r1/changes/submodule/diff`,
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
      // The git host, so a submodule's pins have somewhere to point.
      {
        app: 'qits-githost',
        label: 'Code',
        host: 'githost.dev.example.test',
        origin: 'https://githost.dev.example.test',
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

/** An ordinary file the fold touched — every wire field, so the fixtures cannot drift from the DTO. */
function file(path: string, overrides: Partial<CommitFileChangeDto> = {}): CommitFileChangeDto {
  return {
    path,
    oldPath: null,
    changeType: 'MODIFIED',
    oldMode: '100644',
    newMode: '100644',
    oldSha: 'aaaaaaa',
    newSha: 'bbbbbbb',
    submodule: null,
    ...overrides,
  };
}

/**
 * A gitlink the fold moves, labelled as the service labels one: `160000` on both sides and a
 * `submodule` naming the sibling. A `detail` makes it one the reader cannot expand.
 */
function gitlink(path = GITLINK, ref: Partial<SubmoduleRefDto> = {}): CommitFileChangeDto {
  return file(path, {
    oldMode: '160000',
    newMode: '160000',
    oldSha: PIN_WAS,
    newSha: PIN_NOW,
    submodule: {
      repositoryId: 'repo-projects-service',
      name: 'qits-projects-service',
      oldSha: PIN_WAS,
      newSha: PIN_NOW,
      detail: null,
      ...ref,
    },
  });
}

function changeSet(
  overrides: Partial<ReleaseRequestChangesResponse> = {},
): ReleaseRequestChangesResponse {
  return {
    mergedSha: FOLD,
    base: 'aa11bb22cc33dd44ee55ff6677889900aabbccdd',
    baseTag: '2026.910.180413',
    files: [file('.gitmodules'), file(GITLINK)],
    truncated: false,
    detail: null,
    ...overrides,
  };
}

/** The same fold, with the second entry spelled as the gitlink an estate release actually moves. */
function wrapperSet(ref: Partial<SubmoduleRefDto> = {}): ReleaseRequestChangesResponse {
  return changeSet({ files: [file('.gitmodules'), gitlink(GITLINK, ref)] });
}

function expansion(overrides: Partial<SubmoduleChangesDto> = {}): SubmoduleChangesDto {
  return {
    path: GITLINK,
    repositoryId: 'repo-projects-service',
    name: 'qits-projects-service',
    oldSha: PIN_WAS,
    newSha: PIN_NOW,
    commits: [
      {
        hash: '9999999999999999999999999999999999999999',
        shortHash: '9999999',
        author: 'someone',
        email: 'someone@example.test',
        date: '2026-09-01T12:00:00Z',
        message: 'a gitlink is drawn as its two pins',
        files: ['src/Main.java'],
      },
    ],
    // Relative to the SUBMODULE, which is the whole reason the page joins and splits.
    files: [file('src/Main.java')],
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

  /**
   * A submodule's row has two controls, so it is not the single `…-entry` button every other row
   * is: the label is what selects, and that is the one a reader presses to ask for the commits.
   */
  function label(path: string): HTMLButtonElement | null {
    return page().querySelector(`.qits-change-tree-label[data-path="${path}"]`);
  }

  async function flushExpansion(
    answer: SubmoduleChangesDto = expansion(),
    repoId = REPO,
  ): Promise<void> {
    http
      .expectOne(
        (entry) =>
          entry.url === reads(repoId).submodule && entry.params.get('path') === answer.path,
      )
      .flush(answer);
    await settle();
    harness.fixture.detectChanges();
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
          files: [file('README.md')],
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
   * A wrapper's release is almost entirely gitlinks, and its own patch for one is a pair of opaque
   * `Subproject commit` lines. What is pinned here is the shape of the answer to that: one address
   * space (`?path=` holds `<gitlink>/<file inside it>` and nothing else), the expansion asked for by
   * the *address* rather than by the click, the sibling's files spliced into the same tree, and the
   * patch of one of them routed to the sibling's own read with the join taken apart again.
   */
  describe('a submodule this fold moves', () => {
    it('expands on a click and hoists the sibling’s files into the same tree', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges(wrapperSet());

      // The lede counts the pins as a share of the files, because a gitlink is one of the entries.
      expect(text()).toContain('2 files changed since 2026.910.180413, 1 of them a submodule pin.');

      // Before it is expanded the gitlink is a leaf, so it is the ordinary single-control row.
      row(GITLINK)?.click();
      await settle();
      harness.fixture.detectChanges();

      expect(url()).toContain(`path=${encodeURIComponent(GITLINK)}`);
      // A gitlink's row is not a patch: the `Subproject commit` diff is never asked for.
      http.expectNone((entry) => entry.url === ON.diff);
      await flushExpansion();

      // The pins, the sibling's commits, and its files under the path they belong to.
      expect(text()).toContain('a gitlink is drawn as its two pins');
      expect(text()).toContain('1111111');
      expect(text()).toContain('2222222');
      expect(row(`${GITLINK}/src/Main.java`)).not.toBeNull();
      // The row now means two things, so it draws two controls and the label is what selects.
      expect(label(GITLINK)).not.toBeNull();

      const pin = page().querySelector('.pins a') as HTMLAnchorElement;
      expect(pin.href).toBe(
        `https://githost.dev.example.test/qits/qits-projects/qits-projects-service/commit/${PIN_WAS}`,
      );
    });

    /**
     * The deep link, which is the whole reason the *address* asks for the expansion rather than the
     * click: a link pasted into a chat has to land on the file, not on a tree somebody must re-open.
     */
    it('expands on arrival for a ?path= that lies inside a gitlink, with no interaction', async () => {
      configure();
      await open(
        `/qits/services/qits-ci/release-requests/r1?tab=changes&path=${GITLINK}/src/Main.java`,
      );
      await answerThePage(request());
      await flushChanges(wrapperSet());

      // No click happened, and the expansion is already in flight.
      await flushExpansion();

      // The patch is the SIBLING's, and the address is taken apart into the two halves it holds.
      const patches = http.match((entry) => entry.url === ON.submoduleDiff);
      expect(patches.length).toBe(1);
      expect(patches[0].request.params.get('path')).toBe(GITLINK);
      expect(patches[0].request.params.get('file')).toBe('src/Main.java');
      // And never the wrapper's own diff, which has no such path in it.
      http.expectNone((entry) => entry.url === ON.diff);
      patches[0].flush({
        path: 'src/Main.java',
        changeType: 'MODIFIED',
        diff: '@@ -1 +1 @@\n-old\n+new\n',
      });
      await settle();
      harness.fixture.detectChanges();

      expect(page().querySelector('.line.add')?.textContent).toContain('+new');
    });

    /**
     * A gitlink the service will not expand — added, removed, or naming a repository this project
     * does not have. The sentence is the service's, and the two pins are still drawn: nobody is
     * worse off than they were with the `Subproject commit` patch.
     */
    it('draws the service’s sentence for a gitlink it cannot expand, and asks for nothing', async () => {
      configure();
      await open('/qits/services/qits-ci/release-requests/r1?tab=changes');
      await answerThePage(request());
      await flushChanges(
        wrapperSet({ repositoryId: null, oldSha: null, detail: 'Added by this release.' }),
      );

      row(GITLINK)?.click();
      await settle();
      harness.fixture.detectChanges();

      expect(text()).toContain('Added by this release.');
      expect(text()).toContain('2222222');
      http.expectNone((entry) => entry.url === ON.submodule);
      http.expectNone((entry) => entry.url === ON.diff);
    });

    /**
     * An expansion is a fact about two pins, so it follows the same budget the change set does: a
     * poll that moved nothing re-reads nothing at all.
     */
    it('does not re-read an expansion for a poll that did not move the fold', async () => {
      configure();
      await open(`/qits/services/qits-ci/release-requests/r1?tab=changes&path=${GITLINK}`);
      await answerThePage(request());
      await flushChanges(wrapperSet());
      await flushExpansion();

      expect(text()).toContain('a gitlink is drawn as its two pins');

      for (const round of [1, 2]) {
        await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
        http.expectOne(ON.request).flush({ request: request({ detail: `poll ${round}` }) });
        await settle();
        harness.fixture.detectChanges();
        http.expectNone(ON.changes);
        http.expectNone((entry) => entry.url === ON.submodule);
      }

      expect(text()).toContain('a gitlink is drawn as its two pins');
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
