import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * A dossier — the long form of the row that owns it, on the **row** rather than on the refinement.
 *
 * An epic's description is the value pitch; the dossier is the breakdown, with examples, images
 * from the Sketch tab and designs framed inline. It is written on the refining route and stored with
 * the epic, so discarding the refinement container leaves the plan intact and implementation can
 * still read it months later.
 *
 * <b>A ticket owns one too.</b> The refine phase reads the code, works out the root cause and
 * normally writes it into the ticket's `description`; where the situation is too tangled for prose —
 * an error scenario crossing four services, a sequence that wants a figure — it writes dossier pages
 * instead, over MCP. Same routes, same roles, same version precondition, same 409 shape, with the
 * owner in the path. There is deliberately **no ticket asset route**: a ticket's pages are prose and
 * inlined markdown, and the sketch/design pipeline that produces assets belongs to the refining
 * route an epic has and a ticket does not. {@link DossierApi.inlineFigure} therefore takes an epic
 * id and nothing else.
 *
 * **Every write carries the version it was composed against.** Nobody accepts a write here, so a
 * person editing in this tab while an agent writes from a prompt is the ordinary case: a stale
 * version answers 409 **with the current page on it**, which is what lets the tab show both sides
 * instead of dropping what somebody typed. {@link DossierApi.write} hands that back as a
 * {@link PageConflict} rather than throwing it away.
 */

/** Which row a dossier hangs off. An epic has had one since the refining route; a ticket now does. */
export type DossierOwnerKind = 'epic' | 'ticket';

/**
 * The owner of a dossier: what kind of row it is, and which one.
 *
 * A pair rather than two optional ids, because "which collection is in the path" and "which row" are
 * one fact. Every read and write here takes it, and {@link DossierApi} is the only place that turns
 * it into a URL — a caller that composed the path itself would be a second copy of the route.
 */
export interface DossierOwner {
  readonly kind: DossierOwnerKind;
  readonly id: string;
}

export const epicDossier = (epicId: string): DossierOwner => ({ kind: 'epic', id: epicId });

export const ticketDossier = (ticketId: string): DossierOwner => ({ kind: 'ticket', id: ticketId });

/**
 * What a caller has to hold to address one page — and it is the page, not an id.
 *
 * **The two owners address a row by different segments.** An epic's page is addressed by its id, the
 * segment that route has taken since it was written; a ticket's is addressed by its **slug**, which
 * is what the MCP door that writes those pages names them by. Handing the row itself to every method
 * is what lets the one client serve both without a caller ever having to know which.
 */
export type DossierPageRef = Pick<DossierPageDto, 'id' | 'slug'>;

/** One page. The list carries bodies: a dossier is a handful of pages and the tab renders one. */
export interface DossierPageDto {
  readonly id: string;
  /** The owning epic, or null on a page a ticket owns. */
  readonly epicId: string | null;
  /** The owning ticket. Absent on the epic route's rows, which never learned the field. */
  readonly ticketId?: string | null;
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
  /**
   * The service's own sentence about the refusal, when it sent one.
   *
   * Shown as it stands rather than wrapped in this client's prose, the same rule the ticket
   * transition follows: the server is the one that knows what happened, and a status code in front
   * of its sentence would bury it.
   */
  readonly message: string | null;
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

  /** Every page of this owner's dossier, in reading order, bodies included. */
  async list(owner: DossierOwner): Promise<readonly DossierPageDto[]> {
    const answer = await firstValueFrom(this.http.get<PagesResponse>(this.url(owner)));
    return answer.pages ?? [];
  }

  async create(owner: DossierOwner, title: string, body = ''): Promise<DossierPageDto> {
    return await firstValueFrom(this.http.post<DossierPageDto>(this.url(owner), { title, body }));
  }

  /**
   * Write a page, and answer a {@link PageConflict} rather than throwing when somebody else wrote
   * first. Every other failure still throws — a 409 is the one a person can act on here.
   */
  async write(
    owner: DossierOwner,
    page: DossierPageRef,
    write: DossierPageWrite,
  ): Promise<DossierPageDto | PageConflict> {
    try {
      return await firstValueFrom(this.http.put<DossierPageDto>(this.row(owner, page), write));
    } catch (error) {
      return conflictingPage(error) ?? Promise.reject(error);
    }
  }

  async move(owner: DossierOwner, page: DossierPageRef, position: number): Promise<DossierPageDto> {
    return await firstValueFrom(
      this.http.post<DossierPageDto>(`${this.row(owner, page)}/move`, { position }),
    );
  }

  async remove(owner: DossierOwner, page: DossierPageRef): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.row(owner, page)));
  }

  /**
   * Copy a sketch or a design into this epic and answer the markdown line to paste.
   *
   * Nothing in the UI writes an asset URL by hand: a hand-written one eventually names a figure that
   * does not exist, or one belonging to another epic.
   *
   * **Epics only, and it takes an epic id rather than an owner to say so in the signature.** There
   * is no ticket asset route — an upload against a ticket-owned page is a 404 by simple absence —
   * so the panel hides the affordance rather than this method refusing at runtime.
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

  /** One page's row. See {@link DossierPageRef} for why the segment is not the same on both. */
  private row(owner: DossierOwner, page: DossierPageRef): string {
    const segment = owner.kind === 'epic' ? page.id : page.slug;
    return `${this.url(owner)}/${encodeURIComponent(segment)}`;
  }

  private url(owner: DossierOwner): string {
    const collection = owner.kind === 'epic' ? 'epics' : 'tickets';
    return `${this.base}/projects/api/${collection}/${encodeURIComponent(owner.id)}/dossier`;
  }
}

/** The refusal a 409 carried, or null when this was not that refusal. */
function conflictingPage(error: unknown): PageConflict | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const body = error.error as { current?: DossierPageDto; message?: unknown } | null;
  const current = body?.current;
  if (!current) return null;
  return {
    conflict: true,
    current,
    message: typeof body?.message === 'string' && body.message ? body.message : null,
  };
}
