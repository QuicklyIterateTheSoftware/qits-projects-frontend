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
import { RouterLink } from '@angular/router';
import { QITS_REPOSITORIES, QitsBadge, QitsButton } from '@qits/ui-components';
import type { ReleaseRequestDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { ProjectParam } from '../nav/project-param';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelativeTime, shortSha } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import {
  RELEASE_REQUESTS_POLL_MS,
  canWithdraw,
  hasOpenRequests,
  releaseDetail,
  releaseStateBadge,
} from './release-requests-model';

/**
 * Everything waiting to be released anywhere in the project.
 *
 * <p><b>Why this page exists beside the per-repository one.</b> The repository's list answers "why
 * has this branch not landed", and that is a question you ask once you already know where to look.
 * The question people actually arrive with is the other one — is anything here waiting on me — and
 * the sidebar could not answer it: the release-request rows hang under repositories, so finding one
 * open request meant opening each repository in turn and being told "nothing" by almost all of them.
 * One read, one screen, one answer.
 *
 * <p><b>Open only, and that is the service's default rather than a filter here.</b> The route
 * answers PENDING, READY, FAILED and REJECTED when nobody names a state. A project with a year of
 * releases behind it has a year of RELEASED rows, and a worklist that led with them would be a
 * history — the thing this page is *not*. A request that lands therefore leaves the list on the next
 * read, which is the right disappearance: it is no longer waiting on anybody.
 *
 * <p><b>Each row names its repository, and links to it where the chrome can spell the address.</b>
 * The name comes from the service (the DTO carries it, resolved live, so a rename is reflected); the
 * *link* needs the middle segment of `/<project>/<group>/<repository>`, which is the repository's
 * component or its archetype category — and only the chrome's repository list knows that. That list
 * is already fetched to draw the sidebar, so reading it costs nothing, and a repository it does not
 * hold is drawn as plain text rather than as a link to nowhere.
 *
 * <p><b>A person can call an ask off and cannot make one</b>, exactly as one level down: the create
 * route is deliberately not wired up, because a release is asked for by pushing a branch and calling
 * the release door, which mints the request against the head it resolved.
 */
@Component({
  selector: 'app-project-release-requests-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsBadge, QitsButton, RouterLink],
  template: `
    <p class="back">
      <a [routerLink]="['/', projectSlug()]">← {{ heading() }}</a>
    </p>

    <header class="head">
      <h1>Release requests</h1>
      <div class="head-actions">
        @if (watching()) {
          <span class="watching" role="status">Watching for changes…</span>
        }
        <qits-button variant="ghost" size="sm" [busy]="refreshing()" (pressed)="reload()">
          Refresh
        </qits-button>
      </div>
    </header>

    <p class="lead">
      Every release still waiting on something, across all of this project's repositories, most
      recently moved first. A request that lands leaves this list.
    </p>

    <app-async
      [state]="requests()"
      loadingLabel="Loading the release requests"
      errorLabel="Could not load the release requests"
      (retry)="reload()"
    />

    @if (rows(); as rows) {
      @if (rows.length === 0) {
        <app-empty message="Nothing is waiting to be released in this project." />
      } @else {
        <ul class="requests">
          @for (request of rows; track request.id) {
            <li class="request">
              @let badge = stateBadge(request.state);
              <div class="row">
                <qits-badge [label]="badge.label" [tone]="badge.tone" />
                @let where = repositoryLink(request);
                @if (where.route) {
                  <a class="repo" [routerLink]="where.route">{{ where.label }}</a>
                } @else {
                  <span class="repo">{{ where.label }}</span>
                }
                <span class="summary">{{ request.summary }}</span>
                <span
                  class="when"
                  [title]="
                    'Asked ' +
                    instant(request.createdAt) +
                    ' · last change ' +
                    instant(request.updatedAt)
                  "
                >
                  {{ ago(request.updatedAt) }}
                </span>
              </div>

              <div class="facts">
                <span class="ref">{{ request.branch }}</span>
                <span class="ref">{{ sha(request.commitSha) }}</span>
                <span class="by">{{ request.requester || none }}</span>
              </div>

              @if (detail(request); as sentence) {
                <p class="detail">{{ sentence }}</p>
              }

              @if (withdrawable(request)) {
                <div class="withdraw">
                  @if (pending() === request.id) {
                    <input
                      class="reason"
                      type="text"
                      [value]="reason()"
                      (input)="reasonTyped($event)"
                      placeholder="Why (optional)"
                      [attr.aria-label]="'Reason for withdrawing ' + request.summary"
                    />
                  }
                  <qits-button
                    variant="ghost"
                    size="sm"
                    [busy]="inFlight() === request.id"
                    [disabled]="inFlight() !== null"
                    (pressed)="press(request)"
                  >
                    {{ pending() === request.id ? 'Confirm withdraw?' : 'Withdraw' }}
                  </qits-button>
                </div>
              }

              @if (errorFor(request); as message) {
                <p class="failed" role="alert">Could not withdraw this request — {{ message }}.</p>
              }
            </li>
          }
        </ul>
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
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .head-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .watching {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .lead {
      margin: 0.35rem 0 0.75rem;
      font-size: 0.9rem;
      color: #6b7280;
    }
    .requests {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .request {
      border: 1px solid #e5e7eb;
      border-radius: 0.4rem;
      background: #fff;
      padding: 0.6rem 0.75rem;
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .repo {
      font-weight: 600;
      overflow-wrap: anywhere;
      color: #1d4ed8;
    }
    a.repo:hover {
      text-decoration: underline;
    }
    .summary {
      flex: 1;
      min-width: 12rem;
      overflow-wrap: anywhere;
    }
    .when {
      font-size: 0.8rem;
      color: #6b7280;
      white-space: nowrap;
    }
    .facts {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
      font-size: 0.8rem;
      color: #6b7280;
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
    .withdraw {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-top: 0.4rem;
    }
    .reason {
      flex: 1;
      min-width: 10rem;
      max-width: 24rem;
      padding: 0.2rem 0.4rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      font: inherit;
      font-size: 0.85rem;
    }
    .failed {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #b91c1c;
    }
  `,
})
export class ProjectReleaseRequestsPage {
  private readonly api = inject(ReleaseRequestsApi);

  private readonly param = inject(ProjectParam);

  /** Optional exactly as the shared layout has it: an application always has one, a spec need not. */
  private readonly repositories = inject(QITS_REPOSITORIES, { optional: true });

  protected readonly none = NONE;
  protected readonly stateBadge = releaseStateBadge;
  protected readonly detail = releaseDetail;
  protected readonly withdrawable = canWithdraw;
  protected readonly sha = shortSha;
  protected readonly ago = (iso: string) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;

  /** The id the API takes, and the slug every link is spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  /** The project's display name for the way back, once the shared list has answered. */
  protected readonly heading = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value.name : this.param.segment();
  });

  protected readonly requests = signal<Loadable<readonly ReleaseRequestDto[]>>(LOADING);

  /** The list once there is one — the template's `@if` subject, so waiting draws no empty state. */
  protected readonly rows = computed(() => {
    const state = this.requests();
    return state.kind === 'ready' ? state.value : null;
  });

  /** Something is still moving, so the timer is armed. Said out loud, because it costs requests. */
  protected readonly watching = computed(() => {
    const rows = this.rows();
    return !!rows && hasOpenRequests(rows);
  });

  /** A read is in flight that the reader asked for, as opposed to one the timer made. */
  protected readonly refreshing = signal(false);

  /** The request whose Withdraw button has been pressed once and is asking to be pressed again. */
  protected readonly pending = signal<string | null>(null);

  protected readonly reason = signal('');

  protected readonly inFlight = signal<string | null>(null);

  private readonly failure = signal<{ readonly id: string; readonly message: string } | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Which read is current, so a slow answer for a project left behind is dropped. */
  private reading = '';

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      untracked(() => {
        this.cancelTimer();
        this.pending.set(null);
        this.failure.set(null);
        if (!projectId) {
          // The shared project list has not answered yet — or the address names no project, which
          // `ProjectParam` reports as an error the chrome draws. Either way there is nothing to ask.
          this.requests.set(LOADING);
          return;
        }
        void this.load(projectId, false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
  }

  /**
   * Where a row's repository is, as the sidebar spells it: the name from the service, and the route
   * only when the chrome's list can supply the middle segment. A repository the list does not hold —
   * or a list that has not arrived — is a name and no link, never a link that 404s.
   */
  protected repositoryLink(request: ReleaseRequestDto): {
    readonly label: string;
    readonly route: readonly string[] | null;
  } {
    const row = this.repositories?.repositories()?.find((entry) => entry.id === request.repoId);
    const label = request.repoName ?? row?.name ?? request.repoId;
    const group = row?.component ?? row?.category;
    if (!row || !group) {
      return { label, route: null };
    }
    return {
      label,
      route: ['/', this.projectSlug(), group, row.name, 'release-requests'],
    };
  }

  protected errorFor(request: ReleaseRequestDto): string | null {
    const failure = this.failure();
    return failure && failure.id === request.id ? failure.message : null;
  }

  protected reasonTyped(event: Event): void {
    this.reason.set((event.target as HTMLInputElement).value);
  }

  /** The reader asking again — the manual way to the same read the timer makes. */
  protected reload(): void {
    const projectId = this.projectId();
    if (!projectId) return;
    this.cancelTimer();
    this.refreshing.set(true);
    void this.load(projectId, this.rows() !== null);
  }

  /**
   * First press asks, second press sends — the house's confirmation, in the button rather than in a
   * browser dialog the page can neither style nor assert.
   *
   * <p>The withdraw is addressed by the row's own `repoId`, which is why this page can offer the
   * verb at all without knowing anything about the repository: the request carries where it lives.
   */
  protected async press(request: ReleaseRequestDto): Promise<void> {
    if (this.pending() !== request.id) {
      this.pending.set(request.id);
      this.reason.set('');
      this.failure.set(null);
      return;
    }
    const reason = this.reason();
    this.pending.set(null);
    this.inFlight.set(request.id);
    this.failure.set(null);
    try {
      const withdrawn = await this.api.withdraw(request.repoId, request.id, reason);
      this.replace(withdrawn);
    } catch (error) {
      this.failure.set({ id: request.id, message: describeError(error) });
    } finally {
      this.inFlight.set(null);
      this.reason.set('');
    }
  }

  /**
   * The answered row, in place of the one that was there.
   *
   * <p>A withdrawn request is no longer open, so it does not belong on this list — but it is dropped
   * on the next *read* rather than here. Removing the row under the hand that pressed the button
   * would make the page jump and would take away the only place the new state is visible; leaving it
   * shows the answer, and the poll (or a refresh) tidies up.
   */
  private replace(request: ReleaseRequestDto): void {
    const state = this.requests();
    if (state.kind !== 'ready') return;
    this.requests.set(ready(state.value.map((row) => (row.id === request.id ? request : row))));
    this.schedule();
  }

  /**
   * @param quiet keep whatever is on screen while the read is in flight. Every read but the first
   *     for a project is quiet: a timer tick that blanked the list would make the page flicker for
   *     as long as anything on it was still moving, which is exactly when a reader is looking.
   */
  private async load(projectId: string, quiet: boolean): Promise<void> {
    this.reading = projectId;
    if (!quiet) {
      this.requests.set(LOADING);
    }
    try {
      const answer = await this.api.listByProject(projectId);
      if (this.reading !== projectId) return;
      this.requests.set(ready(answer));
    } catch (error) {
      if (this.reading !== projectId) return;
      // A failed poll replaces the list with the failure and stops the timer. Leaving stale rows
      // under a page that says it is watching would be the worst of both: wrong, and quiet.
      this.requests.set(failed(error));
    } finally {
      this.refreshing.set(false);
      if (this.reading === projectId) {
        this.schedule();
      }
    }
  }

  /** Arm the next read, but only while something on screen can still change by itself. */
  private schedule(): void {
    this.cancelTimer();
    if (!this.watching()) return;
    const projectId = this.projectId();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load(projectId, true);
    }, RELEASE_REQUESTS_POLL_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
