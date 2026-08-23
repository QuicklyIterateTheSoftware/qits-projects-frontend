import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * One refinement as qits-projects projects it — the row that replaced the refining workspace when
 * refinement moved out of the workspaces domain. The live-half field names are deliberately the
 * ones the status strip already consumed off `WorkspaceDto`, so the cutover moved a base URL and a
 * client, not a vocabulary.
 */
export interface RefinementDto {
  /** The row id — what every daemon, draft, attachment and lifecycle URL carries. */
  readonly id: number;
  readonly epicId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  /** `refining/<epicSlug>` on the project's wrapper. */
  readonly branch: string;
  /** What the refinement forked from — the wrapper's default branch at create time. */
  readonly parent: string;
  /** `refining-<epicSlug>`, decoration — the id above is the address. */
  readonly label: string;
  /** The chat's opening context, computed from the epic tree at create. */
  readonly preamble: string | null;
  readonly runtimeStatus: 'RUNNING' | 'STOPPED' | 'PROVISIONING' | 'FAILED' | null;
  readonly runtimeError: string | null;
  /** Three-valued: null is "the daemon has not vouched", which blocks a recreate. */
  readonly clean: boolean | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly conflictsWithParent: boolean;
  readonly agentActivity: 'IDLE' | 'BUSY' | 'WAITING' | 'ENDED' | null;
  readonly daemonConnectedAt: string | null;
  readonly daemonVersion: string | null;
  /** TRUE or null, never false — "outdated" is a claim, its absence is not one. */
  readonly daemonOutdated: boolean | null;
  readonly createdAt: string | null;
}

interface RefinementResponse {
  readonly refinement: RefinementDto;
}

interface ListResponse {
  readonly refinements: readonly RefinementDto[];
}

/** The ensure/recreate answer: the row as it now stands, and the narration to watch. */
export interface RefinementProcessResponse {
  readonly refinement: RefinementDto;
  readonly technicalProcessId: string | null;
}

interface ActiveProcessResponse {
  readonly technicalProcessId: string | null;
}

/**
 * The refinement lifecycle surface of qits-projects — everything the refining route used to take
 * from `/workspaces/api/**`, on this SPA's own service.
 *
 * **Find-or-create is one idempotent POST keyed by epic.** The 409/adopt-existing dance the
 * workspaces create needed is the server's ordinary path now: a `refining/<slug>` branch already on
 * the origin is adopted, an epic that already has a refinement answers it, and two racing opens are
 * settled by a unique constraint rather than by client choreography.
 */
@Injectable({ providedIn: 'root' })
export class RefinementsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Find the epic's refinement or make one — cutting (or adopting) the branch on the wrapper. */
  async open(epicId: string): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.post<RefinementResponse>(`${this.base}/projects/api/refinements`, { epicId }),
    );
    return answer.refinement;
  }

  /** One refinement with its full projection, git drift included. */
  async get(refinementId: number): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.get<RefinementResponse>(this.url(refinementId)),
    );
    return answer.refinement;
  }

  /**
   * A project's refinements — the find-without-create read and the activity bar's row. The light
   * projection: live halves without git drift, which only the single-row read pays for.
   */
  async list(projectId: string): Promise<readonly RefinementDto[]> {
    const answer = await firstValueFrom(
      this.http.get<ListResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/refinements`,
      ),
    );
    return answer.refinements ?? [];
  }

  /** Bring the container up. The work runs server-side off the request; watch the process. */
  async ensureContainer(refinementId: number): Promise<RefinementProcessResponse> {
    return firstValueFrom(
      this.http.post<RefinementProcessResponse>(`${this.url(refinementId)}/ensure-container`, {}),
    );
  }

  /** Stop the container, leaving it and its checkout in place. */
  async stopContainer(refinementId: number): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.post<RefinementResponse>(`${this.url(refinementId)}/stop-container`, {}),
    );
    return answer.refinement;
  }

  /** Replace the container. The server refuses with 400 unless the tree is provably clean. */
  async recreateContainer(refinementId: number): Promise<RefinementProcessResponse> {
    return firstValueFrom(
      this.http.post<RefinementProcessResponse>(
        `${this.url(refinementId)}/recreate-container`,
        {},
      ),
    );
  }

  /** Tear the refinement down: container, volume, credential, branch, row. */
  async discard(refinementId: number): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${this.url(refinementId)}/discard`, {}));
  }

  /** The ensure narration currently live for this refinement, or null. */
  async activeProcess(refinementId: number): Promise<string | null> {
    const answer = await firstValueFrom(
      this.http.get<ActiveProcessResponse>(`${this.url(refinementId)}/active-process`),
    );
    return answer.technicalProcessId ?? null;
  }

  private url(refinementId: number): string {
    return `${this.base}/projects/api/refinements/${encodeURIComponent(refinementId)}`;
  }
}
