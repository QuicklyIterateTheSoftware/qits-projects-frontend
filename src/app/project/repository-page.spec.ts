import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsScope,
  type QitsNavigation,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { RepositoryDto } from '../api/dto';

function repository(over: Partial<RepositoryDto> = {}): RepositoryDto {
  return {
    id: 'r1',
    name: 'qits-ci',
    backupUrl: 'https://github.com/QuicklyIterate/qits-ci.git',
    mainBranch: 'main',
    archetype: 'SERVICE',
    projectId: 'p1',
    lastBackup: null,
    ...over,
  };
}

/** The platform as the edge states it — with a git host of its own, or naming none at all. */
function navigation(githost: boolean): QitsNavigation {
  return {
    environment: 'dev',
    origin: 'https://dev.example.test',
    slots: {
      'services.details': [
        {
          app: 'qits-ci',
          label: 'CI',
          host: 'ci',
          origin: 'https://ci.dev.example.test',
          path: '/ci',
          position: 2,
        },
        {
          app: 'qits-docs',
          label: 'Docs',
          host: 'docs',
          origin: 'https://docs.dev.example.test',
          path: '/docs',
          position: 1,
        },
      ],
      'libs.details': [
        {
          app: 'qits-docs',
          label: 'Docs',
          host: 'docs',
          origin: 'https://docs.dev.example.test',
          path: '/docs',
          position: 1,
        },
      ],
      system: githost
        ? [
            {
              app: 'qits-githost',
              label: 'Githost',
              host: 'githost',
              origin: 'https://githost.dev.example.test',
              path: '/githost',
              position: 5,
            },
          ]
        : [],
    },
  };
}

/**
 * One repository, at the address the whole platform shares.
 *
 * <p>The three things worth pinning are the three that are composed rather than read. The **clone
 * url** is spelled with the GIT HOST's own origin and the project's slug, never with this host or
 * with the project id. The **cards** are the `<category>.details` slot of the navigation the edge
 * serves, with this page's own scope path appended — so they are the same address on another host,
 * which is the whole contract. And a repository the project does not hold is the ordinary 404, not
 * an empty page pretending the read is still coming.
 */
describe('RepositoryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  function configure(tree: QitsNavigation): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The page reads the scope, never the route parameters — the platform's rule for every SPA.
        provideQitsScope('repository'),
        provideQitsNavigationTree(tree),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => configure(navigation(true)));

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  /** Open a repository address, resolve its project, and answer the one components read. */
  async function open(
    url = '/qits/services/qits-ci',
    repositories: readonly RepositoryDto[] = [repository()],
  ): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    http.expectOne('/projects/api/projects').flush({
      entries: [
        { project: { id: 'p1', name: 'Qits', slug: 'qits', description: null, dns: null } },
      ],
    });
    await settle();
    http
      .expectOne('/projects/api/projects/p1/repositories')
      .flush({ entries: repositories.map((entry) => ({ repository: entry })), wrapper: null });
    await settle();
  }

  it('names the repository, its category and its main branch', async () => {
    await open();

    expect(page().querySelector('h1')?.textContent).toContain('qits-ci');
    // The group heading, not the wire's `SERVICE` — the same word the setup page draws.
    expect(text()).toContain('Services');
    expect(text()).toContain('main');
    http.verify();
  });

  /** The backup badge is the component card's, unchanged: the one actionable outcome says what to do. */
  it('badges the last backup with what the reader can do about it', async () => {
    await open('/qits/services/qits-ci', [
      repository({
        lastBackup: { outcome: 'AUTH_REQUIRED', at: '2026-08-24T10:00:00Z', detail: null },
      }),
    ]);

    expect(text()).toContain('sign-in needed');
  });

  /** A repository nobody asked to back up gets no badge: an invented problem is worse than silence. */
  it('says nothing at all about a repository with no backup remote', async () => {
    await open('/qits/services/qits-ci', [repository({ backupUrl: null })]);

    expect(text()).not.toContain('sign-in needed');
    expect(text()).not.toContain('never backed up');
  });

  /**
   * The clone url names the git host, spelled with the slug.
   *
   * Not this application's host, even though `/git` is path-routed there too: the address a person
   * is asked to paste should name the authority that serves it.
   */
  it('spells the clone url with the git host origin and the project slug', async () => {
    await open();

    expect(text()).toContain('https://githost.dev.example.test/git/qits/qits-ci.git');
    expect(text()).not.toContain('/git/p1/');
  });

  /** A platform naming no git host still gives an address that clones: `/git` answers on every host. */
  it('falls back to the environment origin when the platform names no git host', async () => {
    TestBed.resetTestingModule();
    configure(navigation(false));
    await open();

    expect(text()).toContain('https://dev.example.test/git/qits/qits-ci.git');
  });

  /**
   * One card per application filed under this repository's category, at this repository's own
   * scoped path on that application's host — the same URL with a different origin in front.
   */
  it('offers the category’s applications at this repository’s address on their own hosts', async () => {
    await open();

    const cards = Array.from(page().querySelectorAll<HTMLAnchorElement>('a.app'));
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      'https://docs.dev.example.test/qits/services/qits-ci/',
      'https://ci.dev.example.test/qits/services/qits-ci/',
    ]);
  });

  /** A different category draws that category's slot, and nothing from another one. */
  it('draws the slot of the category in the address', async () => {
    await open('/qits/libs/qits-db-core', [
      repository({ id: 'r2', name: 'qits-db-core', archetype: 'LIBRARY' }),
    ]);

    const cards = Array.from(page().querySelectorAll<HTMLAnchorElement>('a.app'));
    expect(cards.map((card) => card.textContent?.trim())).toHaveLength(1);
    expect(cards[0].getAttribute('href')).toBe(
      'https://docs.dev.example.test/qits/libs/qits-db-core/',
    );
  });

  /** A well-formed address naming a repository the project does not hold is an ordinary 404. */
  it('answers a repository this project does not hold with the not-found page', async () => {
    await open('/qits/services/nothing-here');

    expect(text()).toContain('No such page here');
    expect(page().querySelector('a.app')).toBeNull();
  });
});
