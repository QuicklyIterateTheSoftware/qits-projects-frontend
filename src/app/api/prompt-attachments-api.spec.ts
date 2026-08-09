import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PromptAttachmentsApi } from './prompt-attachments-api';

/**
 * The attachments' transport, and the two shapes that are easy to get backwards.
 *
 * **The list carries bytes and the POST answer does not.** A client that expected the upload's
 * answer to hold `dataBase64` would draw a broken thumbnail and only after a reload draw a working
 * one, which is exactly the kind of defect a manual walk misses.
 *
 * **No attachments is an empty list, not a 404.** So there is nothing to translate here, unlike the
 * draft — and asserting it is what stops someone adding a 404-to-empty rescue that would also
 * swallow "no such workspace".
 */
describe('PromptAttachmentsApi', () => {
  const URL = '/workspaces/api/workspaces/7/prompt-attachments';

  let api: PromptAttachmentsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PromptAttachmentsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the attachments off the host, with their bytes', async () => {
    const answer = api.attachments(7);
    const request = http.expectOne(URL);
    request.flush({
      attachments: [
        {
          id: 'a1',
          mimeType: 'image/png',
          label: 'Sketch 1',
          source: 'SKETCH',
          createdAt: '2026-08-09T09:00:00Z',
          dataBase64: 'AAAA',
        },
      ],
    });

    expect(request.request.method).toBe('GET');
    expect(await answer).toEqual([
      {
        id: 'a1',
        mimeType: 'image/png',
        label: 'Sketch 1',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:00:00Z',
        dataBase64: 'AAAA',
      },
    ]);
  });

  it('answers an empty list for a workspace with no images', async () => {
    const answer = api.attachments(7);
    http.expectOne(URL).flush({ attachments: [] });

    expect(await answer).toEqual([]);
  });

  it('posts the bare base64 with its source, and keeps the row the server answers', async () => {
    const answer = api.attach(7, {
      mimeType: 'image/png',
      label: 'Sketch 2',
      source: 'SKETCH',
      dataBase64: 'AAAA',
    });
    const request = http.expectOne(URL);
    request.flush(
      {
        id: 'a2',
        mimeType: 'image/png',
        label: 'Sketch 2',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:05:00Z',
      },
      { status: 201, statusText: 'Created' },
    );

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      mimeType: 'image/png',
      label: 'Sketch 2',
      source: 'SKETCH',
      dataBase64: 'AAAA',
    });
    // The bytes are deliberately not echoed: the caller has them, and the id is what it lacked.
    expect(await answer).toEqual({
      id: 'a2',
      mimeType: 'image/png',
      label: 'Sketch 2',
      source: 'SKETCH',
      createdAt: '2026-08-09T09:05:00Z',
    });
  });

  it('lets the over-the-cap 413 through, because it is the one failure worth naming', async () => {
    const answer = api.attach(7, {
      mimeType: 'image/png',
      label: 'Sketch 1',
      source: 'SKETCH',
      dataBase64: 'AAAA',
    });
    http
      .expectOne(URL)
      .flush({ message: 'too large' }, { status: 413, statusText: 'Content Too Large' });

    await expect(answer).rejects.toBeDefined();
  });

  it('removes one attachment by id, scoped to its workspace', async () => {
    const answer = api.remove(7, 'a1');
    const request = http.expectOne(`${URL}/a1`);
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(request.request.method).toBe('DELETE');
    await answer;
  });
});
