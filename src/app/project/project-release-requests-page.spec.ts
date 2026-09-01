import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsRepositoryList,
  type QitsNavigation,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { ReleaseRequestDto } from '../api/dto';
import { RELEASE_REQUESTS_POLL_MS } from './release-requests-model';

const PROJECTS = '/projects/api/projects';
const LIST = `${PROJECTS}/p1/release-requests`;

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
    repoName: 'qits-ci-service',
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
 * The whole project's open release requests.
 *
 * <p>What is worth pinning here is what makes this page different from the repository's, not the
 * markup they share. **The scope**: one read, keyed on the project id the address does not carry —
 * so nothing is asked for until the shared project list has resolved the slug. **The filter**: the
 * read names no state, because the route's own default is the open ones and open is the entire
 * point; asking for `state=all` here would turn a worklist into a history. **The naming**: every row
 * says which repository it belongs to, and links there only when the chrome can spell the address.
 * **The withdraw**: it is addressed by the row's own `repoId`, which is why a project-wide list can
 * offer the verb at all.
 */
describe('ProjectReleaseRequestsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  beforeEach(() => {
    // Only the two the page uses. Faking the whole clock stalls `fixture.whenStable()`, which
    // schedules its own work — the same narrowing the repository page's spec makes.
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
        provideQitsNavigationTree(PLATFORM),
        ...(providers as never[]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  /**
   * Open the page and answer the shared project list, which is what turns the address's slug into
   * the id the API is keyed by. Nothing this page reads can be asked for before that answer.
   */
  async function open(url = '/qits/release-requests'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    http.expectOne(PROJECTS).flush({
      entries: [
        { project: { id: 'p1', slug: 'qits', name: 'QITS', description: null, dns: null } },
      ],
    });
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

  describe('the request budget', () => {
    /**
     * Two reads to open, and the first is the chrome's project list — which resolves the address
     * and which every page here already pays for. The page's own read is exactly one, and it is a
     * listing: never the project's component listing, which refreshes the wrapper's git mirror.
     */
    it('costs one read of its own, and it is the project release-request listing', async () => {
      configure();
      await open();

      const asked = http.match(() => true);
      expect(asked.map((entry) => entry.request.urlWithParams)).toEqual([LIST]);
      asked[0].flush({ requests: [] });
      await settle();
      http.expectNone(() => true);
    });

    /**
     * The whole design of the route: no `state` means the open ones. A project with a year of
     * releases behind it must not answer "is anything waiting" with a year of history.
     */
    it('names no state, so the service answers the open requests', async () => {
      configure();
      await open();

      const asked = http.expectOne(LIST);
      expect(asked.request.params.keys()).toEqual([]);
      asked.flush({ requests: [] });
      await settle();
    });

    it('asks for nothing at all until the address has resolved to a project', async () => {
      configure();
      harness = await RouterTestingHarness.create('/qits/release-requests');
      await settle();

      // The project list is in flight; the page has no id, so it has asked for nothing.
      expect(http.match(() => true).map((entry) => entry.request.url)).toEqual([PROJECTS]);
    });

    it('arms no timer when nothing on screen can move by itself', async () => {
      configure();
      await open();
      // REJECTED is open on the service (a push revives it) and settled on screen: it changes on a
      // person's action elsewhere, never on the passage of time, so watching it would be a poll
      // waiting for something no clock causes.
      await answer([request({ state: 'REJECTED', detail: 'A gating build went red' })]);

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).not.toContain('Watching for changes');
    });

    it('reads again while something is still moving, and stops when it lands', async () => {
      configure();
      await open();
      await answer([request({ state: 'PENDING' })]);
      expect(page().textContent).toContain('Watching for changes');

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS);
      // It released, so it is no longer open and the service stops answering with it at all.
      await answer([]);

      await vi.advanceTimersByTimeAsync(RELEASE_REQUESTS_POLL_MS * 3);
      http.expectNone(() => true);
      expect(page().textContent).toContain('Nothing is waiting to be released');
    });
  });

  describe('what a row says', () => {
    it('aggregates the repositories, naming each row with the one it belongs to', async () => {
      configure();
      await open();
      await answer([
        request({ id: 'a', repoId: 'repo-ci', repoName: 'qits-ci-service', summary: 'CI fix' }),
        request({ id: 'b', repoId: 'repo-db', repoName: 'qits-db-core', summary: 'DB fix' }),
      ]);

      const text = page().textContent ?? '';
      expect(text).toContain('qits-ci-service');
      expect(text).toContain('qits-db-core');
      expect(text).toContain('CI fix');
      expect(text).toContain('DB fix');
    });

    /**
     * The link needs the middle segment of `/<project>/<group>/<repository>`, which only the
     * chrome's repository list knows — so it is offered where that list holds the row and not
     * otherwise. A link to nowhere would be worse than a name.
     */
    it('links a row to its repository when the chrome can spell the address', async () => {
      configure(
        provideQitsRepositoryList([
          { id: 'repo-ci', name: 'qits-ci-service', component: 'qits-ci', category: 'services' },
        ]),
      );
      await open();
      await answer([request({ repoId: 'repo-ci', repoName: 'qits-ci-service' })]);

      const link = page().querySelector<HTMLAnchorElement>('a.repo');
      expect(link?.getAttribute('href')).toBe('/qits/qits-ci/qits-ci-service/release-requests');
    });

    it('draws the name without a link for a repository the chrome does not hold', async () => {
      configure(provideQitsRepositoryList([]));
      await open();
      await answer([request({ repoId: 'repo-gone', repoName: 'qits-retired' })]);

      expect(page().querySelector('a.repo')).toBeNull();
      expect(page().textContent).toContain('qits-retired');
    });

    it('falls back to the id for a repository the service could not name', async () => {
      configure(provideQitsRepositoryList([]));
      await open();
      await answer([request({ repoId: 'repo-nameless', repoName: null })]);

      expect(page().textContent).toContain('repo-nameless');
    });

    it('draws the state, the branch, the short sha, who asked and why', async () => {
      configure();
      await open();
      await answer([
        request({
          state: 'FAILED',
          retryable: true,
          requester: 'dyn-workspace-601',
          detail: 'The door could not be reached',
        }),
      ]);

      const text = page().textContent ?? '';
      expect(text).toContain('failed');
      expect(text).toContain('adhoc-changes');
      expect(text).toContain('20c377e');
      expect(text).not.toContain('20c377ee71fabe');
      expect(text).toContain('dyn-workspace-601');
      expect(text).toContain('The door could not be reached');
    });

    it('says a project with nothing outstanding is empty, rather than drawing nothing', async () => {
      configure();
      await open();
      await answer([]);

      expect(page().textContent).toContain('Nothing is waiting to be released');
    });

    it('offers a way back when the read fails', async () => {
      configure();
      await open();
      http.expectOne(LIST).flush({ message: 'no' }, { status: 503, statusText: 'Unavailable' });
      await settle();
      harness.fixture.detectChanges();

      expect(page().textContent).toContain('Could not load the release requests');
      buttonNamed('Retry').click();
      await settle();
      http.expectOne(LIST).flush({ requests: [] });
      await settle();
    });
  });

  describe('withdrawing', () => {
    /**
     * Addressed by the row's own repoId — the whole reason a project-wide list can offer a verb
     * that is defined on a repository's collection.
     */
    it('asks in the button, then sends to the repository the row names', async () => {
      configure();
      await open();
      await answer([request({ repoId: 'repo-db', state: 'PENDING' })]);

      buttonNamed('Withdraw').click();
      await settle();
      harness.fixture.detectChanges();
      http.expectNone(() => true);

      buttonNamed('Confirm withdraw?').click();
      const withdrawal = http.expectOne(
        '/projects/api/repositories/repo-db/release-requests/r1/withdraw',
      );
      expect(withdrawal.request.method).toBe('POST');
      withdrawal.flush({ request: request({ repoId: 'repo-db', state: 'WITHDRAWN' }) });
      await settle();
      harness.fixture.detectChanges();

      // The answered row is put in place rather than re-read; the next read is what drops it.
      expect(page().textContent).toContain('withdrawn');
      http.expectNone(() => true);
    });

    it('does not offer the button on a request the service would refuse', async () => {
      configure();
      await open();
      await answer([request({ id: 'a', state: 'WITHDRAWN' })]);

      expect(
        [...page().querySelectorAll('button')].map((b) => b.textContent?.trim()),
      ).not.toContain('Withdraw');
    });

    it('shows the refusal when the list has gone stale under the reader', async () => {
      configure();
      await open();
      await answer([request({ state: 'PENDING' })]);

      buttonNamed('Withdraw').click();
      await settle();
      harness.fixture.detectChanges();
      buttonNamed('Confirm withdraw?').click();
      http
        .expectOne('/projects/api/repositories/repo-ci/release-requests/r1/withdraw')
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
});
