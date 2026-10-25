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
  /**
   * The entity this room refines — an epic's or a ticket's id (qits-395). The key the page matches
   * its room by.
   */
  readonly entityId: string;
  /**
   * The same value as {@link entityId}, kept by the service for the SPA this one replaces and removed
   * in a later release. Nothing here reads it.
   */
  readonly epicId?: string;
  readonly projectId: string;
  readonly repositoryId: string;
  /**
   * `refining/<slug>` on the project's wrapper — **a legacy container room's only** (epic qits-770).
   * A room opened since is a session of the project's front desk and has no branch: the service
   * answers null, and drops the field once the legacy rooms are gone (qits-1316). See
   * {@link isSessionRoom}.
   */
  readonly branch?: string | null;
  /** What a legacy room forked from. Null on a session room, and dropped with {@link branch}. */
  readonly parent?: string | null;
  /** `refining-<epicSlug>`, decoration — the id above is the address. */
  readonly label: string;
  /**
   * A session room's session state as the desk reported it (`STARTING | RUNNING | STOPPED | FAILED`),
   * or a legacy room's container state (`PROVISIONING | RUNNING | STOPPED | FAILED`).
   */
  readonly runtimeStatus: 'STARTING' | 'RUNNING' | 'STOPPED' | 'PROVISIONING' | 'FAILED' | null;
  /** The detail behind {@link runtimeStatus} — a session's failure, or a container's. */
  readonly runtimeError: string | null;
  readonly agentActivity: 'IDLE' | 'BUSY' | 'WAITING' | 'ENDED' | null;
  readonly createdAt: string | null;
  /**
   * The harness session the desk last reported for this room — kept after a stop, so the next
   * launch resumes it. Absent from a service before epic qits-770, null on a legacy room.
   */
  readonly sessionId?: string | null;
  /** The desk command running the room's session, while it runs. What the Chat tab attaches to. */
  readonly commandId?: string | null;
  /**
   * The front desk's own state word (QUEUED, PROVISIONING, RUNNING, STOPPED, FAILED, UNAVAILABLE,
   * ABSENT) — the container every session room's session runs in. Null on a legacy room.
   */
  readonly deskStatus?: string | null;
  /** The desk's failure, when it has one. */
  readonly deskDetail?: string | null;
  /**
   * The desk's container proxy, `/projects/container/<projectId>/` — where a session room's chat,
   * agents and commands are read. Null on a legacy room, absent from an older service.
   */
  readonly deskBase?: string | null;
}

/**
 * Whether a room is a **session of its project's front desk** (epic qits-770) rather than a legacy
 * container room of its own.
 *
 * <p>The service's own rule is "the branch decides": every row opened before V57 has a
 * `refining/<slug>` branch and stays a container room until qits-1316 deletes them, and every row
 * opened since has none. The desk base is asked as well, so a row from a service older than the
 * session rooms — which sends no `deskBase` at all — is never mistaken for one.
 */
export function isSessionRoom(row: Pick<RefinementDto, 'branch' | 'deskBase'>): boolean {
  return !row.branch && !!row.deskBase;
}

interface RefinementResponse {
  readonly refinement: RefinementDto;
}

/** The entity door's answer: find-or-create answers a room, find-only may answer none. */
interface EntityRefinementResponse {
  readonly refinement: RefinementDto | null;
}

interface ListResponse {
  readonly refinements: readonly RefinementDto[];
}

interface ActiveProcessResponse {
  readonly technicalProcessId: string | null;
}

/**
 * The refinement lifecycle surface of qits-projects — everything the refining route used to take
 * from `/workspaces/api/**`, on this SPA's own service.
 *
 * **Find-or-create is one idempotent POST keyed by the entity** — `POST /work/{q}/refinement`, by
 * qualified id (epic qits-965), for an epic, a ticket (qits-395) or a campaign (epic qits-770) alike.
 * An entity that already has a room answers it, and two racing opens are settled by a unique
 * constraint rather than by client choreography. A room opened now is a session of the project's
 * front desk and cuts no branch; see {@link isSessionRoom}.
 *
 * **The lifecycle verbs are `ensure` and `stop`** (epic qits-770), which answer both kinds of room.
 * The container verbs (`ensure-container`, `stop-container`, `recreate-container`) are no longer
 * called from here; the service removes them in its next release.
 */
@Injectable({ providedIn: 'root' })
export class RefinementsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Find the entity's room or make one — a session of the project's front desk (epic qits-770).
   *
   * <p>Refused with a 409 for a feature or a task — refinement stays an epic's, a ticket's and a
   * campaign's surface even once a feature and a task carry their own status (qits-763) — unless the
   * entity is REPORTED, while a dispatch runs on it, and past the project's session cap
   * (`REFINEMENT_SESSIONS_FULL`). An existing room is always answered, whatever the entity's state.
   */
  async openFor(ref: string): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.post<RefinementResponse>(this.entityDoor(ref), null),
    );
    return answer.refinement;
  }

  /** The entity's room, or null when there is none. Never creates — `GET /work/{q}/refinement`. */
  async findFor(ref: string): Promise<RefinementDto | null> {
    const answer = await firstValueFrom(
      this.http.get<EntityRefinementResponse>(this.entityDoor(ref)),
    );
    return answer?.refinement ?? null;
  }

  /** One refinement with its full projection. */
  async get(refinementId: number): Promise<RefinementDto> {
    const answer = await firstValueFrom(this.http.get<RefinementResponse>(this.url(refinementId)));
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

  /**
   * Bring the room up — `POST /refinements/{id}/ensure` (epic qits-770). A session room's demand is
   * stamped and its session pushed to the desk (a **409** `REFINEMENT_SESSIONS_FULL` past the
   * project's cap); a legacy room's container ladder is begun, its narration found by
   * {@link activeProcess}. Answers the row as it now stands.
   */
  async ensure(refinementId: number): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.post<RefinementResponse>(`${this.url(refinementId)}/ensure`, {}),
    );
    return answer.refinement;
  }

  /**
   * Stop the room — `POST /refinements/{id}/stop`: a session room's demand is cleared and its session
   * stopped; a legacy room's container is stopped with its checkout left in place.
   */
  async stop(refinementId: number): Promise<RefinementDto> {
    const answer = await firstValueFrom(
      this.http.post<RefinementResponse>(`${this.url(refinementId)}/stop`, {}),
    );
    return answer.refinement;
  }

  /** Tear the refinement down: container, volume, credential, branch, row. */
  async discard(refinementId: number): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${this.url(refinementId)}/discard`, {}));
  }

  /**
   * The ensure narration currently live for a **legacy** container room, or null. A session room has
   * none (the service answers null), so the page does not ask for one; the door goes with the legacy
   * rooms (qits-1316).
   */
  async activeProcess(refinementId: number): Promise<string | null> {
    const answer = await firstValueFrom(
      this.http.get<ActiveProcessResponse>(`${this.url(refinementId)}/active-process`),
    );
    return answer.technicalProcessId ?? null;
  }

  /** `ref` is the entity's qualified id, or its id for a row that has none. */
  private entityDoor(ref: string): string {
    return `${this.base}/projects/api/work/${encodeURIComponent(ref)}/refinement`;
  }

  private url(refinementId: number): string {
    return `${this.base}/projects/api/refinements/${encodeURIComponent(refinementId)}`;
  }
}
