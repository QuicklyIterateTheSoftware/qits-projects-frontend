import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/** Where every runner door lives. */
export const RUNNERS_PATH = '/projects/api/runners';

/** A node's agent login, as its runner last probed it. */
export type DeskRunnerLoginState = 'PRESENT' | 'ABSENT';

/** One desk a runner holds: which project's, and where it stands. */
export interface DeskRunnerDeskDto {
  readonly projectId: string;
  readonly slug?: string | null;
  readonly state?: string | null;
}

/** One named check inside a runner's last health result, as the runner list carries it. */
export interface DeskRunnerHealthCheckDto {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The last health check qits-projects ran against a runner; `null` for one never checked. */
export interface DeskRunnerHealthDto {
  readonly at: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly checks: readonly DeskRunnerHealthCheckDto[];
}

/**
 * One front-desk runner, as `GET /projects/api/runners` lists it (qits-767) — qits-projects'
 * `DeskRunnerDto`, a copy of qits-workspaces' runner DTO without the workspace memory limits and
 * with the desks the runner holds.
 *
 * Only `id`, `name` and `slots` are relied on. Everything else is optional so the page keeps
 * rendering whatever the registry's first release answers: `pinnedVersion` is the runner version
 * the service pins, and a connected runner reporting another `version` is about to be rolled over;
 * `loginCommand` is null until the runner has reported its node volume.
 */
export interface DeskRunnerDto {
  readonly id: string;
  readonly name: string;
  readonly slots: number;
  readonly description?: string | null;
  readonly connected?: boolean;
  readonly connectedSince?: string | null;
  readonly registered?: boolean;
  readonly version?: string | null;
  readonly pinnedVersion?: string | null;
  readonly quarantined?: boolean;
  readonly quarantinedAt?: string | null;
  readonly quarantineReason?: string | null;
  readonly loginState?: DeskRunnerLoginState | null;
  readonly loginCommand?: string | null;
  readonly desks?: readonly DeskRunnerDeskDto[] | null;
  readonly lastSeenAt?: string | null;
  readonly lastHealthCheckAt?: string | null;
  readonly lastHealthCheckOk?: boolean | null;
  readonly health?: DeskRunnerHealthDto | null;
}

/** What queuing an on-demand health check answers: the id the result is read back by. */
export interface RunnerHealthcheckResponse {
  readonly requestId: string;
}

/** One check as `GET …/health` carries it, with whatever structured data that check gathered. */
export interface DeskRunnerHealthCheckDetailDto {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly data?: unknown;
}

/** The full detail `GET /projects/api/runners/{id}/health` answers. */
export interface DeskRunnerHealthDetailDto {
  readonly at: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly requestId?: string;
  readonly checks: readonly DeskRunnerHealthCheckDetailDto[];
}

/** What a runner create takes. Slots are the desks it may hold at once. */
export interface CreateRunnerRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly slots: number;
}

/** What a runner PATCH takes: only the fields that are sent change. */
export interface PatchRunnerRequest {
  readonly slots?: number;
  readonly description?: string | null;
}

/**
 * What a create and a token rotation answer. `registrationToken` and `installLine` are single-use
 * and are never answered again — a page that loses them makes a new one by rotating.
 */
export interface RunnerRegistrationDto {
  readonly runner: DeskRunnerDto;
  readonly registrationToken: string;
  readonly installLine: string;
}

/**
 * The calls this app makes against qits-projects' front-desk runner registry (qits-767), copied
 * from qits-workspaces-frontend's `RunnersApi`.
 *
 * Reads answer anyone who can read projects. Create, PATCH, token rotation and delete take
 * `qits:admin` (or `qits:admin-agent`, `qits:system`); greenlight and login check `qits:admin` or
 * `qits:admin-agent`; the health check is open to `qits:agent` too. The page hides what it knows the
 * viewer cannot press, but the service is the gate: every method rejects with the
 * `HttpErrorResponse`, and a 403 is the caller's to read.
 */
@Injectable({ providedIn: 'root' })
export class RunnersApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * The runner list, a bare array. A 404 reads as no runners: the registry ships after this page,
   * and until it does the route simply is not there.
   */
  async runners(): Promise<readonly DeskRunnerDto[]> {
    try {
      return await firstValueFrom(this.http.get<DeskRunnerDto[]>(`${this.base}${RUNNERS_PATH}`));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /** Register a runner. The answer's token and install line are shown once and never again. */
  async createRunner(request: CreateRunnerRequest): Promise<RunnerRegistrationDto> {
    return firstValueFrom(
      this.http.post<RunnerRegistrationDto>(`${this.base}${RUNNERS_PATH}`, request),
    );
  }

  /** A fresh single-use registration token and install line; 409 once the runner registered. */
  async rotateToken(id: string): Promise<RunnerRegistrationDto> {
    return firstValueFrom(
      this.http.post<RunnerRegistrationDto>(`${this.runner(id)}/registration-token`, {}),
    );
  }

  async patchRunner(id: string, request: PatchRunnerRequest): Promise<DeskRunnerDto> {
    return firstValueFrom(this.http.patch<DeskRunnerDto>(this.runner(id), request));
  }

  /**
   * Delete a runner. Refused with a 409 `{"error":"RUNNER_OWNS_DESKS"}` while any project's desk is
   * placed on it — a desk is sticky to its runner, so the runner cannot go before they do.
   */
  async deleteRunner(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.runner(id)));
  }

  /** Lift a quarantine by hand, without waiting for a health check to pass. */
  async greenlight(id: string): Promise<DeskRunnerDto> {
    return firstValueFrom(this.http.post<DeskRunnerDto>(`${this.runner(id)}/greenlight`, {}));
  }

  /** Ask the runner to run its health check now. Answers 202 with the id the result is read by. */
  async healthCheck(id: string): Promise<RunnerHealthcheckResponse> {
    return firstValueFrom(
      this.http.post<RunnerHealthcheckResponse>(`${this.runner(id)}/healthcheck`, {}),
    );
  }

  /** The last health check's full detail, including each check's own structured data. */
  async health(id: string): Promise<DeskRunnerHealthDetailDto> {
    return firstValueFrom(this.http.get<DeskRunnerHealthDetailDto>(`${this.runner(id)}/health`));
  }

  /** Ask the runner to probe its node's agent login again. The answer arrives with a later poll. */
  async loginCheck(id: string): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.runner(id)}/login-check`, {}));
  }

  private runner(id: string): string {
    return `${this.base}${RUNNERS_PATH}/${encodeURIComponent(id)}`;
  }
}

/** The containers the `nodeInventory` check reports, one per container on the node. */
export interface NodeInventoryContainerDto {
  readonly name: string;
  readonly id: string;
  readonly rowId?: string | null;
  readonly state: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly image: string;
}

/** One volume `nodeInventory` reports. */
export interface NodeInventoryVolumeDto {
  readonly name: string;
  readonly rowId?: string | null;
  readonly createdAt: string | null;
}

/** The runner's own container, as `nodeInventory` reports it. */
export interface NodeInventoryRunnerContainerDto {
  readonly name: string;
  readonly id: string;
  readonly version: string | null;
  readonly startedAt: string | null;
}

/** The `nodeInventory` check's `data` — the node's containers, volumes and the runner's own container. */
export interface NodeInventoryDto {
  readonly containers: readonly NodeInventoryContainerDto[];
  readonly volumes: readonly NodeInventoryVolumeDto[];
  readonly runnerContainer: NodeInventoryRunnerContainerDto | null;
}
