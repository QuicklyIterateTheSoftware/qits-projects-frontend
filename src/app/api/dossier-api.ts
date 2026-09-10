import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * The epic's dossier — its long form, on the **epic** rather than on the refinement.
 *
 * The epic's description is the value pitch; the dossier is the breakdown, with examples, images
 * from the Sketch tab and designs framed inline. It is written on the refining route and stored with
 * the epic, so discarding the refinement container leaves the plan intact and implementation can
 * still read it months later.
 *
 * **Every write carries the version it was composed against.** Nobody accepts a write here, so a
 * person editing in this tab while an agent writes from a prompt is the ordinary case: a stale
 * version answers 409 **with the current page on it**, which is what lets the tab show both sides
 * instead of dropping what somebody typed. {@link DossierApi.write} hands that back as a
 * {@link PageConflict} rather than throwing it away.
 */

/** One page. The list carries bodies: a dossier is a handful of pages and the tab renders one. */
export interface DossierPageDto {
  readonly id: string;
  readonly epicId: string;
  /** Minted at create and never changed: it is what `?page=` names. */
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly body: string;
  /** Send this back on a write, or the write is refused. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What a write sends. `body` omitted leaves the markdown alone, which is how a rename travels. */
export interface DossierPageWrite {
  readonly title?: string;
  readonly body?: string;
  readonly version: number;
}

/**
 * A refused write, with the page as it now stands.
 *
 * Returned rather than thrown, because it is not an error in the caller's sense: the person still
 * has their text, and the panel's job is to show them what it would have overwritten.
 */
export interface PageConflict {
  readonly conflict: true;
  readonly current: DossierPageDto;
}

/** One inlined figure and the exact markdown line that renders it. */
export interface InlinedFigure {
  readonly id: string;
  readonly kind: 'IMAGE' | 'DESIGN';
  readonly label: string;
  readonly url: string;
  readonly markdown: string;
}

interface PagesResponse {
  readonly pages: readonly DossierPageDto[];
}

/** The content URL of an inlined figure — the one the renderer reads to decide img or iframe. */
export function dossierAssetContentUrl(epicId: string, assetId: string, base = ''): string {
  return `${base}/epics/${encodeURIComponent(epicId)}/dossier-assets/${encodeURIComponent(assetId)}/content`;
}

@Injectable({ providedIn: 'root' })
export class DossierApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Every page of this epic's dossier, in reading order, bodies included. */
  async list(epicId: string): Promise<readonly DossierPageDto[]> {
    const answer = await firstValueFrom(this.http.get<PagesResponse>(this.url(epicId)));
    return answer.pages ?? [];
  }

  async create(epicId: string, title: string, body = ''): Promise<DossierPageDto> {
    return await firstValueFrom(this.http.post<DossierPageDto>(this.url(epicId), { title, body }));
  }

  /**
   * Write a page, and answer a {@link PageConflict} rather than throwing when somebody else wrote
   * first. Every other failure still throws — a 409 is the one a person can act on here.
   */
  async write(
    epicId: string,
    pageId: string,
    write: DossierPageWrite,
  ): Promise<DossierPageDto | PageConflict> {
    try {
      return await firstValueFrom(this.http.put<DossierPageDto>(this.row(epicId, pageId), write));
    } catch (error) {
      const current = conflictingPage(error);
      return current ? { conflict: true, current } : Promise.reject(error);
    }
  }

  async move(epicId: string, pageId: string, position: number): Promise<DossierPageDto> {
    return await firstValueFrom(
      this.http.post<DossierPageDto>(`${this.row(epicId, pageId)}/move`, { position }),
    );
  }

  async remove(epicId: string, pageId: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.row(epicId, pageId)));
  }

  /**
   * Copy a sketch or a design into this epic and answer the markdown line to paste.
   *
   * Nothing in the UI writes an asset URL by hand: a hand-written one eventually names a figure that
   * does not exist, or one belonging to another epic.
   */
  async inlineFigure(
    epicId: string,
    sourceId: string,
    kind: 'IMAGE' | 'DESIGN',
  ): Promise<InlinedFigure> {
    return await firstValueFrom(
      this.http.post<InlinedFigure>(
        `${this.base}/projects/api/epics/${encodeURIComponent(epicId)}/dossier-assets`,
        {
          sourceId,
          kind,
        },
      ),
    );
  }

  private row(epicId: string, pageId: string): string {
    return `${this.url(epicId)}/${encodeURIComponent(pageId)}`;
  }

  private url(epicId: string): string {
    return `${this.base}/projects/api/epics/${encodeURIComponent(epicId)}/dossier`;
  }
}

/** The current page a 409 carried, or null when this was not that refusal. */
function conflictingPage(error: unknown): DossierPageDto | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const current = (error.error as { current?: DossierPageDto } | null)?.current;
  return current ?? null;
}
