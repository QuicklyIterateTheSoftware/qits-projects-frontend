import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * The frozen HTML designs on a refinement, on the **host** rather than the daemon.
 *
 * A design is one page of the running application, captured with its styles inlined, stored as a
 * database row beside the refinement. Host-owned for the reason the prompt attachments are (see
 * {@link ./prompt-attachments-api#PromptAttachmentsApi}): a design is work product, and it must
 * outlive the container it was frozen from. These rows read while the workspace is STOPPED.
 *
 * **An agent answers a design with another design.** It writes a row whose status is `PROPOSED` and
 * whose `basedOnDesignId` names the row it is answering, and there it waits — nothing is overwritten
 * until a person resolves it. {@link DesignsApi.resolve} is that decision and it has exactly two
 * outcomes, `REPLACE` and `KEEP`, because there are exactly two things a reader can mean.
 *
 * **The html rides only on the single read.** The listing is the gallery, and a gallery that carried
 * a megabyte of markup per tile would pay for every page nobody opens; {@link DesignDto.htmlBytes}
 * is what the tile draws instead.
 */

/** Whether a row is the design of record, or an agent's answer waiting on a person. */
export type DesignStatus = 'ACTIVE' | 'PROPOSED';

/**
 * One design.
 *
 * **`html` is present on the single read and absent everywhere else** — the listing, the create, the
 * rename and the resolve all answer the row without it. That is the same asymmetry the attachments
 * have and for the same reason: the caller that just posted the markup still holds it.
 */
export interface DesignDto {
  readonly id: string;
  readonly title: string;
  readonly status: DesignStatus;
  /** The row this one answers, for a proposal. Null on an ACTIVE design. */
  readonly basedOnDesignId: string | null;
  /** What the agent said about its proposal. Null when it said nothing. */
  readonly note: string | null;
  /** The application route this was frozen from, as the page saw it. */
  readonly sourceRoute: string | null;
  /** UTF-8 size of the stored markup, which is what a tile draws instead of the markup. */
  readonly htmlBytes: number;
  /** Whether the freeze hit its byte budget and dropped subtrees. */
  readonly truncated: boolean;
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
 * What to do with a proposal.
 *
 * `REPLACE` moves the proposal's markup onto the design it is based on and the proposal goes away;
 * `KEEP` promotes the proposal to a design of its own and leaves the original standing. Either way
 * the service answers **the surviving row** — the base for `REPLACE`, the proposal itself for
 * `KEEP` — so the caller never has to guess which id it is now looking at.
 */
export type DesignResolution = 'REPLACE' | 'KEEP';

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

  /** Retitle a design. The markup is untouched, which is why this sends only the title. */
  async rename(refinementId: number, designId: string, title: string): Promise<DesignDto> {
    return await firstValueFrom(
      this.http.put<DesignDto>(this.row(refinementId, designId), { title }),
    );
  }

  /**
   * Settle a proposal, and answer the row that survived it.
   *
   * 409 means the row is not a proposal — resolved by someone else in the meantime, or never one.
   * It is left to throw: a decision that decided nothing is worth reporting.
   */
  async resolve(
    refinementId: number,
    designId: string,
    mode: DesignResolution,
  ): Promise<DesignDto> {
    return await firstValueFrom(
      this.http.post<DesignDto>(`${this.row(refinementId, designId)}/resolve`, { mode }),
    );
  }

  /** Remove one design — a proposal being discarded, or a design of record being dropped. 204. */
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
