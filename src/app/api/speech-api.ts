import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { firstValueFrom } from 'rxjs';

/** The application name qits-stt is addressed by on the navigation. */
const APP = 'qits-stt';

/**
 * Its readiness probe. Deliberately not `/stt/api/transcriptions` — a GET against that route is not
 * a thing the service answers — and deliberately not a model call: the point is only "is anything
 * listening", so the cheapest route that says so is the right one.
 */
const HEALTH_PATH = '/stt/q/health/ready';

/**
 * Whether dictation can be offered right now, as the four states {@link SpeechApi.availability}
 * tells apart.
 *
 * - `'pending'`: the navigation has not answered yet, or it has and the readiness probe it started
 *   is still in flight. The caller has nothing to say about *why* — only that it does not know yet.
 * - `'absent'`: the navigation answered and qits-stt is not one of the applications it named. An
 *   older edge, or a platform without the service at all, both read this way, and recording is
 *   simply not offered — there is no door to wait at.
 * - `'unreachable'`: qits-stt is declared `private` and the one credentialed probe against it did
 *   not come back with a 2xx — the common case being a browser that is not on the network-access
 *   tunnel.
 * - `'reachable'`: the probe answered, or qits-stt was never private to begin with.
 */
export type DictationAvailability = 'pending' | 'absent' | 'unreachable' | 'reachable';

/**
 * qits-stt: one route, one field in, one field out — plus, since it moved behind the network-access
 * tunnel (qits-2061), one health route to ask before offering the microphone at all.
 *
 * `POST /stt/api/transcriptions` takes `{audioBase64}` and answers `{text}`. It is a third service
 * this page talks to, and qits-stt now has its own host: the edge no longer routes `/stt` on this
 * one, so the URL is built from `applications['qits-stt'].origin` off the navigation, via
 * {@link QitsAppLinks.whenApiUrl}, and the request carries the bearer — `qitsBearerInterceptor`
 * signs every call to a host under the platform domain (epic qits-543, qits-1348), and the edge
 * answers CORS for any origin under it — rather than firing a same-origin path first.
 *
 * **Copied verbatim from qits-spa-workspaces, and it needed no adaptation at all** — which is the point
 * worth recording: nothing on this surface is workspace-scoped or project-scoped, so the same file
 * reaches the same service from any SPA the edge serves.
 *
 * **The bytes must be a WAV.** The service decodes the base64, writes it to a `.wav` file and hands
 * the path to a resident python worker; any common PCM rate is fine because the model resamples, but
 * the container is not a transcoder. Encoding is the browser's job — see `chat/recorder.ts`.
 *
 * It is a *host-side* service on purpose, which is why it is not behind the container proxy: the
 * model is loaded once and stays loaded, and transcription is not workspace-scoped — nothing here
 * takes a workspace or a repository.
 *
 * **qits-stt is now private**, reachable only through the network-access tunnel, which is why a
 * clip can fail even after this says `'reachable'` — the probe is one GET at one moment, not a
 * lease. {@link availability} is what a caller asks *before* offering Record; a transcription that
 * then fails anyway still says its own sentence (`chat/recorder.ts`'s "did not answer"), because the
 * two checks answer different questions and neither stands in for the other.
 */
@Injectable({ providedIn: 'root' })
export class SpeechApi {
  private readonly http = inject(HttpClient);
  private readonly links = inject(QitsAppLinks);

  /** What the one credentialed probe answered, or `undefined` while it — or the navigation — is out. */
  private readonly probed = signal<boolean | undefined>(undefined);

  constructor() {
    // One probe for the life of this (root) service, same as `QitsAppLinks.reachable` itself caches
    // it — calling this more than once would just hand back the same promise.
    void this.links.reachable(APP, HEALTH_PATH).then((answer) => this.probed.set(answer));
  }

  /**
   * Whether dictation can be offered right now. See {@link DictationAvailability} for what each
   * answer means to the caller.
   *
   * `apiOrigin` rather than {@link QitsAppLinks.exposure} alone decides `'absent'`: an application
   * the navigation never names answers `exposure` `'public'` exactly as a reachable one does — only
   * `apiOrigin`'s empty string is the fact that nothing was declared for it at all.
   */
  readonly availability = computed<DictationAvailability>(() => {
    const origin = this.links.apiOrigin(APP);
    if (origin === undefined) {
      return 'pending';
    }
    if (origin === '' && this.links.exposure(APP) !== 'private') {
      return 'absent';
    }
    const probed = this.probed();
    if (probed === undefined) {
      return 'pending';
    }
    return probed ? 'reachable' : 'unreachable';
  });

  /**
   * Transcribe one WAV clip.
   *
   * A blank `audioBase64` is a 400 — and note the envelope differs from the rest of the platform:
   * this one fails validation before the controller, so the body is Quarkus' `{title, status,
   * violations}` rather than the usual `{message}`. Nothing here reads it; the caller says its own
   * sentence about a failed clip, because "the transcription service is not answering" is more use
   * than a constraint name.
   */
  async transcribe(audioBase64: string): Promise<string> {
    const url = await this.links.whenApiUrl(APP, '/stt/api/transcriptions');
    const answer = await firstValueFrom(this.http.post<{ text?: string }>(url, { audioBase64 }));
    return answer.text ?? '';
  }
}
