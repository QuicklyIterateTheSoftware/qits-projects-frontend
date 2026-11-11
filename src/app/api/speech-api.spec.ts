import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QITS_NAVIGATION, toNavTree, type QitsNavTree } from '@qits/ui-components';
import { SpeechApi } from './speech-api';

const STT_ORIGIN = 'https://stt.qits.example';

/**
 * qits-stt, which is one route with one field either way. It now has its own host — the edge no
 * longer routes `/stt` here — so the request goes to the origin the navigation names, carries the
 * session, and is not made at all until the navigation has answered.
 */
describe('SpeechApi', () => {
  let tree: WritableSignal<QitsNavTree | undefined>;
  let api: SpeechApi;
  let http: HttpTestingController;

  beforeEach(() => {
    tree = signal<QitsNavTree | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: QITS_NAVIGATION, useValue: { tree, failed: signal(false) } },
      ],
    });
    api = TestBed.inject(SpeechApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function answer(applications?: Record<string, { origin: string }>): void {
    tree.set(toNavTree({ slots: {}, applications }));
    TestBed.tick();
  }

  /** Lets the awaited URL resolve, so a request that is going out has gone out. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('asks nothing before the navigation says where qits-stt is', async () => {
    const answerPromise = api.transcribe('UklGRg==');
    await settle();
    http.expectNone(() => true);
    answer({ 'qits-stt': { origin: STT_ORIGIN } });
    await settle();
    http.expectOne(`${STT_ORIGIN}/stt/api/transcriptions`).flush({ text: 'add a health check' });
    expect(await answerPromise).toBe('add a health check');
  });

  it('posts the clip to qits-stt’s own origin, with no cookie', async () => {
    answer({ 'qits-stt': { origin: STT_ORIGIN } });
    const answerPromise = api.transcribe('UklGRg==');
    await settle();
    const request = http.expectOne(`${STT_ORIGIN}/stt/api/transcriptions`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ audioBase64: 'UklGRg==' });
    expect(request.request.withCredentials).toBe(false);
    request.flush({ text: 'add a health check' });
    expect(await answerPromise).toBe('add a health check');
  });

  it('reads a missing text field as an empty transcript', async () => {
    answer({ 'qits-stt': { origin: STT_ORIGIN } });
    const answerPromise = api.transcribe('UklGRg==');
    await settle();
    http.expectOne(`${STT_ORIGIN}/stt/api/transcriptions`).flush({});
    expect(await answerPromise).toBe('');
  });

  it('keeps the same-origin path where the navigation names no origin for qits-stt', async () => {
    answer();
    const answerPromise = api.transcribe('UklGRg==');
    await settle();
    http.expectOne('/stt/api/transcriptions').flush({ text: 'ok' });
    expect(await answerPromise).toBe('ok');
  });

  /**
   * {@link SpeechApi.availability}, the gate `prompt-panel.ts` reads before it offers Record at all
   * — qits-2061, once qits-stt moved behind the network-access tunnel.
   */
  describe('availability', () => {
    it('is pending before the navigation has answered', () => {
      expect(api.availability()).toBe('pending');
    });

    it('is absent once the navigation answers naming no such application', () => {
      answer({});
      expect(api.availability()).toBe('absent');
    });

    it('is reachable with no request at all for a public qits-stt', async () => {
      answer({ 'qits-stt': { origin: STT_ORIGIN } });
      await settle();
      expect(api.availability()).toBe('reachable');
      http.expectNone(() => true);
    });

    it('stays pending while a private qits-stt’s probe is out, then unreachable on a bad answer', async () => {
      tree.set(
        toNavTree({
          slots: {},
          applications: { 'qits-stt': { origin: STT_ORIGIN, exposure: 'private' } },
        }),
      );
      TestBed.tick();
      expect(api.availability()).toBe('pending');

      http
        .expectOne(`${STT_ORIGIN}/stt/q/health/ready`)
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      await settle();

      expect(api.availability()).toBe('unreachable');
    });

    it('is reachable once a private qits-stt’s probe answers with a 2xx', async () => {
      tree.set(
        toNavTree({
          slots: {},
          applications: { 'qits-stt': { origin: STT_ORIGIN, exposure: 'private' } },
        }),
      );
      TestBed.tick();

      http
        .expectOne(`${STT_ORIGIN}/stt/q/health/ready`)
        .flush('ok', { status: 200, statusText: 'OK' });
      await settle();

      expect(api.availability()).toBe('reachable');
    });
  });
});
