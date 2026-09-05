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
import type { ReleaseRequestDto } from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

const LIST = '/projects/api/repositories/repo-ci/release-requests';

/** The chrome, answered from literals — so every request in these specs is the page's own. */
const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {},
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
      {
        kind: 'BRANCH',
        name: 'adhoc-changes',
        ref: 'refs/heads/adhoc-changes',
        implicit: false,
      },
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

/**
 * One repository's release requests.
 *
 * <p>Four things here are worth pinning and none of them is the markup. **The request budget**:
 * the address names a repository by name and the API is keyed by its row id, and the whole point of
 * resolving that through the chrome's list is that the page costs exactly one read. **The timer**:
 * this is the only page in this application that polls, and what makes that acceptable is that it
 * stops — a repository whose requests have all concluded must arm nothing. **The withdraw**: it is
 * destructive, so it asks in the button, and the answer replaces the row rather than costing a
 * re-read. **The way in**: every row's summary is a relative link to that request's own page, which
 * is where the reads a list must not make live.
 */
describe('RepositoryReleaseRequestsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  beforeEach(() => {
    // Only the two the page uses. Faking the whole clock stalls `fixture.whenStable()`, which
    // schedules its own work — the same narrowing the backup panel's spec makes.
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

  async function open(url = '/qits/services/qits-ci/release-requests'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    harness.fixture.detectChanges();
  }

  /** Answer the page's list read with these rows, and settle whatever that redraws. */
  async function answer(requests: readonly ReleaseRequestDto[]): Promise<void> {
    http.expectOne(LIST).flush({ requests });
    await settle();
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = [...page().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(
        `No button labelled '${label}' — saw: ${[...page().querySelectorAll('button')]
          .map((b) => b.textContent?.trim())
          .join(', ')}`,
      );
    }
    return found;
  }

  async function press(label: string): Promise<void> {
    buttonNamed(label).click();
    await settle();
    harness.fixture.detectChanges();
  }

  describe('the request budget', () => {
    /**
     * The number the design is for. The name-to-id resolution is the chrome's list, which the
     * shared layout has already fetched to draw the sidebar — so opening this page costs one read
     * and never the project's component listing, which refreshes the wrapper's git mirror.
     */
    it('costs exactly one read to open, and it is the release-request listing', async () => {
      withRepositories();
      await open();

      const asked = http.match(() => true);
      expect(asked.map((entry) => entry.request.urlWithParams)).toEqual([LIST]);
      asked[0].flush({ requests: [] });
      await settle();
      http.expectNone(() => true);
    });

    it('arms no timer for a repository whose requests have all concluded', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'RELEASED', version: '2026.901.134748' })]);

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).not.toContain('Watching for changes');
    });

    it('reads again while something is still moving, and stops when it settles', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);
      expect(page().textContent).toContain('Watching for changes');

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      await answer([request({ state: 'RELEASED', version: '2026.901.134748' })]);

      // The state that arrived is terminal, so the page stops asking of its own accord.
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).toContain('released');
    });

    it('keeps the rows on screen while a poll is in flight, so nothing flickers', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING', summary: 'A change worth releasing' })]);

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      // The second read has been issued and not answered — the first read's rows are still drawn.
      expect(page().textContent).toContain('A change worth releasing');
      http.expectOne(LIST).flush({ requests: [request({ state: 'PENDING' })] });
      await settle();
    });
  });

  describe('what a row says', () => {
    it('draws the state, every source, the fold, who asked and when', async () => {
      withRepositories();
      await open();
      await answer([
        request({
          state: 'REJECTED',
          requester: 'dyn-workspace-601',
          detail: 'A gating build went red',
        }),
      ]);

      const text = page().textContent ?? '';
      expect(text).toContain('rejected');
      expect(text).toContain('main');
      expect(text).toContain('adhoc-changes');
      expect(text).toContain('20c377e');
      expect(text).not.toContain('20c377ee71fabe');
      expect(text).toContain('dyn-workspace-601');
      expect(text).toContain('A gating build went red');
    });

    /**
     * The two kinds are not the same fact: a named branch is somebody's choice, a released tag is
     * what the service folds in underneath and nobody can take off. They are drawn apart.
     */
    it('tells the tags it folds in on its own apart from the branches somebody named', async () => {
      withRepositories();
      await open();
      await answer([
        request({
          sources: [
            { kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false },
            {
              kind: 'RELEASED_TAG',
              name: '2026.903.1',
              ref: 'refs/tags/2026.903.1',
              implicit: true,
            },
          ],
        }),
      ]);

      const chips = [...page().querySelectorAll('li.source')];
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['main', '2026.903.1']);
      expect(chips[0].classList.contains('implicit')).toBe(false);
      expect(chips[1].classList.contains('implicit')).toBe(true);
      expect(chips[1].getAttribute('title')).toContain('has not reached main yet');
    });

    /** Null is "nothing is gated yet", which is not the same sentence as "nothing to release". */
    it('draws the em dash for a request whose first fold has not landed', async () => {
      withRepositories();
      await open();
      await answer([request({ mergedSha: null })]);

      const merged = page().querySelector('.fact')?.textContent ?? '';
      expect(merged).toContain('—');
      expect(page().querySelector('.fact .ref')?.getAttribute('title')).toContain('release/r1');
    });

    /**
     * A release is a tag and `main` is finalized after the deployment succeeds, so a version that
     * shipped and has not reached `main` is a real state — mid-deployment, or stuck — and this row
     * is the only place either is visible.
     */
    it('names the version a released request landed as, and says it is not on main yet', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'RELEASED', version: '2026.901.134748' })]);

      expect(page().textContent).toContain('2026.901.134748');
      expect(page().textContent).toContain('not on main yet');
    });

    it('says so once the release has reached main', async () => {
      withRepositories();
      await open();
      await answer([
        request({
          state: 'RELEASED',
          version: '2026.901.134748',
          mergedToMainAt: '2026-09-01T14:02:11Z',
        }),
      ]);

      expect(page().textContent).toContain('on main');
      expect(page().textContent).not.toContain('not on main yet');
    });

    /**
     * The one state on this page a person has to act on, and the action is somewhere else — so the
     * row has to say exactly what to resolve without a second read.
     */
    it('draws the conflict, its paths and whose head introduced them', async () => {
      withRepositories();
      await open();
      await answer([
        request({
          state: 'CONFLICTED',
          mergedSha: null,
          detail: 'The sources could not be folded (a push): pom.xml',
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
      ]);

      const panel = page().querySelector('.conflict');
      expect(panel).not.toBeNull();
      const text = panel?.textContent ?? '';
      expect(text).toContain('release/r1');
      expect(text).toContain('pom.xml');
      expect(text).toContain('2026.903.1');
      expect(text).toContain('9f1c2b3');
      expect(text).toContain('content');
      expect(page().textContent).toContain('conflicted');
    });

    /**
     * A conflict answers the same on every knock and the service's sweep does not re-fold one, so
     * watching it would be a poll waiting for a push — the rejected-request argument exactly.
     */
    it('shows a conflicted request without watching it', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'CONFLICTED', mergedSha: null })]);

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).not.toContain('Watching for changes');
    });

    /**
     * The row is the way in. The link is relative — this page's address plus the request's id — so
     * the list and the detail page cannot spell two different addresses for one request.
     */
    it('links each summary to that request own page, relatively', async () => {
      withRepositories();
      await open();
      await answer([request({ id: 'r7', summary: 'A change worth releasing' })]);

      const link = page().querySelector<HTMLAnchorElement>('a.summary');
      expect(link?.textContent?.trim()).toBe('A change worth releasing');
      expect(link?.getAttribute('href')).toBe('/qits/services/qits-ci/release-requests/r7');
    });

    /** The tail the route's default carries: a release stays on the page after it lands. */
    it('draws a landed release beside the open work', async () => {
      withRepositories();
      await open();
      await answer([
        request({ id: 'open', state: 'PENDING', summary: 'Still going' }),
        request({
          id: 'done',
          state: 'RELEASED',
          summary: 'Just landed',
          version: '2026.904.161524',
        }),
      ]);

      const text = page().textContent ?? '';
      expect(text).toContain('Still going');
      expect(text).toContain('Just landed');
      expect(text).toContain('2026.904.161524');
    });

    it('draws no conflict panel on a request that has none', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);

      expect(page().querySelector('.conflict')).toBeNull();
    });

    it('says a repository with nothing open and nothing recent is empty, not blank', async () => {
      withRepositories();
      await open();
      await answer([]);

      expect(page().textContent).toContain('Nothing is open on this repository');
      expect(page().textContent).toContain('nothing has been released recently');
    });

    it('offers a way back when the read fails', async () => {
      withRepositories();
      await open();
      http.expectOne(LIST).flush({ message: 'no' }, { status: 503, statusText: 'Unavailable' });
      await settle();
      harness.fixture.detectChanges();

      expect(page().textContent).toContain('Could not load the release requests');
      await press('Retry');
      http.expectOne(LIST).flush({ requests: [] });
      await settle();
    });
  });

  describe('withdrawing', () => {
    it('asks in the button, and sends nothing until the second press', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);

      await press('Withdraw');
      http.expectNone(() => true);
      // The reason input appears with the question, not before it.
      expect(page().querySelector('input.reason')).not.toBeNull();

      buttonNamed('Confirm withdraw?').click();
      const withdrawal = http.expectOne(`${LIST}/r1/withdraw`);
      expect(withdrawal.request.method).toBe('POST');
      withdrawal.flush({
        request: request({ state: 'WITHDRAWN', detail: 'Withdrawn by an operator' }),
      });
      await settle();
      harness.fixture.detectChanges();

      expect(page().textContent).toContain('withdrawn');
    });

    it('sends the typed reason, and an empty body when nothing was typed', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);

      await press('Withdraw');
      const input = page().querySelector<HTMLInputElement>('input.reason');
      input!.value = 'Superseded by a newer branch';
      input!.dispatchEvent(new Event('input'));
      harness.fixture.detectChanges();

      buttonNamed('Confirm withdraw?').click();
      const withdrawal = http.expectOne(`${LIST}/r1/withdraw`);
      expect(withdrawal.request.body).toEqual({ reason: 'Superseded by a newer branch' });
      withdrawal.flush({ request: request({ state: 'WITHDRAWN' }) });
      await settle();
    });

    /**
     * The answer carries the whole request, so putting it in place is the read the page does not
     * have to make — and the list does not jump under a reader for a change they made themselves.
     */
    it('replaces the row from the answer rather than reading the list again', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);

      await press('Withdraw');
      buttonNamed('Confirm withdraw?').click();
      http.expectOne(`${LIST}/r1/withdraw`).flush({ request: request({ state: 'WITHDRAWN' }) });
      await settle();
      harness.fixture.detectChanges();

      http.expectNone(() => true);
      // Nothing is moving any more, so the timer is disarmed by the same answer.
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 2);
      http.expectNone(() => true);
    });

    it('does not offer the button on a request the service would refuse', async () => {
      withRepositories();
      await open();
      await answer([
        request({ id: 'a', state: 'RELEASED', version: '2026.901.1' }),
        request({ id: 'b', state: 'WITHDRAWN' }),
      ]);

      expect(
        [...page().querySelectorAll('button')].map((b) => b.textContent?.trim()),
      ).not.toContain('Withdraw');
    });

    it('shows the refusal when the list has gone stale under the reader', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'PENDING' })]);

      await press('Withdraw');
      buttonNamed('Confirm withdraw?').click();
      http
        .expectOne(`${LIST}/r1/withdraw`)
        .flush(
          { message: 'Release request r1 is already RELEASED' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();
      harness.fixture.detectChanges();

      expect(page().textContent).toContain('Could not withdraw this request');
      expect(page().textContent).toContain('already RELEASED');
    });
  });

  describe('the three answers before there is a list', () => {
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

    it('is not an address outside the known categories', async () => {
      withRepositories();
      await open('/qits/epics/planning/release-requests');

      expect(page().textContent).toContain('No such page here');
      http.expectNone(() => true);
    });
  });
});
