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
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { QITS_REPOSITORIES, QITS_SCOPE, QitsBadge, QitsButton } from '@qits/ui-components';
import type { QitsScope } from '@qits/ui-components';
import type { ReleaseRequestDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { NotFound } from '../not-found/not-found';
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
 * One repository's release requests: what has been asked for, what the gates made of it, and what
 * landed.
 *
 * <p><b>The repository is resolved through the chrome, not through a read of this page's own.</b>
 * The address names a repository by NAME and the API is keyed by its row id, so something has to
 * turn one into the other — and `QITS_REPOSITORIES` is the scoped project's repository list, which
 * the shared layout has already fetched to draw the sidebar. Reading it costs nothing. The two
 * alternatives both cost something real: `GET /projects/{id}/repositories` refreshes the wrapper's
 * git mirror (it joins rows to a `.gitmodules` that lives in a repository), which is the one read
 * on this service that must never sit behind a poll; and `…/repositories/by-name/{name}` is
 * `qits:system` alone, so a browser session gets a 403 from it.
 *
 * <p><b>A person can call an ask off and cannot make one.</b> The create route on that controller
 * is deliberately not wired up: a release is asked for by pushing a branch and calling the release
 * door, which mints the request against the head it resolved. A button here would be a second door
 * that skips the first one's whole job.
 */
@Component({
  selector: 'app-repository-release-requests-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, NotFound, QitsBadge, QitsButton],
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
        Every release asked for on {{ repository() }}, newest first. A request is gated on its
        commit's builds and lands by itself when they pass.
      </p>

      <app-async
        [state]="requests()"
        loadingLabel="Loading the release requests"
        errorLabel="Could not load the release requests"
        (retry)="reload()"
      />

      @if (rows(); as rows) {
        @if (rows.length === 0) {
          <app-empty message="Nothing has been asked for on this repository yet." />
        } @else {
          <ul class="requests">
            @for (request of rows; track request.id) {
              <li class="request">
                @let badge = stateBadge(request.state);
                <div class="row">
                  <qits-badge [label]="badge.label" [tone]="badge.tone" />
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
                  @if (request.version; as version) {
                    <span class="ref version">{{ version }}</span>
                  }
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
                  <p class="failed" role="alert">
                    Could not withdraw this request — {{ message }}.
                  </p>
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
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
    .state {
      margin: 0.15rem 0;
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
    .summary {
      flex: 1;
      min-width: 12rem;
      font-weight: 600;
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
    .version {
      color: #111827;
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
export class RepositoryReleaseRequestsPage {
  private readonly api = inject(ReleaseRequestsApi);

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
  protected readonly withdrawable = canWithdraw;
  protected readonly sha = shortSha;
  protected readonly ago = (iso: string) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;

  /**
   * The address, with this route's own segments standing in until the scope settles — the same
   * fallback the repository page carries, and for the same reason: the middle segment is a
   * component now, so `parseScope` names no repository until the chrome's list has proved the word.
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

  /** The row id the API is keyed by, or empty for a name this project does not hold. */
  protected readonly repoId = computed(() => {
    const name = this.repository();
    const rows = this.source?.repositories();
    if (!name || !rows) return '';
    return rows.find((row) => row.name === name)?.id ?? '';
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

  /** Which read is current, so a slow answer for a repository left behind is dropped. */
  private reading = '';

  constructor() {
    effect(() => {
      const repoId = this.repoId();
      untracked(() => {
        this.cancelTimer();
        this.pending.set(null);
        this.failure.set(null);
        if (!repoId) {
          this.requests.set(LOADING);
          return;
        }
        void this.load(repoId, false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
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
    const repoId = this.repoId();
    if (!repoId) return;
    this.cancelTimer();
    this.refreshing.set(true);
    void this.load(repoId, this.rows() !== null);
  }

  /**
   * First press asks, second press sends — the house's confirmation, in the button rather than in a
   * browser dialog the page can neither style nor assert. The reason input appears with the
   * question and not before it, so a list of withdrawable rows is a list and not a form.
   */
  protected async press(request: ReleaseRequestDto): Promise<void> {
    if (this.pending() !== request.id) {
      this.pending.set(request.id);
      this.reason.set('');
      this.failure.set(null);
      return;
    }
    const repoId = this.repoId();
    if (!repoId) return;
    const reason = this.reason();
    this.pending.set(null);
    this.inFlight.set(request.id);
    this.failure.set(null);
    try {
      const withdrawn = await this.api.withdraw(repoId, request.id, reason);
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
   * <p>A re-read would be the other answer and it is the wrong one: the withdraw already replied
   * with the whole request, so asking again would be a second round trip for bytes already held —
   * and it would redraw the list under the reader for a change they made themselves.
   */
  private replace(request: ReleaseRequestDto): void {
    const state = this.requests();
    if (state.kind !== 'ready') return;
    this.requests.set(ready(state.value.map((row) => (row.id === request.id ? request : row))));
    this.schedule();
  }

  /**
   * @param quiet keep whatever is on screen while the read is in flight. Every read but the first
   *     for a repository is quiet: a timer tick that blanked the list would make the page flicker
   *     for as long as anything on it was still moving, which is exactly when a reader is looking.
   */
  private async load(repoId: string, quiet: boolean): Promise<void> {
    this.reading = repoId;
    if (!quiet) {
      this.requests.set(LOADING);
    }
    try {
      const answer = await this.api.list(repoId);
      if (this.reading !== repoId) return;
      this.requests.set(ready(answer));
    } catch (error) {
      if (this.reading !== repoId) return;
      // A failed poll replaces the list with the failure and stops the timer. Leaving stale rows
      // under a page that says it is watching would be the worst of both: wrong, and quiet.
      this.requests.set(failed(error));
    } finally {
      this.refreshing.set(false);
      if (this.reading === repoId) {
        this.schedule();
      }
    }
  }

  /** Arm the next read, but only while something on screen can still change by itself. */
  private schedule(): void {
    this.cancelTimer();
    if (!this.watching()) return;
    const repoId = this.repoId();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load(repoId, true);
    }, RELEASE_REQUESTS_POLL_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
