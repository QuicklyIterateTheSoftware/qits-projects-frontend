import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
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

/** One project's components, and the wrapper they are supposed to agree with, from one read. */
export interface ProjectComponents {
  readonly repositories: readonly RepositoryDto[];
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

  /** One repository's main branch against its remote, measured without fetching objects. */
  syncStatus(repositoryId: string): Promise<SyncStatusDto> {
    return firstValueFrom(
      this.http.get<SyncStatusDto>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repositoryId)}/sync-status`,
      ),
    );
  }
}
