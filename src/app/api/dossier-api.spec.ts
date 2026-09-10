import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DossierApi, type DossierPageDto } from './dossier-api';

const page = (over: Partial<DossierPageDto> = {}): DossierPageDto => ({
  id: 'p1',
  epicId: 'e1',
  slug: 'the-claim-loop',
  title: 'The claim loop',
  position: 0,
  body: '# The claim loop',
  version: 0,
  createdAt: '2026-09-10T09:00:00Z',
  updatedAt: '2026-09-10T09:00:00Z',
  ...over,
});

/**
 * The dossier's transport, and the one shape that is easy to throw away.
 *
 * **A 409 is an answer here, not an error.** Nobody accepts a write on this route, so a refused one
 * comes back carrying the page as it now stands — and a client that let it throw would leave the
 * panel holding the person's text and nothing to compare it against.
 */
describe('DossierApi', () => {
  const URL = '/projects/api/epics/e1/dossier';

  let api: DossierApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(DossierApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the pages with their bodies — one read paints the tab', async () => {
    const answer = api.list('e1');
    const request = http.expectOne(URL);
    request.flush({ pages: [page()] });

    expect(request.request.method).toBe('GET');
    expect((await answer)[0].body).toBe('# The claim loop');
  });

  it('answers an empty list for an epic with no dossier', async () => {
    const answer = api.list('e1');
    http.expectOne(URL).flush({ pages: [] });

    expect(await answer).toEqual([]);
  });

  it('sends the version with every write', async () => {
    const answer = api.write('e1', 'p1', { body: 'rewritten', version: 3 });
    const request = http.expectOne(`${URL}/p1`);
    request.flush(page({ body: 'rewritten', version: 4 }));

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ body: 'rewritten', version: 3 });
    expect((await answer) as DossierPageDto).toMatchObject({ version: 4 });
  });

  it('answers a refused write with the current page rather than throwing it away', async () => {
    const answer = api.write('e1', 'p1', { body: 'mine', version: 0 });
    http
      .expectOne(`${URL}/p1`)
      .flush(
        { message: 'written since you read it', current: page({ body: 'theirs', version: 1 }) },
        { status: 409, statusText: 'Conflict' },
      );

    expect(await answer).toEqual({ conflict: true, current: page({ body: 'theirs', version: 1 }) });
  });

  it('lets every other failure through', async () => {
    const answer = api.write('e1', 'p1', { body: 'mine', version: 0 });
    http.expectOne(`${URL}/p1`).flush({}, { status: 500, statusText: 'Server Error' });

    await expect(answer).rejects.toBeDefined();
  });

  it('moves and removes a page by id', async () => {
    const moved = api.move('e1', 'p1', 2);
    const move = http.expectOne(`${URL}/p1/move`);
    move.flush(page({ position: 2 }));
    expect(move.request.body).toEqual({ position: 2 });
    expect((await moved).position).toBe(2);

    const removed = api.remove('e1', 'p1');
    const remove = http.expectOne(`${URL}/p1`);
    remove.flush(null, { status: 204, statusText: 'No Content' });
    expect(remove.request.method).toBe('DELETE');
    await removed;
  });

  it('inlines a figure and answers the exact markdown line', async () => {
    const answer = api.inlineFigure('e1', 'a1', 'DESIGN');
    const request = http.expectOne('/projects/api/epics/e1/dossier-assets');
    request.flush({
      id: 'a1',
      kind: 'DESIGN',
      label: 'Checkout',
      url: '/epics/e1/dossier-assets/a1/content',
      markdown: '![Checkout](/epics/e1/dossier-assets/a1/content)',
    });

    expect(request.request.body).toEqual({ sourceId: 'a1', kind: 'DESIGN' });
    expect((await answer).markdown).toBe('![Checkout](/epics/e1/dossier-assets/a1/content)');
  });
});
