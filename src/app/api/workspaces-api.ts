import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  ActiveProcessResponse,
  BootstrapRunDto,
  BootstrapRunsResponse,
  ContainerProcessResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  DiscardResponse,
  IntegrateResponse,
  MergeRequest,
  ReleaseResponse,
  ServiceEventDto,
  ServiceEventsResponse,
  WorkspaceDto,
  WorkspaceEntriesResponse,
  WorkspaceHistoryDetailDto,
  WorkspaceHistoryDetailResponse,
  WorkspaceResponse,
} from './workspaces-dto';

/**
 * One page of the service-event feed. Twenty rather than the service's default fifty, because the
 * feed is a recent-history strip and not a log viewer.
 */
export const SERVICE_EVENT_PAGE_SIZE = 20;

/**
 * The calls this app makes against **qits-workspaces**, copied from qits-spa-workspaces.
 *
 * <p><b>The browser is the integrator, and that is the whole design.</b> qits-projects does not call
 * qits-workspaces and must not start: the service arrow runs one way, workspaces → projects. So the
 * page that refines an epic reaches qits-workspaces from here, same-origin through the gateway,
 * exactly as the speech surface reaches `/stt/api`. Nothing on the server side changed to make the
 * refining workspace possible.
 *
 * <p>Release and integrate are **two processes, not one call with a flag**, and this client says so
 * with two methods against two routes. Release is the door into the default branch and stamps a
 * version; integrate merges a workspace into its parent and stamps nothing. Their answers differ in
 * the field that matters, so folding them together would produce a response type whose most useful
 * field is optional for no reason a reader could see.
 *
 * <p>`HttpClient` on the fetch backend rather than bare `fetch()`, for the same two reasons
 * {@link ./projects-api#ProjectsApi} gives: `HttpTestingController` is the only request-mocking story
 * Angular ships, and `withFetch()` routes through `window.fetch`, which is what the platform's OTel
 * browser instrumentation hooks.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacesApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * One repository's live workspaces.
   *
   * `repositoryId` is a **required** filter and is sent as a query parameter rather than a path
   * segment on purpose: qits-workspaces does not own repositories — it holds the id as a string, with
   * no foreign key and no join, in a different database — so a workspace is not a sub-resource of
   * one. The repository is scope on the collection, which is what it actually is.
   *
   * The service answers only ACTIVE workspaces here; resolved ones live in its history view. That is
   * what makes this read the whole of "does this epic have a refining workspace": an active workspace
   * on `refining/<slug>` is the answer, and its absence is the other answer.
   */
  async workspaces(repositoryId: string): Promise<readonly WorkspaceDto[]> {
    const params = new HttpParams().set('repositoryId', repositoryId);
    const response = await firstValueFrom(
      this.http.get<WorkspaceEntriesResponse>(`${this.base}/workspaces/api/workspaces`, { params }),
    );
    return response.entries.map((entry) => entry.workspace);
  }

  /**
   * Create a workspace — and with `adoptExisting: false`, **create its branch too**.
   *
   * `repositoryId` is in the body and not in the query string, which is the one thing about this
   * route worth remembering: the listing above scopes by a query parameter, the create does not. The
   * service reads the field from the payload and answers 400 without it.
   *
   * Rejects with the `HttpErrorResponse`. The two 409s a caller has to tell apart are both prose: a
   * branch that already exists (retry with `adoptExisting: true`) and a branch that already has an
   * active workspace (re-read the list and use the one that is there).
   */
  async createWorkspace(request: CreateWorkspaceRequest): Promise<WorkspaceDto> {
    const response = await firstValueFrom(
      this.http.post<CreateWorkspaceResponse>(`${this.base}/workspaces/api/workspaces`, request),
    );
    return response.workspace;
  }

  /**
   * Release one workspace: merge its branch into the repository's default branch, stamped with a
   * fresh version, as one commit that is then pushed.
   *
   * **Not idempotent, by design** — each call stamps a new version from the clock, because two
   * releases are two releases. So this is called once per press and never automatically re-issued;
   * every retry on this screen is a person pressing a button again.
   */
  async release(workspaceId: number, summary: string): Promise<ReleaseResponse> {
    const body: MergeRequest = { summary };
    return firstValueFrom(
      this.http.post<ReleaseResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/release`,
        body,
      ),
    );
  }

  /**
   * Integrate one workspace: merge its branch into its **parent** branch and push. No version is
   * stamped and nothing is released.
   *
   * The target is not sent, for the same reason the release target is not: the parent is the
   * service's own fact about the workspace. A workspace whose parent *is* the default branch is
   * refused here with a 409 pointing at {@link release}.
   */
  async integrate(workspaceId: number, summary: string): Promise<IntegrateResponse> {
    const body: MergeRequest = { summary };
    return firstValueFrom(
      this.http.post<IntegrateResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/integrate`,
        body,
      ),
    );
  }

  /**
   * One workspace, by the id every route addresses.
   *
   * Nothing on the refining shell calls this: the shell needs the repository-scoped list regardless —
   * it is what resolves the branch to a row — so reading one workspace on top of it would be a second
   * request for data already in hand.
   */
  async workspace(workspaceId: number): Promise<WorkspaceDto> {
    const response = await firstValueFrom(
      this.http.get<WorkspaceResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}`,
      ),
    );
    return response.workspace;
  }

  /**
   * The technical process running against this workspace, or null.
   *
   * This is the Starting tab's discovery lookup. It is asked again whenever the `process` hint fires,
   * which is how a container start begun from another screen still opens the tab here.
   */
  async activeProcess(workspaceId: number): Promise<string | null> {
    const response = await firstValueFrom(
      this.http.get<ActiveProcessResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/active-process`,
      ),
    );
    return response.technicalProcessId;
  }

  /** Start the container if it is not up. Answers the process that is doing it. */
  async ensureContainer(workspaceId: number): Promise<ContainerProcessResponse> {
    return firstValueFrom(
      this.http.post<ContainerProcessResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/ensure-container`,
        {},
      ),
    );
  }

  /** Stop the container. The branch is untouched: the container is a cache of it. */
  async stopContainer(workspaceId: number): Promise<WorkspaceDto> {
    return firstValueFrom(
      this.http.post<WorkspaceDto>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/stop-container`,
        {},
      ),
    );
  }

  /**
   * Throw the container away and build a fresh one.
   *
   * **The service refuses this with a 400 unless the working tree is provably clean**, because a
   * recreate discards whatever is only in the container. So the button that calls it is disabled with
   * the reason whenever `clean` is not exactly `true` — and "unknown", which is what a disconnected
   * daemon reports, counts as not clean.
   */
  async recreateContainer(workspaceId: number): Promise<ContainerProcessResponse> {
    return firstValueFrom(
      this.http.post<ContainerProcessResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/recreate-container`,
        {},
      ),
    );
  }

  /**
   * Abandon the work: the workspace resolves, unmerged, with an optional markdown note saying why.
   *
   * The note is the whole record of what was tried — after this call the container, persistent volume
   * and branch are gone, the workspace leaves the active list, and only its history record remains.
   * For a refining workspace that makes the epic's Refine button create a fresh branch and workspace.
   */
  async discard(workspaceId: number, result: string): Promise<DiscardResponse> {
    return firstValueFrom(
      this.http.post<DiscardResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/discard`,
        { result },
      ),
    );
  }

  /**
   * One page of the durable service-event feed, newest first.
   *
   * **The server filters by the workspace *label*, and that is the trap this method exists to name.**
   * `service_event.workspace_id` is the branch-derived string — unique only among ACTIVE workspaces
   * and reusable the moment one resolves — so a workspace that inherits a retired name is served its
   * predecessor's events by a filter behaving exactly as documented. There is no row-id parameter to
   * ask for instead, so the caller keeps only the rows whose `workspaceRowId` is this workspace's.
   */
  async serviceEvents(
    repositoryId: string,
    workspaceLabel: string,
  ): Promise<readonly ServiceEventDto[]> {
    const params = new HttpParams()
      .set('repoId', repositoryId)
      .set('workspaceId', workspaceLabel)
      .set('pageSize', SERVICE_EVENT_PAGE_SIZE);
    const response = await firstValueFrom(
      this.http.get<ServiceEventsResponse>(`${this.base}/workspaces/api/service-events`, {
        params,
      }),
    );
    return response.events ?? [];
  }

  /**
   * When each of this workspace's bootstrap steps last ran, and how it went.
   *
   * **Host-owned state, and not a forwarder.** The run *verbs* are the daemon's; this reads a host
   * table that has to outlive the container. Empty rather than 404 when the chain has never run here.
   */
  async bootstrapRuns(workspaceId: number): Promise<readonly BootstrapRunDto[]> {
    const response = await firstValueFrom(
      this.http.get<BootstrapRunsResponse>(
        `${this.base}/workspaces/api/workspaces/${encodeURIComponent(workspaceId)}/bootstrap-runs`,
      ),
    );
    return response.runs ?? [];
  }

  /**
   * A workspace's history record — the narrative, for a workspace that has already resolved.
   *
   * It carries no branch state, no runtime and no commands, which is precisely why a resolved
   * workspace does not get a refining page: the refining page offers to start a new one instead.
   */
  async history(workspaceId: number): Promise<WorkspaceHistoryDetailDto> {
    const response = await firstValueFrom(
      this.http.get<WorkspaceHistoryDetailResponse>(
        `${this.base}/workspaces/api/history/${encodeURIComponent(workspaceId)}`,
      ),
    );
    return response.workspace;
  }
}
