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
import { RELEASE_REQUESTS_POLL_MS } from './repository-release-requests-page';

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
    branch: 'adhoc-changes',
    commitSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    version: null,
    retryable: false,
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
    ...overrides,
  };
}

/**
 * One repository's release requests.
 *
 * <p>Three things here are worth pinning and none of them is the markup. **The request budget**:
 * the address names a repository by name and the API is keyed by its row id, and the whole point of
 * resolving that through the chrome's list is that the page costs exactly one read. **The timer**:
 * this is the only page in this application that polls, and what makes that acceptable is that it
 * stops — a repository whose requests have all concluded must arm nothing. **The withdraw**: it is
 * destructive, so it asks in the button, and the answer replaces the row rather than costing a
 * re-read.
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
    it('draws the state, the branch, the short sha, who asked and when', async () => {
      withRepositories();
      await open();
      await answer([
        request({
          state: 'REJECTED',
          branch: 'adhoc-changes',
          requester: 'dyn-workspace-601',
          detail: 'A gating build went red',
        }),
      ]);

      const text = page().textContent ?? '';
      expect(text).toContain('rejected');
      expect(text).toContain('adhoc-changes');
      expect(text).toContain('20c377e');
      expect(text).not.toContain('20c377ee71fabe');
      expect(text).toContain('dyn-workspace-601');
      expect(text).toContain('A gating build went red');
    });

    it('names the version a released request landed as', async () => {
      withRepositories();
      await open();
      await answer([request({ state: 'RELEASED', version: '2026.901.134748' })]);

      expect(page().textContent).toContain('2026.901.134748');
    });

    it('says a repository nobody has released anything on is empty, rather than drawing nothing', async () => {
      withRepositories();
      await open();
      await answer([]);

      expect(page().textContent).toContain('Nothing has been asked for');
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
