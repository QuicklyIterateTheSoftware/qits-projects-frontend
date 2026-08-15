import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { QitsBadge, QitsButton, QitsCard } from '@qits/ui-components';
import { ProjectsApi } from '../api/projects-api';
import {
  COMPONENT_TYPES,
  normalizeArchetype,
  type ProjectReconcileResponse,
  type ReconcileEntryDto,
  type RepositoryDto,
  type SyncStatusDto,
  type WrapperDto,
  type WrapperEntryDto,
  type WrapperReconcileResponse,
} from '../api/dto';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';

/** Every placeable archetype, as a set, so "is this a component row?" is one lookup. */
const PLACEABLE = new Set<string>(COMPONENT_TYPES.map((type) => type.archetype));

/** What disagrees between the wrapper's `.gitmodules` and the rows the service holds. */
export interface WrapperDrift {
  /** Submodules committed in the wrapper that no repository row answers to. */
  readonly unclaimed: readonly WrapperEntryDto[];
  /** Component rows the wrapper does not list — members by the row's word only. */
  readonly strays: readonly RepositoryDto[];
}

/**
 * Compare the wrapper against the rows.
 *
 * <p>An entry matches a row by **id first, then by name**, which is the same order the server's
 * reconcile resolves in: `repositoryId` is the answer the server already computed, and the name
 * alias is what a wrapper entry actually spells. Only placeable rows can be strays — the wrapper
 * itself, a fork and a template are deliberately not members and would otherwise be reported as
 * drift on every project, forever.
 */
export function wrapperDrift(
  wrapper: WrapperDto,
  repositories: readonly RepositoryDto[],
): WrapperDrift {
  const byId = new Set(repositories.map((repository) => repository.id));
  const byName = new Set(repositories.map((repository) => repository.name).filter(Boolean));
  const claimed = new Set<string>();

  const unclaimed = wrapper.entries.filter((entry) => {
    const matched =
      (entry.repositoryId !== null && byId.has(entry.repositoryId)) || byName.has(entry.name);
    if (matched) {
      claimed.add(entry.repositoryId ?? '');
      claimed.add(entry.name);
    }
    return !matched;
  });

  const strays = repositories.filter(
    (repository) =>
      PLACEABLE.has(normalizeArchetype(repository.archetype)) &&
      !claimed.has(repository.id) &&
      !claimed.has(repository.name),
  );

  return { unclaimed, strays };
}

/**
 * The **project repository**, and whether the rows below still agree with it.
 *
 * <p>The team calls this repository "the wrapper" in conversation, and the wire still does — the
 * server's `WrapperDto`, `wrapperPath` and `wrapperRepositoryId` are its field names. That is an
 * informal alias, not the domain's word, so it stays in the code and never reaches the screen: a
 * reader who has not sat in those conversations has no way to know what a wrapper wraps.
 *
 * <p><b>This is the project's configuration, so it sits above the components rather than beside
 * them.</b> Its `.gitmodules` is what says which repositories are part of the project; a group that
 * disagrees with it is not a display problem, it is the project being in two minds. The badge says
 * which of the two states the project is in, and the button is the way out of the second.
 *
 * <p>Two reconciles, deliberately kept apart and drawn at different weights. "Reconcile from
 * project repository" rewrites rows — it can create, adopt, re-classify and **deregister** — so it
 * is the primary action and it reports every path it touched. "Re-assert DNS" pushes one record
 * through the domain-registrar port and changes nothing here, so it is a small secondary action;
 * folding the two into one button would make a routine dns nudge also delete rows. (Nothing
 * implements that port since qits-platform-dns left the platform, so it reports FAILED today.)
 */
@Component({
  selector: 'app-project-repository-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsButton, QitsCard],
  template: `
    <qits-card heading="Project repository">
      @if (wrapper(); as wrapper) {
        <div class="head">
          <span class="path"
            >{{ wrapper.repositoryId }} · <code>{{ wrapper.branch }}</code></span
          >
          @if (inSync()) {
            <qits-badge label="in sync" tone="success" />
          } @else {
            <qits-badge label="out of sync" tone="warning" />
          }
        </div>

        <p class="summary">
          {{ wrapper.entries.length }} submodule{{ wrapper.entries.length === 1 ? '' : 's' }} in
          <code>.gitmodules</code>. {{ driftSentence() }}
        </p>

        @if (drift(); as drift) {
          @if (drift.unclaimed.length > 0) {
            <p class="drift">
              Committed but not registered:
              @for (entry of drift.unclaimed; track entry.path) {
                <code>{{ entry.path }}</code>
              }
            </p>
          }
          @if (drift.strays.length > 0) {
            <p class="drift">
              Registered but not committed:
              @for (stray of drift.strays; track stray.id) {
                <code>{{ stray.name || stray.id }}</code>
              }
            </p>
          }
        }

        <p class="remote">{{ remoteSentence() }}</p>

        <div class="actions">
          <qits-button
            variant="primary"
            size="sm"
            [busy]="reconcile().kind === 'loading'"
            (pressed)="runReconcile()"
          >
            Reconcile from project repository
          </qits-button>
          <qits-button
            variant="ghost"
            size="sm"
            [busy]="domain().kind === 'loading'"
            (pressed)="runDomainReconcile()"
          >
            Re-assert DNS
          </qits-button>
        </div>

        @if (reconcile().kind === 'error') {
          <p class="failed" role="alert">Reconcile failed — {{ reconcileMessage() }}.</p>
        }
        @if (reconciled(); as result) {
          <div class="outcomes">
            @if (result.entries.length === 0) {
              <p>Nothing to do — every submodule already matched a repository.</p>
            } @else {
              <ul>
                @for (entry of result.entries; track $index) {
                  <li>
                    <code>{{ entryLabel(entry) }}</code> — {{ entry.outcome }}
                    @if (entry.archetype) {
                      <span class="detail">{{ entry.archetype }}</span>
                    }
                    @if (entry.warning) {
                      <span class="warning">⚠ {{ entry.warning }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        }

        @if (domain().kind === 'error') {
          <p class="failed" role="alert">The dns reconcile failed — {{ domainMessage() }}.</p>
        }
        @if (domainResult(); as result) {
          <p class="domain">
            DNS: {{ result.domain }}
            @if (result.domainDetail) {
              <span class="detail">({{ result.domainDetail }})</span>
            }
          </p>
        }
      } @else {
        <p class="none">
          There is no project repository, so there is no configuration to reconcile against. Adopt
          one to make its <code>.gitmodules</code> the project's membership list.
        </p>
      }
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 1rem;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .path {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .summary,
    .remote,
    .drift,
    .domain,
    .none {
      margin: 0.4rem 0 0;
      font-size: 0.9rem;
      color: #374151;
    }
    .drift code {
      margin-right: 0.4rem;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.6rem;
    }
    .outcomes {
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }
    .outcomes ul {
      margin: 0;
      padding-left: 1.1rem;
    }
    .detail {
      color: #6b7280;
    }
    .warning {
      display: block;
      margin: 0.1rem 0 0.3rem;
      color: #92400e;
    }
    .failed {
      margin: 0.4rem 0 0;
      color: #b91c1c;
      font-size: 0.9rem;
    }
  `,
})
export class ProjectRepositoryStatus {
  private readonly api = inject(ProjectsApi);

  readonly projectId = input.required<string>();
  readonly wrapper = input.required<WrapperDto | null>();
  readonly repositories = input.required<readonly RepositoryDto[]>();

  /** The reconcile rewrote rows, so the caller has to read the list again. */
  readonly changed = output<void>();

  protected readonly reconcile = signal<Loadable<WrapperReconcileResponse>>(IDLE);
  protected readonly domain = signal<Loadable<ProjectReconcileResponse>>(IDLE);
  private readonly sync = signal<Loadable<SyncStatusDto>>(IDLE);

  protected readonly drift = computed(() => {
    const wrapper = this.wrapper();
    return wrapper ? wrapperDrift(wrapper, this.repositories()) : undefined;
  });

  protected readonly inSync = computed(() => {
    const drift = this.drift();
    return !!drift && drift.unclaimed.length === 0 && drift.strays.length === 0;
  });

  protected readonly driftSentence = computed(() => {
    const drift = this.drift();
    if (!drift) {
      return '';
    }
    if (drift.unclaimed.length === 0 && drift.strays.length === 0) {
      return 'Every submodule has a repository, and every component repository is a submodule.';
    }
    return `${drift.unclaimed.length} unregistered, ${drift.strays.length} unlisted.`;
  });

  /**
   * What the wrapper's own main branch looks like against its remote.
   *
   * A probe that never answered says **nothing** rather than claiming the wrapper is behind: a
   * failed measurement and a measured zero are different facts, and the badge above already reports
   * the drift that matters here.
   */
  protected readonly remoteSentence = computed(() => {
    const state = this.sync();
    if (state.kind !== 'ready') {
      return state.kind === 'error' ? 'Its remote could not be measured.' : '';
    }
    const status = state.value;
    if (!status.remoteReachable) {
      return 'Its remote is unreachable.';
    }
    if (!status.remoteExists) {
      return `Its remote has no ${status.branch} branch.`;
    }
    if (status.ahead === null || status.behind === null) {
      return `Its ${status.branch} exists on the remote; the distance was not countable locally.`;
    }
    if (status.ahead === 0 && status.behind === 0) {
      return `Its ${status.branch} matches the remote.`;
    }
    return `Its ${status.branch} is ${status.ahead} ahead and ${status.behind} behind the remote.`;
  });

  protected readonly reconciled = computed(() => {
    const state = this.reconcile();
    return state.kind === 'ready' ? state.value : undefined;
  });

  /**
   * What one line of the report is about, given that a line need not be about a path.
   *
   * A deregistration has no wrapper path — no entry named it, which is the whole reason its row
   * went — so it is reported by the alias it was registered under. The empty-manifest answer has
   * neither, and naming the wrapper is the only true thing left to say about it.
   */
  protected entryLabel(entry: ReconcileEntryDto): string {
    return entry.path ?? entry.name ?? 'this project repository';
  }

  protected readonly domainResult = computed(() => {
    const state = this.domain();
    return state.kind === 'ready' ? state.value : undefined;
  });

  protected readonly reconcileMessage = computed(() => {
    const state = this.reconcile();
    return state.kind === 'error' ? state.message : '';
  });

  protected readonly domainMessage = computed(() => {
    const state = this.domain();
    return state.kind === 'error' ? state.message : '';
  });

  /**
   * The wrapper's identity rather than the wrapper: a re-read hands this component a new object
   * saying the same thing, and everything below keys off the id so it does not react to that.
   */
  private readonly wrapperId = computed(() => this.wrapper()?.repositoryId ?? null);

  constructor() {
    // Both effects follow an *identity*, not the component's lifetime: a project hop swaps the
    // inputs rather than rebuilding this, so a load in the constructor would measure the first
    // project forever.
    effect(() => {
      const wrapperId = this.wrapperId();
      untracked(() => {
        if (wrapperId) {
          void this.loadSync(wrapperId);
        } else {
          this.sync.set(IDLE);
        }
      });
    });

    // A reconcile's report is retired when the *project* changes — not when the component list is
    // merely re-read, because that re-read is the one this panel just asked for and the report is
    // what the reader is looking at while it lands.
    effect(() => {
      this.projectId();
      untracked(() => {
        this.reconcile.set(IDLE);
        this.domain.set(IDLE);
      });
    });
  }

  private async loadSync(repositoryId: string): Promise<void> {
    this.sync.set(LOADING);
    try {
      this.sync.set(ready(await this.api.syncStatus(repositoryId)));
    } catch (error) {
      this.sync.set(failed(error));
    }
  }

  protected async runReconcile(): Promise<void> {
    this.reconcile.set(LOADING);
    try {
      this.reconcile.set(ready(await this.api.reconcileRepositories(this.projectId())));
      this.changed.emit();
    } catch (error) {
      this.reconcile.set(failed(error));
    }
  }

  protected async runDomainReconcile(): Promise<void> {
    this.domain.set(LOADING);
    try {
      this.domain.set(ready(await this.api.reconcileDomain(this.projectId())));
    } catch (error) {
      this.domain.set(failed(error));
    }
  }
}
