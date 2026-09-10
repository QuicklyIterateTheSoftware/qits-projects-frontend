import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DesignsApi, type DesignDto } from './designs-api';

const row = (over: Partial<DesignDto> = {}): DesignDto => ({
  id: 'd1',
  title: 'Projects overview',
  sourceRoute: '/projects/',
  htmlBytes: 4096,
  truncated: false,
  version: 0,
  createdBy: 'kim',
  createdAt: '2026-08-23T09:00:00Z',
  updatedAt: '2026-08-23T09:00:00Z',
  ...over,
});

/**
 * The designs' transport, and the two shapes that are easy to get backwards.
 *
 * **The markup rides only on the single read.** A client that expected the listing to carry it would
 * draw an empty frame until something re-read the row, and would pull every stored page to draw a
 * strip of tiles.
 *
 * **A write carries the version it was composed against.** Nobody accepts these writes, so the
 * version is the whole of what keeps a person's edit and an agent's from overwriting each other;
 * a client that dropped it would send a write the service cannot refuse.
 */
describe('DesignsApi', () => {
  const URL = '/projects/api/refinements/7/designs';

  let api: DesignsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(DesignsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the designs on a refinement, without their markup', async () => {
    const answer = api.list(7);
    const request = http.expectOne(URL);
    request.flush({ designs: [row()] });

    expect(request.request.method).toBe('GET');
    expect(await answer).toEqual([row()]);
  });

  it('answers an empty list for a refinement with no designs', async () => {
    const answer = api.list(7);
    http.expectOne(URL).flush({ designs: [] });

    expect(await answer).toEqual([]);
  });

  it('reads one design with its markup', async () => {
    const answer = api.get(7, 'd1');
    const request = http.expectOne(`${URL}/d1`);
    request.flush(row({ html: '<html></html>' }));

    expect(request.request.method).toBe('GET');
    expect((await answer).html).toBe('<html></html>');
  });

  it('posts the frozen page with the route it came from', async () => {
    const answer = api.create(7, {
      title: 'Projects overview',
      html: '<html></html>',
      sourceRoute: '/projects/',
      truncated: false,
    });
    const request = http.expectOne(URL);
    request.flush(row(), { status: 201, statusText: 'Created' });

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      title: 'Projects overview',
      html: '<html></html>',
      sourceRoute: '/projects/',
      truncated: false,
    });
    expect((await answer).id).toBe('d1');
  });

  it('lets the over-the-cap 413 through, because it is the one failure worth naming', async () => {
    const answer = api.create(7, { title: 'Big', html: '<html></html>', truncated: true });
    http
      .expectOne(URL)
      .flush({ message: 'too large' }, { status: 413, statusText: 'Content Too Large' });

    await expect(answer).rejects.toBeDefined();
  });

  it('renames a design by sending its title and the version it was read at', async () => {
    const answer = api.rename(7, 'd1', 'Overview, tidied', 3);
    const request = http.expectOne(`${URL}/d1`);
    request.flush(row({ title: 'Overview, tidied', version: 4 }));

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ title: 'Overview, tidied', version: 3 });
    expect((await answer).title).toBe('Overview, tidied');
  });

  it('rewrites the markup in place, carrying the version', async () => {
    const answer = api.write(7, 'd1', { title: 'Overview', html: '<html>2</html>', version: 1 });
    const request = http.expectOne(`${URL}/d1`);
    request.flush(row({ version: 2 }));

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      title: 'Overview',
      html: '<html>2</html>',
      version: 1,
    });
    expect((await answer).version).toBe(2);
  });

  it('lets the stale-write 409 through with the current row on it', async () => {
    const answer = api.write(7, 'd1', { title: 'Overview', html: '<html>2</html>', version: 1 });
    http
      .expectOne(`${URL}/d1`)
      .flush(
        { message: 'written since you read it', current: row({ version: 5 }) },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(answer).rejects.toBeDefined();
  });

  it('removes one design by id, scoped to its refinement', async () => {
    const answer = api.remove(7, 'd1');
    const request = http.expectOne(`${URL}/d1`);
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(request.request.method).toBe('DELETE');
    await answer;
  });
});
