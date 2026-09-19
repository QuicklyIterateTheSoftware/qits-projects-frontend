import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ArchetypesApi, type ArchetypeRegistry } from './archetypes-api';

const REGISTRY: ArchetypeRegistry = {
  properties: ['TITLE', 'SLUG', 'STATUS'],
  serverOwned: ['SLUG'],
  archetypes: [
    {
      archetype: 'EPIC',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE', 'STATUS'],
      permitted: ['TITLE', 'SLUG', 'STATUS'],
      legalStatuses: ['REFINING'],
    },
  ],
};

describe('ArchetypesApi', () => {
  let api: ArchetypesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ArchetypesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the model from the entities endpoint and answers it whole', async () => {
    const answer = api.registry();
    http.expectOne('/projects/api/entities/archetypes').flush(REGISTRY);

    expect(await answer).toEqual(REGISTRY);
  });

  /**
   * The point of memoising the *promise* rather than the value: two panels opened in the same tick
   * must not race each other to the same read.
   */
  it('makes one request for callers that ask while the first is still in flight', async () => {
    const first = api.registry();
    const second = api.registry();
    http.expectOne('/projects/api/entities/archetypes').flush(REGISTRY);

    expect(await first).toBe(await second);
  });

  it('makes no second request once it has an answer', async () => {
    const first = api.registry();
    http.expectOne('/projects/api/entities/archetypes').flush(REGISTRY);
    await first;

    expect(await api.registry()).toEqual(REGISTRY);
    http.expectNone('/projects/api/entities/archetypes');
  });

  /**
   * A failure forgets, so pressing again tries again. Holding the rejected promise would hand every
   * future opening the same dead answer for the lifetime of the tab.
   */
  it('forgets a failure so the next caller retries', async () => {
    const first = api.registry();
    http
      .expectOne('/projects/api/entities/archetypes')
      .flush({ message: 'no' }, { status: 503, statusText: 'Unavailable' });
    await expect(first).rejects.toBeDefined();

    const second = api.registry();
    http.expectOne('/projects/api/entities/archetypes').flush(REGISTRY);

    expect(await second).toEqual(REGISTRY);
  });
});
