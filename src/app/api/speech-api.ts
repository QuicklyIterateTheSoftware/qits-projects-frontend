import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { firstValueFrom } from 'rxjs';

/**
 * qits-stt: one route, one field in, one field out.
 *
 * `POST /stt/api/transcriptions` takes `{audioBase64}` and answers `{text}`. It is a third service
 * this page talks to, and qits-stt now has its own host: the edge no longer routes `/stt` on this
 * one, so the URL is built from `applications['qits-stt'].origin` off the navigation, via
 * {@link QitsAppLinks.whenApiUrl}, and the request carries the session (`withCredentials` — the
 * edge answers credentialed CORS for any origin under the platform domain) rather than firing a
 * same-origin path first.
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
 */
@Injectable({ providedIn: 'root' })
export class SpeechApi {
  private readonly http = inject(HttpClient);
  private readonly links = inject(QitsAppLinks);

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
    const url = await this.links.whenApiUrl('qits-stt', '/stt/api/transcriptions');
    const answer = await firstValueFrom(
      this.http.post<{ text?: string }>(url, { audioBase64 }, { withCredentials: true }),
    );
    return answer.text ?? '';
  }
}
