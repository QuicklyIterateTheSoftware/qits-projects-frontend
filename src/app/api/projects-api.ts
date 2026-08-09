import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  BackupSyncResponse,
  CreateRepositoryRequest,
  CreateRepositoryResponse,
  EpicDto,
  EpicEntriesResponse,
  EpicStatus,
  EpicTransitionResponse,
  FeatureDto,
  FeatureEntriesResponse,
  ProjectDto,
  ProjectEntriesResponse,
  ProjectReconcileResponse,
  RepositoryDto,
  RepositoryEntriesResponse,
  SyncStatusDto,
  TaskDto,
  TaskEntriesResponse,
  WrapperDto,
  WrapperReconcileResponse,
} from './dto';

/** One project's components, and the wrapper they are supposed to agree with, from one read. */
export interface ProjectComponents {
  readonly repositories: readonly RepositoryDto[];
  readonly wrapper: WrapperDto | null;
}

interface EpicResponse {
  readonly epic: EpicDto;
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
   * Make the rows match the wrapper: adopt, clone, re-classify, deregister.
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

  /** Re-assert the project's stored dns record against qits-dns. A failure is still a 200. */
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
   * One project's epics.
   *
   * The three levels of the plan are three reads, one per level, because that is what the service
   * offers — there is no nested answer. The caller fans out and assembles the tree.
   */
  async epics(projectId: string): Promise<readonly EpicDto[]> {
    const response = await firstValueFrom(
      this.http.get<EpicEntriesResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/epics`,
      ),
    );
    return response.entries.map((entry) => entry.epic);
  }

  /** Replace a refining epic's human-authored Markdown spine. */
  async updateEpic(epicId: string, title: string, description: string): Promise<EpicDto> {
    const response = await firstValueFrom(
      this.http.put<EpicResponse>(`${this.base}/projects/api/epics/${encodeURIComponent(epicId)}`, {
        title,
        description,
      }),
    );
    return response.epic;
  }

  /**
   * Move one epic to another point in its life: freeze a draft, supersede it, abandon it.
   *
   * The whole answer is kept, successor and all, rather than reduced to the epic — superseding
   * spawns a draft, and a caller that dropped it would have no way to say what replaced what. An
   * illegal move is a 409 whose `message` says why, which is a sentence for the reader rather than
   * a state this client should have prevented.
   *
   * The server's answer is not spliced into the tree: a transition can change more than the one
   * row, so the caller re-reads instead.
   */
  transitionEpic(epicId: string, target: EpicStatus): Promise<EpicTransitionResponse> {
    return firstValueFrom(
      this.http.post<EpicTransitionResponse>(
        `${this.base}/projects/api/epics/${encodeURIComponent(epicId)}/transition`,
        { target },
      ),
    );
  }

  /** One epic's features. */
  async features(epicId: string): Promise<readonly FeatureDto[]> {
    const response = await firstValueFrom(
      this.http.get<FeatureEntriesResponse>(
        `${this.base}/projects/api/epics/${encodeURIComponent(epicId)}/features`,
      ),
    );
    return response.entries.map((entry) => entry.feature);
  }

  /** One feature's tasks. */
  async tasks(featureId: string): Promise<readonly TaskDto[]> {
    const response = await firstValueFrom(
      this.http.get<TaskEntriesResponse>(
        `${this.base}/projects/api/features/${encodeURIComponent(featureId)}/tasks`,
      ),
    );
    return response.entries.map((entry) => entry.task);
  }

  /** One repository's main branch against its remote, measured without fetching objects. */
  syncStatus(repositoryId: string): Promise<SyncStatusDto> {
    return firstValueFrom(
      this.http.get<SyncStatusDto>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repositoryId)}/sync-status`,
      ),
    );
  }
}
