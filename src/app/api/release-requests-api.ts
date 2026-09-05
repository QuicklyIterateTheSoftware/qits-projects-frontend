import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  ReleaseArtifactsResponse,
  ReleaseRequestCommitsResponse,
  ReleaseRequestDto,
  ReleaseRequestResponse,
  ReleaseRequestsResponse,
} from './dto';

/**
 * The release-request surface: a repository's asks, a project's, and the one verb a person has over
 * them.
 *
 * <p><b>Read-and-withdraw, and nothing else.</b> The other route on that controller is the
 * `POST` that *creates* a request, and it is deliberately absent here: a release is asked for by
 * pushing a branch and calling qits-workspaces' release door, which is what mints the request. A
 * create button on this page would be a second way in that skips the branch the door resolves, so
 * this SPA reads the record and can call one ask off — the two things a person looking at the list
 * actually needs.
 *
 * <p><b>The two derived reads are separate calls on purpose.</b> `commits` reaches the repository's
 * git mirror and `artifacts` reaches the git host, so neither could ride on a list without putting
 * a poll in front of it. The detail page asks for each exactly once per answer that changes it — the
 * commits per distinct fold, the artifacts once a request has released — which is why they are three
 * methods here rather than one fat read.
 *
 * <p>Every route wants `qits:admin` or `qits:system`; a browser session carries the first, so
 * these are same-origin reads with the platform's forwarded identity and no token of their own.
 */
@Injectable({ providedIn: 'root' })
export class ReleaseRequestsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * One repository's release requests, newest first — the service's order, kept as it arrives.
   *
   * <p><b>The state is left off here too</b>: with none named the route answers the open requests
   * plus the last ten released, which is the page's whole question — what is happening on this
   * repository — and not the history a `state=all` would fetch.
   */
  async list(repoId: string): Promise<readonly ReleaseRequestDto[]> {
    const response = await firstValueFrom(
      this.http.get<ReleaseRequestsResponse>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repoId)}/release-requests`,
      ),
    );
    return response.requests ?? [];
  }

  /**
   * A whole project's release requests, across every repository it owns — most recently moved
   * first, which is the service's order and not this SPA's.
   *
   * <p><b>The state is left off, and that is the call.</b> The route answers the open requests
   * (PENDING, READY, FAILED, REJECTED, CONFLICTED) plus the last ten released when nobody names one,
   * and that is exactly what a project-wide list is for: the question it exists to answer is "is
   * anything here waiting on me — and what has just gone out", and a project with a year of releases
   * behind it would otherwise answer it with a year of history. `state=all` is the route's other
   * half and this SPA has no page that wants it yet.
   */
  async listByProject(projectId: string): Promise<readonly ReleaseRequestDto[]> {
    const response = await firstValueFrom(
      this.http.get<ReleaseRequestsResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/release-requests`,
      ),
    );
    return response.requests ?? [];
  }

  /**
   * One release request by id, which is what the detail page is a view of.
   *
   * <p>Scoped by repository as well as by id because the address is: the page is reached from a
   * repository's list, and a request read through the wrong repository's route is a 404 rather than
   * somebody else's answer.
   */
  async get(repoId: string, requestId: string): Promise<ReleaseRequestDto> {
    const response = await firstValueFrom(
      this.http.get<ReleaseRequestResponse>(`${this.requestBase(repoId, requestId)}`),
    );
    return response.request;
  }

  /**
   * What this request's fold brought in — `mergedSha^1..mergedSha`, the octopus's own range.
   *
   * <p>Read once per **fold** rather than once per poll: the answer changes only when the request
   * re-folds onto a new sha, and this one reaches the service's git mirror.
   */
  async commits(repoId: string, requestId: string): Promise<ReleaseRequestCommitsResponse> {
    return firstValueFrom(
      this.http.get<ReleaseRequestCommitsResponse>(
        `${this.requestBase(repoId, requestId)}/commits`,
      ),
    );
  }

  /**
   * What this release published, and whether anything deploys it — read out of the released tag's
   * own tree, so it is answerable for a release whose CI announced nothing at all.
   *
   * <p>Worth asking only once a request has RELEASED: before that the service answers the honest
   * "not released yet" and the page has nothing to draw from it.
   */
  async artifacts(repoId: string, requestId: string): Promise<ReleaseArtifactsResponse> {
    return firstValueFrom(
      this.http.get<ReleaseArtifactsResponse>(`${this.requestBase(repoId, requestId)}/artifacts`),
    );
  }

  private requestBase(repoId: string, requestId: string): string {
    return (
      `${this.base}/projects/api/repositories/${encodeURIComponent(repoId)}/release-requests/` +
      `${encodeURIComponent(requestId)}`
    );
  }

  /**
   * Call an ask off. The reason is recorded on the request as its `detail`; blank leaves the
   * service to name the caller instead, which is why it is optional rather than sent empty.
   *
   * <p>A request already RELEASED or WITHDRAWN answers **409** — the page renders that sentence
   * rather than hiding it, because the usual cause is a list that has gone stale under the reader
   * and the refusal is the truthful answer to what they pressed.
   */
  async withdraw(repoId: string, requestId: string, reason?: string): Promise<ReleaseRequestDto> {
    const body = reason && reason.trim() ? { reason: reason.trim() } : {};
    const response = await firstValueFrom(
      this.http.post<ReleaseRequestResponse>(
        `${this.requestBase(repoId, requestId)}/withdraw`,
        body,
      ),
    );
    return response.request;
  }
}
