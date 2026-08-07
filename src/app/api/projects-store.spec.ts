import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectsStore } from './projects-store';

/**
 * The single flight, asserted where it actually matters: two callers in the same tick.
 *
 * That is not a hypothetical — the sub-navigation and the landing page are both built during the
 * first render, and without this store the load would cost two identical requests whose answers
 * could disagree.
 */
describe('ProjectsStore', () => {
  let store: ProjectsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ProjectsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function flush(names: readonly string[]): void {
    http.expectOne('/projects/api/projects').flush({
      entries: names.map((name) => ({
        project: { id: name, name, slug: name, description: null, dns: null },
      })),
    });
  }

  it('reads once for two callers and hands both the same list', async () => {
    const first = store.projects();
    const second = store.projects();
    flush(['qits']);

    await expect(first).resolves.toMatchObject([{ id: 'qits' }]);
    expect(await second).toBe(await first);
  });

  it('serves later callers from the cache without asking again', async () => {
    const first = store.projects();
    flush(['qits']);
    await first;

    await expect(store.projects()).resolves.toMatchObject([{ id: 'qits' }]);
    http.verify();
  });

  /** A cached rejection would make every retry the same failure for the life of the page. */
  it('drops a failed read so the next caller really retries', async () => {
    const first = store.projects();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await expect(first).rejects.toBeTruthy();

    const second = store.projects();
    flush(['qits']);
    await expect(second).resolves.toMatchObject([{ id: 'qits' }]);
  });

  it('reads again after it is told to forget', async () => {
    const first = store.projects();
    flush(['qits']);
    await first;

    store.forget();
    const second = store.projects();
    flush(['qits', 'website']);
    await expect(second).resolves.toHaveLength(2);
  });
});
