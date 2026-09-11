import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CommitBuildStatusDto,
  CommitFileDiffDto,
  ListCommitBuildsResponse,
  ReleaseRequestChangesResponse,
  ReleaseArtifactsResponse,
  ReleaseRequestCommitsResponse,
  ReleaseRequestDto,
  ReleaseRequestResponse,
  ReleaseRequestsResponse,
} from './dto';

/**
 * The release-request surface: a repository's asks, a project's, and the verbs a person has over
 * them.
 *
 * <p><b>Read, withdraw, and re-declare what a branch is worth — and nothing else.</b> The other
 * route on that controller is the `POST` that *creates* a request, and it is deliberately absent
 * here: a release is asked for by pushing a branch and calling qits-workspaces' release door, which
 * is what mints the request. A create button on this page would be a second way in that skips the
 * branch the door resolves, so this SPA reads the record, can call one ask off, and can change the
 * priority of a branch already on it — the things a person looking at the list actually needs.
 *
 * <p><b>The derived reads are separate calls on purpose.</b> `commits` reaches the repository's git
 * mirror, `artifacts` reaches the git host and `builds` is addressed by commit rather than by
 * request, so none of them could ride on a list without putting a poll in front of it. The detail
 * page asks for each exactly once per answer that changes it — the commits and the verdicts per
 * distinct fold, the artifacts once a request has released — which is why they are methods of their
 * own rather than one fat read.
 *
 * <p><b>`approve` and `decline` are the second gate, and they are the only two verbs here a machine
 * may not use.</b> Every other route on this surface takes `qits:admin` or `qits:system`; these take
 * `qits:admin` alone, because a machine may ask for a release and call one off and may not sign off
 * the estate. A browser session carries the first, which is the whole reason they are offered in
 * this SPA at all.
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
   * What this request's fold **changed** — the files, against the newest release tag that does not
   * contain the fold.
   *
   * <p>Read once per **fold**, exactly as {@link commits} is and for the same reason: the answer is
   * a fact about the folded commit, so it changes only when the request re-folds onto a new sha. A
   * poll that found the same `mergedSha` must not cost this read — it reaches the service's git
   * mirror and diffs two trees.
   *
   * <p><b>No base travels from here.</b> The service resolves it (the newest release tag not
   * containing the fold, by `merge-base`; the empty tree for a repository that has never released)
   * and names in `baseTag` the tag it used, which is what the page says out loud. A client that
   * could name a base would be a second answer to an arithmetic the service is the authority on.
   *
   * <p>Every empty case is a 200 with an empty list and a sentence, never an error: nothing folded
   * yet, a fold pruned out of history, a fold that changed nothing over the previous release.
   */
  async changes(repoId: string, requestId: string): Promise<ReleaseRequestChangesResponse> {
    return firstValueFrom(
      this.http.get<ReleaseRequestChangesResponse>(
        `${this.requestBase(repoId, requestId)}/changes`,
      ),
    );
  }

  /**
   * The unified diff of one path in that fold, against the same base {@link changes} listed.
   *
   * <p>Keyed on `(mergedSha, path)` by its caller — a second fact about the fold, so a poll costs
   * nothing here either and only opening a different file, or the fold moving under the reader, is
   * a reason to ask again.
   *
   * <p><b>The path rides in the query string</b> because a path holds slashes, which is the same
   * grammar every file address on this platform uses; `HttpParams` encodes it once and the service
   * reads it once.
   *
   * <p>An **empty `diff` is an answer** — binary, a pure rename, or a patch the service declined to
   * send for its size — and the viewer draws the sentence for it rather than an empty pane.
   */
  async fileDiff(repoId: string, requestId: string, path: string): Promise<CommitFileDiffDto> {
    return firstValueFrom(
      this.http.get<CommitFileDiffDto>(`${this.requestBase(repoId, requestId)}/changes/diff`, {
        params: { path },
      }),
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

  /**
   * Every CI verdict recorded for one commit, newest first — what the build gate is actually
   * deciding on, said in qits-ci's own words.
   *
   * <p><b>It is addressed by the COMMIT, not by the request</b>, and that is the service's shape
   * rather than an inconvenience: a verdict is a fact about content, so the same fold answers the
   * same whichever request folded it, and a request whose sources are re-pushed is asking about a
   * different commit rather than about a changed answer. That is exactly why the caller keys the
   * read on the fold and asks once per distinct sha.
   *
   * <p>An **empty list is an answer** — no terminal run has announced this commit — and it is
   * unwrapped to one here so a caller cannot mistake a service build that answers no `builds` field
   * at all for a commit with a verdict it failed to read.
   */
  async builds(repoId: string, sha: string): Promise<readonly CommitBuildStatusDto[]> {
    const response = await firstValueFrom(
      this.http.get<ListCommitBuildsResponse>(
        `${this.base}/projects/api/repositories/${encodeURIComponent(repoId)}/commits/` +
          `${encodeURIComponent(sha)}/builds`,
      ),
    );
    return response.builds ?? [];
  }

  /**
   * Sign this request's current fold off, so it may release — the person's half of the second gate.
   *
   * <p><b>`mergedSha` is required and is the whole point of the call.</b> An approval is a statement
   * about *content*, and a push can land while the page is open, so the fold the reader was looking
   * at travels with the decision and a stale one is refused **409** naming the fold the request is on
   * now. The caller sends the sha it *rendered*, never the sha it holds at the moment of the click:
   * they are the same thing until they are not, and the whole gate is about that difference.
   *
   * <p>The gate is re-asked immediately on the service side, so a fold whose build is already green
   * releases on the click — which is why the answer is the whole request and is worth putting in
   * place of the row rather than following with a re-read.
   *
   * <p>The 409 is not a failure to report as one: a request that has concluded, one with no fold, a
   * repository that needs no approval at all and a fold that moved are all answered with it, and each
   * of them is a sentence the panel draws where it happened rather than a toast.
   */
  async approve(
    repoId: string,
    requestId: string,
    mergedSha: string,
    note?: string,
  ): Promise<ReleaseRequestDto> {
    return this.decide(repoId, requestId, 'approve', mergedSha, note);
  }

  /**
   * Refuse this request's current fold, answerably — the request is `REJECTED` carrying the decider's
   * own sentence as its detail.
   *
   * <p><b>This is not a withdrawal and the two must not be read as degrees of the same thing.</b> A
   * decline judges the *content* and is answered by a new fold: push a fix onto a participating
   * branch, the request re-folds, the decision no longer names the fold it is on, and both gates are
   * open again. A withdrawal judges the *ask*, is terminal, and frees the branches for a fresh
   * request. Same body, same `mergedSha` and the same refusals as {@link approve}.
   */
  async decline(
    repoId: string,
    requestId: string,
    mergedSha: string,
    note?: string,
  ): Promise<ReleaseRequestDto> {
    return this.decide(repoId, requestId, 'decline', mergedSha, note);
  }

  /**
   * The two decisions are one call with one word changed, because the service's two routes are: same
   * body, same envelope, same five refusals. Spelling them separately here would be two places for a
   * field to be forgotten in.
   */
  private async decide(
    repoId: string,
    requestId: string,
    verb: 'approve' | 'decline',
    mergedSha: string,
    note?: string,
  ): Promise<ReleaseRequestDto> {
    const trimmed = note?.trim();
    const response = await firstValueFrom(
      this.http.post<ReleaseRequestResponse>(`${this.requestBase(repoId, requestId)}/${verb}`, {
        mergedSha,
        ...(trimmed ? { note: trimmed } : {}),
      }),
    );
    return response.request;
  }

  private requestBase(repoId: string, requestId: string): string {
    return (
      `${this.base}/projects/api/repositories/${encodeURIComponent(repoId)}/release-requests/` +
      `${encodeURIComponent(requestId)}`
    );
  }

  /**
   * Re-declare what one participating branch is worth. The whole request comes back, with its
   * effective priority — the highest of its branches — already recomputed.
   *
   * <p><b>The branch travels in the body rather than in the path</b>, which is the service's own
   * shape and not a preference: branch names contain slashes, so a path segment would either have to
   * be escaped by both sides in exactly the same way or would address the wrong row.
   *
   * <p>Nothing is re-folded and nothing is announced by this: the fold did not move, so the request
   * is the same release it was — only the signal on it changed.
   *
   * <p>A request already RELEASED or WITHDRAWN answers **409**, exactly as the withdraw does. The
   * control is disabled in those states rather than hidden, and the refusal is still rendered where
   * it happens, because the usual cause is a page that went stale under the reader.
   */
  async setSourcePriority(
    repoId: string,
    requestId: string,
    branch: string,
    priority: string,
  ): Promise<ReleaseRequestDto> {
    const response = await firstValueFrom(
      this.http.post<ReleaseRequestResponse>(
        `${this.requestBase(repoId, requestId)}/sources/priority`,
        { branch, priority },
      ),
    );
    return response.request;
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
