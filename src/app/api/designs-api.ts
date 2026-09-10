import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * The HTML designs on a refinement, on the **host** rather than the daemon.
 *
 * A design is one page of the running application, captured with its styles inlined, stored as a
 * database row beside the refinement. Host-owned for the reason the prompt attachments are (see
 * {@link ./prompt-attachments-api#PromptAttachmentsApi}): a design is work product, and it must
 * outlive the container it was frozen from. These rows read while the workspace is STOPPED.
 *
 * **A design is a document, not a proposal.** There is no lifecycle, no badge and nothing waiting to
 * be accepted: a person and an agent write and rewrite the same rows, the way they both write the
 * epic's description. What stands in for the decision is {@link DesignDto.version} — a write
 * composed against an older read is refused with the current row, never merged.
 *
 * **The html rides only on the single read.** The listing is the gallery, and a gallery that carried
 * a megabyte of markup per tile would pay for every page nobody opens; {@link DesignDto.htmlBytes}
 * is what the tile draws instead.
 */

/**
 * One design.
 *
 * **`html` is present on the single read and absent everywhere else** — the listing, the create and
 * the write all answer the row without it. That is the same asymmetry the attachments have and for
 * the same reason: the caller that just posted the markup still holds it.
 */
export interface DesignDto {
  readonly id: string;
  readonly title: string;
  /** The application route this was frozen from, as the page saw it. */
  readonly sourceRoute: string | null;
  /** UTF-8 size of the stored markup, which is what a tile draws instead of the markup. */
  readonly htmlBytes: number;
  /** Whether the freeze hit its byte budget and dropped subtrees. */
  readonly truncated: boolean;
  /** Bumped on every write. Send back the one you read, or the write is refused. */
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The frozen page. Only the single read carries it. */
  readonly html?: string;
}

/** What a POST sends. `sourceRoute` is absent when the freeze could not say where it came from. */
export interface NewDesign {
  readonly title: string;
  readonly html: string;
  readonly sourceRoute?: string;
  readonly truncated: boolean;
}

/**
 * What a PUT sends. `html` omitted leaves the document alone, which is how a rename travels without
 * carrying the markup back up; `version` is the one the caller last read and is required.
 */
export interface DesignWrite {
  readonly title: string;
  readonly html?: string;
  readonly version: number;
}

interface DesignsResponse {
  readonly designs: readonly DesignDto[];
}

@Injectable({ providedIn: 'root' })
export class DesignsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every design on this refinement, **without its markup**.
   *
   * A refinement with no designs answers an empty list rather than a 404, so absence is an ordinary
   * state here and needs no translation. The only 404 is "no such refinement".
   */
  async list(refinementId: number): Promise<readonly DesignDto[]> {
    const answer = await firstValueFrom(this.http.get<DesignsResponse>(this.url(refinementId)));
    return answer.designs ?? [];
  }

  /** One design, **with its markup** — the only read that carries it. */
  async get(refinementId: number, designId: string): Promise<DesignDto> {
    return await firstValueFrom(this.http.get<DesignDto>(this.row(refinementId, designId)));
  }

  /**
   * Freeze a page into a new design of record.
   *
   * **413 means the markup is over the cap** and is the one failure worth naming on screen: a reader
   * told "over the size limit" can freeze a smaller page, where a status code tells them nothing.
   */
  async create(refinementId: number, design: NewDesign): Promise<DesignDto> {
    return await firstValueFrom(this.http.post<DesignDto>(this.url(refinementId), design));
  }

  /**
   * Rewrite a design in place.
   *
   * **409 means somebody wrote to it after this caller read it**, and the response body carries the
   * current row under `current`. It is left to throw: the caller has text the service refused, and
   * silently dropping either side is the one thing this door exists to prevent.
   */
  async write(refinementId: number, designId: string, write: DesignWrite): Promise<DesignDto> {
    return await firstValueFrom(
      this.http.put<DesignDto>(this.row(refinementId, designId), write),
    );
  }

  /** Retitle a design, leaving its markup alone. */
  async rename(
    refinementId: number,
    designId: string,
    title: string,
    version: number,
  ): Promise<DesignDto> {
    return await this.write(refinementId, designId, { title, version });
  }

  /** Remove one design. 204. */
  async remove(refinementId: number, designId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.row(refinementId, designId)));
  }

  private row(refinementId: number, designId: string): string {
    return `${this.url(refinementId)}/${encodeURIComponent(designId)}`;
  }

  private url(refinementId: number): string {
    return `${this.base}/projects/api/refinements/${encodeURIComponent(refinementId)}/designs`;
  }
}
