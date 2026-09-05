import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QITS_REPOSITORIES, QITS_SCOPE, QitsAppLinks, QitsBadge } from '@qits/ui-components';
import type { QitsScope } from '@qits/ui-components';
import type {
  ReleaseArtifactDto,
  ReleaseArtifactsResponse,
  ReleaseRequestCommitsResponse,
  ReleaseRequestDto,
} from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { NotFound } from '../not-found/not-found';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelativeTime, shortSha } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { ReleaseConflict } from './release-conflict';
import { releaseArtifactLinks, type ReleaseArtifactLink } from './release-artifact-links';
import {
  RELEASE_REQUESTS_POLL_MS,
  isSettled,
  mergedShaLabel,
  releaseDetail,
  releaseStateBadge,
} from './release-requests-model';
import { ReleaseSources } from './release-sources';

/** One artifact with the addresses this platform can actually spell for it. */
interface DrawnArtifact {
  readonly artifact: ReleaseArtifactDto;
  readonly links: readonly (ReleaseArtifactLink & { readonly href?: string })[];
}

/**
 * One release request, whole.
 *
 * <p><b>Why a page and not a taller row.</b> The two lists answer "what is happening" and are read
 * by scanning; three of the four things somebody wants once they have found their request — what is
 * actually in it, what it published, where the deployment of it got to — are each a request of their
 * own against a different service, and none of them can ride on a list that polls. Splitting them
 * off is what keeps the lists costing one read and lets this page cost four.
 *
 * <p><b>Every read here is asked once per answer that could change it, never once per tick.</b> The
 * request itself is polled while it is unsettled, exactly as the lists poll. The commits are keyed on
 * the fold: they change only when the request re-folds onto a new sha, so a new `mergedSha` is the
 * whole trigger. The artifacts are read once, when the request is RELEASED — before that the service
 * answers an honest "not released yet" and there is nothing to draw.
 *
 * <p><b>The repository is resolved through the chrome</b>, the arm {@code
 * RepositoryReleaseRequestsPage} states at length: the address names a repository by NAME and every
 * API here is keyed by its row id, and the chrome's repository list is the one place that mapping is
 * already in memory. The two alternatives cost a git fetch and a 403 respectively.
 *
 * <p><b>An anchor whose href this platform cannot spell is dropped, never drawn dead.</b> That is the
 * established rule (see `repository-page.ts`): `QitsAppLinks.href` answers `undefined` both for an
 * application the platform serves nowhere and for a navigation tree that has not arrived, and a link
 * to nowhere is worse than a name. The same rule covers a pre-V13 release, whose `releasedSha` is
 * null: the tag link still works from the version and the commit link simply is not there.
 */
@Component({
  selector: 'app-release-request-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, NotFound, QitsBadge, ReleaseConflict, ReleaseSources, RouterLink],
  template: `
    @if (chromeFailed()) {
      <p class="state">
        The platform navigation is unavailable, so this repository cannot be identified.
      </p>
    } @else if (chromePending()) {
      <p class="state">Loading the repositories…</p>
    } @else if (!repoId()) {
      <app-not-found />
    } @else {
      <p class="back">
        <a [routerLink]="['..']">← Release requests</a>
      </p>

      <app-async
        [state]="request()"
        loadingLabel="Loading the release request"
        errorLabel="Could not load the release request"
        (retry)="reload()"
      />

      @if (row(); as request) {
        @let badge = stateBadge(request.state);
        <header class="head">
          <qits-badge [label]="badge.label" [tone]="badge.tone" />
          <h1>{{ request.summary }}</h1>
          @if (watching()) {
            <span class="watching" role="status">Watching for changes…</span>
          }
        </header>

        <app-release-sources [request]="request" />

        <div class="facts">
          <span class="fact">
            folded onto
            <span class="ref">{{ request.backingBranch }}</span>
          </span>
          <span class="fact">
            merged
            <span class="ref" [title]="foldTitle(request)">{{ mergedSha(request) }}</span>
          </span>
          <span class="fact">asked by {{ request.requester || none }}</span>
          <span class="fact" [title]="instant(request.createdAt)">
            asked {{ ago(request.createdAt) }}
          </span>
          <span class="fact" [title]="instant(request.updatedAt)">
            last change {{ ago(request.updatedAt) }}
          </span>
        </div>

        @if (detail(request); as sentence) {
          <p class="detail">{{ sentence }}</p>
        }

        <app-release-conflict [request]="request" />

        @if (request.state === 'RELEASED') {
          <section class="panel released">
            <h2>Released</h2>
            <p class="lead">
              <span class="version">{{ request.version || none }}</span>
              <span class="on-main">{{ mainState(request) }}</span>
            </p>
            <ul class="links">
              @if (tagHref(); as href) {
                <li><a [href]="href">View the tag in Code</a></li>
              }
              @if (releasedCommitHref(); as href) {
                <li>
                  <a [href]="href">
                    The released commit
                    <span class="ref">{{ short(request.releasedSha) }}</span>
                  </a>
                </li>
              }
              @if (deploymentHref(); as href) {
                <li><a [href]="href">The deployment of this release</a></li>
              }
            </ul>
          </section>
        }

        <section class="panel">
          <h2>What this release folds in</h2>
          <app-async
            [state]="commits()"
            loadingLabel="Loading the commits"
            errorLabel="Could not load the commits"
            (retry)="reloadCommits()"
          />
          @if (foldedIn(); as fold) {
            @if (fold.commits.length === 0) {
              <app-empty [message]="fold.detail || 'Nothing was folded in.'" />
            } @else {
              <ul class="commits">
                @for (commit of fold.commits; track commit.hash) {
                  <li class="commit">
                    <span class="ref" [title]="commit.hash">{{ commit.shortHash }}</span>
                    <span class="message">{{ commit.message }}</span>
                    <span class="author">{{ commit.author }}</span>
                    <span class="when" [title]="instant(commit.date)">{{ ago(commit.date) }}</span>
                  </li>
                }
              </ul>
            }
          }
        </section>

        @if (request.state === 'RELEASED') {
          <section class="panel">
            <h2>What it published</h2>
            <app-async
              [state]="artifacts()"
              loadingLabel="Loading the artifacts"
              errorLabel="Could not load the artifacts"
              (retry)="reloadArtifacts()"
            />
            @if (published(); as published) {
              @if (published.detail) {
                <p class="detail">{{ published.detail }}</p>
              }
              @if (drawnArtifacts().length === 0) {
                @if (!published.detail) {
                  <app-empty message="This repository publishes nothing of its own." />
                }
              } @else {
                <ul class="artifacts">
                  @for (drawn of drawnArtifacts(); track drawn.artifact.name) {
                    <li class="artifact">
                      <span class="kind">{{ drawn.artifact.type }}</span>
                      @for (link of drawn.links; track link.label) {
                        @if (link.href) {
                          <a [href]="link.href">{{ link.label }}</a>
                        } @else {
                          <span class="unlinked">{{ link.label }}</span>
                        }
                      }
                      <span class="ref">{{ drawn.artifact.version }}</span>
                    </li>
                  }
                </ul>
              }
            }
          </section>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    h1 {
      flex: 1;
      min-width: 12rem;
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    h2 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .watching {
      font-size: 0.8rem;
      color: #6b7280;
      white-space: nowrap;
    }
    .state {
      margin: 0.15rem 0;
      color: #6b7280;
    }
    .facts {
      display: flex;
      align-items: baseline;
      gap: 0.5rem 0.9rem;
      flex-wrap: wrap;
      margin-top: 0.35rem;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .fact {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25rem;
    }
    .ref {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
    }
    .detail {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #374151;
      overflow-wrap: anywhere;
    }
    .panel {
      margin-top: 0.9rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.4rem;
      background: #fff;
      padding: 0.6rem 0.75rem;
    }
    .released .lead {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin: 0 0 0.35rem;
    }
    .version {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      color: #111827;
    }
    .on-main {
      font-size: 0.8rem;
      font-style: italic;
      color: #6b7280;
    }
    .links,
    .commits,
    .artifacts {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .links a {
      color: #1d4ed8;
    }
    .links a:hover,
    .artifact a:hover {
      text-decoration: underline;
    }
    .commit,
    .artifact {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      font-size: 0.85rem;
    }
    .commit .message {
      flex: 1;
      min-width: 12rem;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .commit .author,
    .commit .when {
      color: #6b7280;
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .artifact .kind {
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      padding: 0.05rem 0.35rem;
      font-size: 0.75rem;
      color: #6b7280;
      background: #f9fafb;
    }
    .artifact a {
      color: #1d4ed8;
      overflow-wrap: anywhere;
    }
    .artifact .unlinked,
    .artifact .ref {
      color: #6b7280;
    }
  `,
})
export class ReleaseRequestDetailPage {
  private readonly api = inject(ReleaseRequestsApi);

  private readonly appLinks = inject(QitsAppLinks);

  /** Optional exactly as the shared layout has it: an application always has one, a spec need not. */
  private readonly source = inject(QITS_REPOSITORIES, { optional: true });

  /** What the address says is on screen — never the route parameters, which is the platform rule. */
  private readonly scope = inject(QITS_SCOPE).scope;

  private readonly params = toSignal(inject(ActivatedRoute).paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly none = NONE;
  protected readonly stateBadge = releaseStateBadge;
  protected readonly detail = releaseDetail;
  protected readonly mergedSha = mergedShaLabel;
  protected readonly ago = (iso: string) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;
  protected readonly short = (sha: string | null) => (sha ? shortSha(sha) : NONE);

  /**
   * The address, with this route's own segments standing in until the scope settles — the same
   * fallback its list does, and for the same reason: the middle segment is a component now, so
   * `parseScope` names no repository until the chrome's list has proved the word.
   */
  private readonly addressed = computed<QitsScope>(() => {
    const scope = this.scope();
    if (scope.repository) {
      return scope;
    }
    const params = this.params();
    return {
      project: params.get('project') ?? scope.project,
      group: params.get('group') ?? undefined,
      repository: params.get('repository') ?? undefined,
    };
  });

  protected readonly repository = computed(() => this.addressed().repository ?? '');

  /** The chrome will never answer — a broken platform, distinct from a name it does not hold. */
  protected readonly chromeFailed = computed(() => this.source?.failed() ?? false);

  /** Still waiting for the one list this page needs to turn a name into an id. */
  protected readonly chromePending = computed(
    () => !!this.source && !this.chromeFailed() && this.source.repositories() === undefined,
  );

  /** The row id every API here is keyed by, or empty for a name this project does not hold. */
  protected readonly repoId = computed(() => {
    const name = this.repository();
    const rows = this.source?.repositories();
    if (!name || !rows) return '';
    return rows.find((row) => row.name === name)?.id ?? '';
  });

  private readonly requestId = computed(() => this.params().get('requestId') ?? '');

  protected readonly request = signal<Loadable<ReleaseRequestDto>>(LOADING);

  protected readonly commits = signal<Loadable<ReleaseRequestCommitsResponse>>(LOADING);

  protected readonly artifacts = signal<Loadable<ReleaseArtifactsResponse>>(LOADING);

  /** The request once there is one — the template's `@if` subject, so waiting draws no panels. */
  protected readonly row = computed(() => {
    const state = this.request();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly foldedIn = computed(() => {
    const state = this.commits();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly published = computed(() => {
    const state = this.artifacts();
    return state.kind === 'ready' ? state.value : null;
  });

  /** Still moving, so the timer is armed. Said out loud, because it costs requests. */
  protected readonly watching = computed(() => {
    const request = this.row();
    return !!request && !isSettled(request);
  });

  /**
   * The released tag, in the code browser. Composed from the VERSION rather than from the sha,
   * because a tag is what a release is — so this link works on a release made before the service
   * recorded the sha at all.
   */
  protected readonly tagHref = computed(() => {
    const version = this.row()?.version;
    return version
      ? this.appLinks.href('qits-githost', `tags/${encodeURIComponent(version)}`, this.addressed())
      : undefined;
  });

  /** The commit the tag points at. Absent on a pre-V13 release, and then simply not drawn. */
  protected readonly releasedCommitHref = computed(() => {
    const sha = this.row()?.releasedSha;
    return sha
      ? this.appLinks.href('qits-githost', `commit/${encodeURIComponent(sha)}`, this.addressed())
      : undefined;
  });

  /**
   * The deployment request this release produced, in qits-deployments — offered **only** where the
   * released tree declares a deployment, because a library has no deployment to look at and a link
   * to one would be a promise this platform cannot keep.
   *
   * <p><b>The scope is the PROJECT alone, and that is not a simplification.</b> qits-deployments
   * serves `deployment-requests/by-release/:repoId/:version` under its bare and its per-project
   * addresses and under no repository-scoped one, so spelling the group and the repository into it
   * would compose a URL that 404s. The repository is already in the path, by id.
   */
  protected readonly deploymentHref = computed(() => {
    const request = this.row();
    const published = this.published();
    if (!request?.version || !published?.deployable) {
      return undefined;
    }
    return this.appLinks.href(
      'qits-deployments',
      `deployment-requests/by-release/${encodeURIComponent(request.repoId)}/` +
        `${encodeURIComponent(request.version)}`,
      { project: this.addressed().project },
    );
  });

  /** Each published artifact with the addresses this platform can spell, and no dead anchors. */
  protected readonly drawnArtifacts = computed<readonly DrawnArtifact[]>(() => {
    const scope = this.addressed();
    return (this.published()?.artifacts ?? []).map((artifact) => ({
      artifact,
      links: releaseArtifactLinks(artifact).map((link) => ({
        ...link,
        // A wire path is served at the application's root; scoping it would address nothing.
        href:
          link.app && link.path
            ? this.appLinks.href(link.app, link.path, link.wire ? undefined : scope)
            : undefined,
      })),
    }));
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Which read is current, so a slow answer for a request left behind is dropped. */
  private reading = '';

  /** The fold the commits on screen are about, so a poll that changed nothing costs no read. */
  private loadedFold: string | null = null;

  /** Whether the artifacts have been asked for, so a settled request asks exactly once. */
  private loadedArtifacts = false;

  protected foldTitle(request: ReleaseRequestDto): string {
    const sha = request.mergedSha;
    return sha
      ? `${sha} — the fold of this request's sources onto ${request.backingBranch}`
      : `Nothing has been folded onto ${request.backingBranch} yet`;
  }

  /** Where a released request stands against `main` — the gap the whole flow is arranged around. */
  protected mainState(request: ReleaseRequestDto): string {
    return request.mergedToMainAt ? 'on main' : 'not on main yet';
  }

  constructor() {
    effect(() => {
      const repoId = this.repoId();
      const requestId = this.requestId();
      untracked(() => {
        this.cancelTimer();
        this.loadedFold = null;
        this.loadedArtifacts = false;
        this.commits.set(LOADING);
        this.artifacts.set(LOADING);
        if (!repoId || !requestId) {
          this.request.set(LOADING);
          return;
        }
        void this.load(repoId, requestId, false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
  }

  protected reload(): void {
    const repoId = this.repoId();
    const requestId = this.requestId();
    if (!repoId || !requestId) return;
    this.cancelTimer();
    void this.load(repoId, requestId, this.row() !== null);
  }

  /** The reader asking again for a fold whose read failed — the same read the answer triggers. */
  protected reloadCommits(): void {
    const request = this.row();
    if (!request) return;
    this.loadedFold = null;
    void this.loadCommits(this.repoId(), request);
  }

  protected reloadArtifacts(): void {
    const request = this.row();
    if (!request) return;
    this.loadedArtifacts = false;
    void this.loadArtifacts(this.repoId(), request);
  }

  /**
   * @param quiet keep whatever is on screen while the read is in flight. Every read but the first is
   *     quiet: a timer tick that blanked the page would make it flicker for as long as the request
   *     was still moving, which is exactly when a reader is looking.
   */
  private async load(repoId: string, requestId: string, quiet: boolean): Promise<void> {
    const key = `${repoId}/${requestId}`;
    this.reading = key;
    if (!quiet) {
      this.request.set(LOADING);
    }
    try {
      const answer = await this.api.get(repoId, requestId);
      if (this.reading !== key) return;
      this.request.set(ready(answer));
      await this.loadCommits(repoId, answer);
      await this.loadArtifacts(repoId, answer);
    } catch (error) {
      if (this.reading !== key) return;
      this.request.set(failed(error));
    } finally {
      if (this.reading === key) {
        this.schedule();
      }
    }
  }

  /**
   * The commits, once per distinct fold. A request with no fold yet is still asked, because the
   * service answers that shape with the sentence that explains it rather than with an error.
   */
  private async loadCommits(repoId: string, request: ReleaseRequestDto): Promise<void> {
    const fold = request.mergedSha ?? '';
    if (this.loadedFold === fold) {
      return;
    }
    this.loadedFold = fold;
    try {
      const answer = await this.api.commits(repoId, request.id);
      if (this.loadedFold !== fold) return;
      this.commits.set(ready(answer));
    } catch (error) {
      if (this.loadedFold !== fold) return;
      this.commits.set(failed(error));
    }
  }

  /** The artifacts, once, and only once the request has released. */
  private async loadArtifacts(repoId: string, request: ReleaseRequestDto): Promise<void> {
    if (this.loadedArtifacts || request.state !== 'RELEASED') {
      return;
    }
    this.loadedArtifacts = true;
    try {
      this.artifacts.set(ready(await this.api.artifacts(repoId, request.id)));
    } catch (error) {
      this.artifacts.set(failed(error));
    }
  }

  /** Arm the next read, but only while the request can still change by itself. */
  private schedule(): void {
    this.cancelTimer();
    if (!this.watching()) return;
    const repoId = this.repoId();
    const requestId = this.requestId();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load(repoId, requestId, true);
    }, RELEASE_REQUESTS_POLL_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
