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
  type QitsRepository,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { ReleaseRequestDto } from '../api/dto';

/** The repository id carries a space, so the round trip through the URL is under test too. */
const AT = '/qits/release-requests/by-release/repo%20ci/2026.905.91746';

/** What the API is asked, with the id encoded again on the way out. */
const LIST = '/projects/api/repositories/repo%20ci/release-requests';

/** The address the redirect lands on — and the read that page makes, which proves it works. */
const LANDED = '/qits/qits-ci/qits-ci-service/release-requests/r7';
const DETAIL = '/projects/api/repositories/repo%20ci/release-requests/r7';

const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {},
  applications: {},
};

/** The chrome's row is where the middle segment comes from: the component, not the archetype. */
const PLACED: QitsRepository = {
  id: 'repo ci',
  name: 'qits-ci-service',
  component: 'qits-ci',
  category: 'services',
};

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r7',
    repoId: 'repo ci',
    repoName: 'qits-ci-service',
    backingBranch: 'release/r7',
    sources: [{ kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false }],
    mergedSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'RELEASED',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: null,
    version: '2026.905.91746',
    releasedSha: '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
    mergedToMainAt: null,
    retryable: false,
    createdAt: '2026-09-05T09:17:46.000Z',
    updatedAt: '2026-09-05T09:17:46.000Z',
    ...overrides,
  };
}

/**
 * The address a link from a RELEASE lands on, and the two answers it has.
 *
 * A hit **replaces** the URL rather than pushing one, so pressing back returns to whatever linked
 * here instead of to this page — which would resolve again and bounce the reader straight forward.
 * What it replaces it with is the canonical five-segment address, spelled through the chrome: the
 * repository's NAME and its component, because that is the address every page below `:project`
 * resolves a repository from.
 *
 * A miss is a sentence and not a 404: a release older than the release-request flow has no request
 * to show, which is an ordinary answer and not a broken link.
 *
 * The state is filtered HERE. The repository route answers the open requests plus the last ten
 * released, so a row carrying the version but not RELEASED — a withdrawn ask, a failed one — is in
 * the answer and is not what a by-release link means.
 */
describe('ReleaseRequestByReleaseResolver', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  function configure(...providers: unknown[]): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsScope('repository'),
        provideQitsNavigationTree(PLATFORM),
        provideQitsProjectList([{ id: 'p1', slug: 'qits', name: 'QITS' }]),
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

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create(AT);
    await settle();
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('redirects to the request itself, replacing the address it arrived at', async () => {
    configure(provideQitsRepositoryList([PLACED]));
    await open();

    http.expectOne(LIST).flush({ requests: [request()] });
    await settle();

    expect(TestBed.inject(Router).url).toBe(LANDED);
    // The detail page is now loading, keyed by the row id — this spec is about the hop, not about
    // what it lands on, but the read proves the five segments resolve to a working page.
    http.expectOne(DETAIL);
  });

  /**
   * The window the route answers holds more than the one row, and the version alone does not pick
   * it out: a withdrawn ask for the same version is in that answer, and so is every other release.
   */
  it('takes the newest RELEASED row carrying the version, and skips the rest', async () => {
    configure(provideQitsRepositoryList([PLACED]));
    await open();

    http.expectOne(LIST).flush({
      requests: [
        request({ id: 'r9', state: 'WITHDRAWN' }),
        request({ id: 'r8', state: 'RELEASED', version: '2026.905.90241' }),
        request(),
        request({ id: 'r6', state: 'RELEASED' }),
      ],
    });
    await settle();

    expect(TestBed.inject(Router).url).toBe(LANDED);
  });

  /**
   * The middle segment is the chrome's, and a repository the platform has not placed in a component
   * still gets an address: the group is decoration there, and every page below it resolves the
   * repository by name.
   */
  it('falls back to the archetype group for a repository with no component', async () => {
    configure(
      provideQitsRepositoryList([{ id: 'repo ci', name: 'qits-ci-service', category: 'services' }]),
    );
    await open();

    http.expectOne(LIST).flush({ requests: [request()] });
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/services/qits-ci-service/release-requests/r7');
  });

  /**
   * The project repository is the one the five-segment form cannot spell — it is in no component and
   * in no archetype category — so a release of the project's own estate goes to the project-scoped
   * address instead of to `/qits/services/qits-qits/…`, which would say the wrapper is a service.
   * The chrome names it beside the repositories and it is deliberately not among them: a wrapper is
   * not its own submodule.
   */
  it('sends a release of the project repository to the project-scoped address', async () => {
    configure(provideQitsRepositoryList([], 'repo ci'));
    await open();

    http.expectOne(LIST).flush({ requests: [request({ repoName: 'qits-qits' })] });
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/release-requests/r7');
    // The same page, reached by its other door, and reading by the same row id.
    http.expectOne(DETAIL);
  });

  it('says so when no released request matches, and offers to look again', async () => {
    configure(provideQitsRepositoryList([PLACED]));
    await open();

    http.expectOne(LIST).flush({ requests: [request({ state: 'PENDING', version: null })] });
    await settle();
    harness.fixture.detectChanges();

    const text = page().textContent ?? '';
    expect(text).toContain('No released request matches qits-ci-service@2026.905.91746 here');
    expect(text).toContain('it may predate');
    expect(text).toContain('Look again');
    // Nowhere to go: the address the reader arrived at is still the address.
    expect(TestBed.inject(Router).url).toBe(AT);
    http.expectNone(DETAIL);
  });

  /** Nothing at all is the same answer, and the sentence names the id the address carried. */
  it('names the repository by the id in the address when the chrome does not hold it', async () => {
    configure(provideQitsRepositoryList([]));
    await open();

    http.expectOne(LIST).flush({ requests: [] });
    await settle();
    harness.fixture.detectChanges();

    expect(page().textContent).toContain('No released request matches repo ci@2026.905.91746 here');
    expect(TestBed.inject(Router).url).toBe(AT);
  });

  /** A read that failed is an error with a way back, never the calm sentence a miss gets. */
  it('draws the failure rather than a miss when the lookup could not be made', async () => {
    configure(provideQitsRepositoryList([PLACED]));
    await open();

    http.expectOne(LIST).flush({ message: 'no such repository' }, { status: 404, statusText: '' });
    await settle();
    harness.fixture.detectChanges();

    expect(page().textContent).toContain('Could not look up the release request');
    expect(page().textContent).not.toContain('No released request matches');
  });
});
