import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * The images beside a workspace's prompt draft, on the **host** rather than the daemon.
 *
 * Host-owned for the same reason the draft is (see {@link ./prompt-draft-api#PromptDraftApi}): an
 * attached picture is work product and must outlive the container it was drawn for. These rows work
 * while the workspace is STOPPED, because they are database rows and nothing else.
 *
 * **A separate resource from the draft, and therefore a separate topic.** Text autosave fires on a
 * debounced keystroke; images do not change with it. Sharing one hint topic would make every
 * keystroke re-download every image in every other open view, so the service fires
 * `prompt-attachments` on its own and this client is read against that counter.
 *
 * The bytes ride as base64 in JSON rather than as multipart, which is the service's choice and not
 * this client's: one media type across the whole API is worth more than the ~33% encoding overhead
 * on an image already capped at a couple of megabytes.
 */

/** Where an attachment came from. The server rejects anything else with a 400. */
export type PromptAttachmentSource = 'SKETCH' | 'PASTE';

/**
 * One attached image.
 *
 * **`dataBase64` is present on the list read and absent on the answer to a POST**, and that
 * asymmetry is deliberate rather than an oversight in the service: the caller that just uploaded the
 * bytes still has them in memory, so echoing a megabyte back would be pure cost. What a POST *does*
 * answer with is the server-generated `id` and the media type its sniff settled on — the claimed
 * `mimeType` is advisory and the bytes decide.
 */
export interface PromptAttachmentDto {
  readonly id: string;
  readonly mimeType: string;
  readonly label: string;
  readonly source: PromptAttachmentSource;
  readonly createdAt: string;
  /** Bare base64 — no `data:` prefix. Only the list read carries it. */
  readonly dataBase64?: string;
}

/** What a POST sends. `mimeType` is a hint; the server sniffs the magic bytes and its answer wins. */
export interface NewPromptAttachment {
  readonly mimeType: string;
  readonly label: string;
  readonly source: PromptAttachmentSource;
  readonly dataBase64: string;
}

interface AttachmentsResponse {
  readonly attachments: readonly PromptAttachmentDto[];
}

export function promptAttachmentContentUrl(
  workspaceRowId: number,
  attachmentId: string,
  base = '',
): string {
  return `${base}/projects/api/refinements/${encodeURIComponent(workspaceRowId)}/prompt-attachments/${encodeURIComponent(attachmentId)}/content`;
}

@Injectable({ providedIn: 'root' })
export class PromptAttachmentsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every attachment on this workspace, oldest first, **with its bytes**.
   *
   * A workspace with no images answers an empty list rather than a 404, so absence needs no special
   * handling here: it is an ordinary state and reads as one. The only 404 is "no such ACTIVE
   * workspace", which is not a case any caller can be in — a panel is not drawn for a workspace the
   * shell has already failed to resolve — so it is left to throw like every other failure.
   */
  async attachments(workspaceRowId: number): Promise<readonly PromptAttachmentDto[]> {
    const answer = await firstValueFrom(
      this.http.get<AttachmentsResponse>(this.url(workspaceRowId)),
    );
    return answer.attachments ?? [];
  }

  /**
   * Attach one image, and answer the stored row.
   *
   * The answer is used rather than discarded: only the server knows the row's `id`, and only the
   * server's sniff knows what the bytes actually are.
   *
   * 400 means the payload is not valid base64, or not a PNG or a JPEG; **413 means the image is over
   * the per-image cap** and is the one failure worth naming on screen, because it is the one the
   * reader can do something about; 404 means there is no such ACTIVE workspace.
   */
  async attach(
    workspaceRowId: number,
    attachment: NewPromptAttachment,
  ): Promise<PromptAttachmentDto> {
    return await firstValueFrom(
      this.http.post<PromptAttachmentDto>(this.url(workspaceRowId), attachment),
    );
  }

  /** Replace the bytes without changing the row id used by document image URLs. */
  async update(
    workspaceRowId: number,
    attachmentId: string,
    attachment: NewPromptAttachment,
  ): Promise<PromptAttachmentDto> {
    return await firstValueFrom(
      this.http.put<PromptAttachmentDto>(
        `${this.url(workspaceRowId)}/${encodeURIComponent(attachmentId)}`,
        attachment,
      ),
    );
  }

  /** Root-absolute, browser-loadable URL for a stored image. */
  contentUrl(workspaceRowId: number, attachmentId: string): string {
    return promptAttachmentContentUrl(workspaceRowId, attachmentId, this.base);
  }

  /**
   * Remove one attachment. 204 on success.
   *
   * A 404 here means the workspace or the row is unknown *on this workspace* — an id from another
   * workspace is not found here, which says nothing about whether it exists elsewhere. It is not
   * translated: a remove that did not remove anything is worth reporting.
   */
  async remove(workspaceRowId: number, attachmentId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.url(workspaceRowId)}/${encodeURIComponent(attachmentId)}`),
    );
  }

  private url(workspaceRowId: number): string {
    return `${this.base}/projects/api/refinements/${encodeURIComponent(workspaceRowId)}/prompt-attachments`;
  }
}
