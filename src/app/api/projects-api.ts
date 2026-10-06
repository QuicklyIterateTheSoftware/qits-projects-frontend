import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  BackupSyncResponse,
  CreateRepositoryRequest,
  CreateRepositoryResponse,
  ProjectDto,
  ProjectEntriesResponse,
  ProjectReconcileResponse,
  RepositoryDto,
  RepositoryEntriesResponse,
  SyncStatusDto,
  WrapperDto,
  WrapperReconcileResponse,
} from './dto';
import type { WorkChildrenResponse, WorkEntityDto, WorkListResponse } from './work';

/**
 * One project's components, and the wrapper they are supposed to agree with, from one read.
 *
 * `undeclared` holds the ids of the rows no wrapper entry names — the server's own answer, kept as
 * a set beside the rows rather than folded into them, so `RepositoryDto` stays what the service
 * sends and every reader that does not care about membership is untouched.
 */
export interface ProjectComponents {
  readonly repositories: readonly RepositoryDto[];
  readonly undeclared: ReadonlySet<string>;
  readonly wrapper: WrapperDto | null;
}

/**
 * Everything this app asks qits-projects for.
 *
 * `HttpClient` on the fetch backend rather than bare `fetch()`, for the two reasons qits-spa-ci
 * gives: `HttpTestingController` is the only request-mocking story Angular ships and these pages'
 * specs are mostly "given this response, render that", and `withFetch()` routes through
 * `window.fetch`, which is what the platform's OTel browser instrumentation hooks. The observable
 * is unwrapped with `firstValueFrom` immediately — these are one-shot reads and writes, and a
 * promise is what the pages want.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Every project. One request, and what the sub-navigation's picker is built from. */
  async projects(): Promise<readonly ProjectDto[]> {
    const response = await firstValueFrom(
      this.http.get<ProjectEntriesResponse>(`${this.base}/projects/api/projects`),
    );
    return response.entries.map((entry) => entry.project);
  }

  /**
   * One project's repositories **and** its wrapper's `.gitmodules`, in a single read.
   *
   * The two arrive together on purpose: drift is the difference between them, so a page that
   * fetched them separately could draw an in-sync badge from two answers taken at different
   * moments. `wrapper` is null for a project with no wrapper repository at all.
   */
  async components(projectId: string): Promise<ProjectComponents> {
    const response = await firstValueFrom(
      this.http.get<RepositoryEntriesResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/repositories`,
      ),
    );
    return {
      repositories: response.entries.map((entry) => entry.repository),
      undeclared: new Set(
        response.entries.filter((entry) => !entry.declared).map((entry) => entry.repository.id),
      ),
      wrapper: response.wrapper ?? null,
    };
  }

  /**
   * Add a repository to a project: blank on the platform git host, or an existing one by url.
   *
   * The server writes the submodule into the wrapper and pushes it, so this returns only once the
   * project's configuration says the repository is a member. That is why the caller re-reads the
   * list afterwards rather than splicing the answer into it.
   */
  createRepository(
    projectId: string,
    request: CreateRepositoryRequest,
  ): Promise<CreateRepositoryResponse> {
    return firstValueFrom(
      this.http.post<CreateRepositoryResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/repositories`,
        request,
      ),
    );
  }

  /**
   * Make the rows match the wrapper: adopt, clone, re-classify, report the undeclared.
   *
   * Distinct from {@link reconcileDomain} and deliberately a different path — one reconciles the
   * project's components against its own configuration, the other re-asserts a dns record.
   */
  reconcileRepositories(projectId: string): Promise<WrapperReconcileResponse> {
    return firstValueFrom(
      this.http.post<WrapperReconcileResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/repositories/reconcile`,
        null,
      ),
    );
  }

  /**
   * Re-assert the project's stored dns record through the domain-registrar port. A failure is
   * still a 200. Nothing implements the port since qits-platform-dns left the platform, so this
   * currently answers FAILED with a no-registrar detail.
   */
  reconcileDomain(projectId: string): Promise<ProjectReconcileResponse> {
    return firstValueFrom(
      this.http.post<ProjectReconcileResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/reconcile`,
        null,
      ),
    );
  }

  /**
   * Ask the platform to push every repository in this project to its backup remote.
   *
   * **202, not 200.** The answer says how many were scheduled and nothing about how they went,
   * because none of them has gone yet — so a caller cannot await an outcome and must not pretend
   * to. Re-reading the list a moment later is the honest follow-up, and it is what the page does.
   */
  syncBackups(projectId: string): Promise<BackupSyncResponse> {
    return firstValueFrom(
      this.http.post<BackupSyncResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/repositories/backup-sync`,
        null,
      ),
    );
  }

  /**
   * One project's work, every archetype, as the service's flat tree: each root oldest first, its
   * descendants depth-first in position order — `GET /projects/{project}/work`.
   *
   * <p>Unfiltered on purpose: one request answers what used to be a read per archetype plus a
   * fan-out per epic, and the desks filter the answer by archetype themselves. The rows are the
   * listing's summary — no `description`, no acceptance criteria; {@link workItem} has those.
   */
  async work(projectId: string): Promise<readonly WorkEntityDto[]> {
    const response = await firstValueFrom(
      this.http.get<WorkListResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/work`,
      ),
    );
    return response.entities ?? [];
  }

  /** One entity of any archetype, whole — `GET /work/{q}`. `ref` is a qualified id (or a UUID). */
  workItem(ref: string): Promise<WorkEntityDto> {
    return firstValueFrom(this.http.get<WorkEntityDto>(this.workPath(ref)));
  }

  /**
   * File a new entity of any archetype — `POST /work`, 201. A root names its `project`, a node its
   * `parent`; the rest of the body is the archetype's create schema. It starts `REPORTED`.
   */
  createWork(body: Readonly<Record<string, unknown>>): Promise<WorkEntityDto> {
    return firstValueFrom(this.http.post<WorkEntityDto>(`${this.base}/projects/api/work`, body));
  }

  /**
   * Delete an entity and its subtree — `DELETE /work/{q}`. The `success` body adds nothing a 200
   * has not said, so it is dropped; callers re-read.
   */
  async deleteWork(ref: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.workPath(ref)));
  }

  /**
   * Move one entity one step along its lifecycle — **the lifecycle door, for every archetype**:
   * `POST /work/{q}/status`. It runs what a step means (adjacency, the quality gates, the
   * implemented stamping, the phase advance after it), where the multi-entity transition is a
   * restatement of a row's shape that runs none of it.
   *
   * <p>`SUPERSEDED` on an epic is the supersede *operation*: the epic lands `DROPPED`, and the
   * answer's `supersededBy` names the successor draft it spawned. An illegal move is a 409 whose
   * `message` says why.
   *
   * <p>The answer is not spliced into a tree: a move can change more than the one row (an epic's
   * pieces follow it on some moves), so callers re-read.
   */
  setStatus(ref: string, target: string): Promise<WorkEntityDto> {
    return firstValueFrom(
      this.http.post<WorkEntityDto>(`${this.workPath(ref)}/status`, { target }),
    );
  }

  /** An epic's features, or a feature's tasks, in order — `GET /work/{q}/children`, bodies included. */
  async children(ref: string): Promise<readonly WorkEntityDto[]> {
    const response = await firstValueFrom(
      this.http.get<WorkChildrenResponse>(`${this.workPath(ref)}/children`),
    );
    return response.children ?? [];
  }

  /**
   * Delete a repository: the row **and** the repository on the git host, both gone.
   *
   * <p>This is the way out of the one state the reconcile now only reports — a row no wrapper entry
   * names. It is the reader's decision because the two cures are opposite: put the entry back in
   * the wrapper, or delete the repository. Only somebody who knows why the entry left can choose.
   *
   * <p>The answer's body says `success`, which adds nothing a 200 has not already said, so it is
   * dropped. The caller re-reads the list instead of splicing the row out, for the same reason
   * creation does: the server's list is the truth about membership and this client's is a copy.
   */
  async deleteRepository(repositoryId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<unknown>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repositoryId)}`,
      ),
    );
  }

  /** One repository's main branch against its remote, measured without fetching objects. */
  syncStatus(repositoryId: string): Promise<SyncStatusDto> {
    return firstValueFrom(
      this.http.get<SyncStatusDto>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repositoryId)}/sync-status`,
      ),
    );
  }

  private workPath(ref: string): string {
    return `${this.base}/projects/api/work/${encodeURIComponent(ref)}`;
  }
}
