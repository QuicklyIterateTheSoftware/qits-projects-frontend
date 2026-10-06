import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  DossierApi,
  STORED_DOSSIER_ASSET,
  dossierAssetContentUrl,
  epicDossier,
  ticketDossier,
  type DossierPageDto,
} from './dossier-api';

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
  const URL = '/projects/api/work/qits-1/dossier';
  const TICKET_URL = '/projects/api/work/qits-2/dossier';
  const epic = epicDossier('e1', 'qits-1');
  const ticket = ticketDossier('t1', 'qits-2');

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
    const answer = api.list(epic);
    const request = http.expectOne(URL);
    request.flush({ pages: [page()] });

    expect(request.request.method).toBe('GET');
    expect((await answer)[0].body).toBe('# The claim loop');
  });

  it('answers an empty list for an epic with no dossier', async () => {
    const answer = api.list(epic);
    http.expectOne(URL).flush({ pages: [] });

    expect(await answer).toEqual([]);
  });

  it('sends the version with every write', async () => {
    const answer = api.write(epic, page(), { body: 'rewritten', version: 3 });
    const request = http.expectOne(`${URL}/the-claim-loop`);
    request.flush(page({ body: 'rewritten', version: 4 }));

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ body: 'rewritten', version: 3 });
    expect((await answer) as DossierPageDto).toMatchObject({ version: 4 });
  });

  it('answers a refused write with the current page rather than throwing it away', async () => {
    const answer = api.write(epic, page(), { body: 'mine', version: 0 });
    http
      .expectOne(`${URL}/the-claim-loop`)
      .flush(
        { message: 'written since you read it', current: page({ body: 'theirs', version: 1 }) },
        { status: 409, statusText: 'Conflict' },
      );

    expect(await answer).toEqual({
      conflict: true,
      current: page({ body: 'theirs', version: 1 }),
      message: 'written since you read it',
    });
  });

  it('lets every other failure through', async () => {
    const answer = api.write(epic, page(), { body: 'mine', version: 0 });
    http.expectOne(`${URL}/the-claim-loop`).flush({}, { status: 500, statusText: 'Server Error' });

    await expect(answer).rejects.toBeDefined();
  });

  it('moves and removes a page by its slug', async () => {
    const moved = api.move(epic, page(), 2);
    const move = http.expectOne(`${URL}/the-claim-loop/move`);
    move.flush(page({ position: 2 }));
    expect(move.request.body).toEqual({ position: 2 });
    expect((await moved).position).toBe(2);

    const removed = api.remove(epic, page());
    const remove = http.expectOne(`${URL}/the-claim-loop`);
    remove.flush(null, { status: 204, statusText: 'No Content' });
    expect(remove.request.method).toBe('DELETE');
    await removed;
  });

  it("reads a ticket's dossier from under the ticket", async () => {
    const answer = api.list(ticket);
    const request = http.expectOne(TICKET_URL);
    request.flush({ pages: [page({ epicId: null, ticketId: 't1' })] });

    expect(request.request.method).toBe('GET');
    expect((await answer)[0].ticketId).toBe('t1');
  });

  /** `/work` addresses either owner's page by its slug; handing the row itself keeps that here. */
  it("addresses a ticket's page by its slug, and still sends the version", async () => {
    const answer = api.write(ticket, page(), { body: 'rewritten', version: 3 });
    const request = http.expectOne(`${TICKET_URL}/the-claim-loop`);
    request.flush(page({ epicId: null, ticketId: 't1', body: 'rewritten', version: 4 }));

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ body: 'rewritten', version: 3 });
    expect((await answer) as DossierPageDto).toMatchObject({ version: 4 });
  });

  it("answers a ticket's refused write with the current page, exactly as the epic's does", async () => {
    const answer = api.write(ticket, page(), { body: 'mine', version: 0 });
    http
      .expectOne(`${TICKET_URL}/the-claim-loop`)
      .flush(
        { message: 'written since you read it', current: page({ body: 'theirs', version: 1 }) },
        { status: 409, statusText: 'Conflict' },
      );

    expect(await answer).toEqual({
      conflict: true,
      current: page({ body: 'theirs', version: 1 }),
      message: 'written since you read it',
    });
  });

  it("moves and removes a ticket's page by slug too", async () => {
    const moved = api.move(ticket, page(), 2);
    const move = http.expectOne(`${TICKET_URL}/the-claim-loop/move`);
    move.flush(page({ position: 2 }));
    expect(move.request.body).toEqual({ position: 2 });
    expect((await moved).position).toBe(2);

    const removed = api.remove(ticket, page());
    const remove = http.expectOne(`${TICKET_URL}/the-claim-loop`);
    remove.flush(null, { status: 204, statusText: 'No Content' });
    expect(remove.request.method).toBe('DELETE');
    await removed;
  });

  it('inlines a figure and answers the exact markdown line', async () => {
    const answer = api.inlineFigure('qits-1', 'a1', 'DESIGN');
    const request = http.expectOne('/projects/api/work/qits-1/dossier-assets');
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

  it('addresses an owner with no qualified id by its id', () => {
    const answer = api.list(epicDossier('e1'));
    http.expectOne('/projects/api/work/e1/dossier').flush({ pages: [] });
    return answer;
  });

  it('resolves a stored figure URL to the work content route', () => {
    expect(dossierAssetContentUrl('e1', 'a1')).toBe(
      '/projects/api/work/e1/dossier-assets/a1/content',
    );
    expect(STORED_DOSSIER_ASSET.exec('/epics/e1/dossier-assets/a1/content')?.slice(1)).toEqual([
      'e1',
      'a1',
    ]);
  });
});
