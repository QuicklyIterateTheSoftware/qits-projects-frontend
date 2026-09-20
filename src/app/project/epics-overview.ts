import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import type { EpicAgentDispatchDto } from '../api/dto';
import { EntitiesApi } from '../api/entities-api';
import { ProjectEvents } from '../api/project-events';
import { ProjectsApi } from '../api/projects-api';
import { RefiningService } from '../refining/refining-service';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { EntityActions } from './entity-actions';
import { EntityCard } from './entity-card';
import { EntitySummaryRow } from './entity-summary-row';
import { EntityTransitionPanel } from './entity-transition-panel';
import {
  actionKey,
  entityAnchor,
  entityTitles,
  groupEpics,
  type Entity,
  type EntityAction,
  type EpicEntity,
} from './entities-model';

/** Which entity an action is running against, and which of its buttons it is. */
interface InFlight {
  readonly id: string;
  /**
   * The action's {@link actionKey} — a status for a transition, `refine` for the refining workspace,
   * `start` for the press that freezes the scope and dispatches an implementing agent.
   */
  readonly key: string;
}

/** Why the last transition on one epic did not happen, kept beside the epic it is about. */
interface Failure {
  readonly id: string;
  readonly message: string;
}

/**
 * The epics a project is being changed by, grouped by where each one stands.
 *
 * <p><b>A view over the project's entities, filtered to one archetype.</b> It reads the same
 * {@link EntitiesApi} the tickets desk reads, holds the same {@link Entity} type, and draws the same
 * card, row and action components — what makes it the *epics* desk is the archetype it asks for and
 * the sections {@link groupEpics} splits the answer into. It used to be half of a parallel pair of
 * models; the pair is gone and what is left is a filter.
 *
 * <p><b>One fetch, not one per entity.</b> The archetype is passed to the read, so this desk asks for
 * the epics and pays for exactly the epics — the fan-out over features and tasks that an epic's tree
 * needs, and nothing of the tickets desk's. A unified collection that fetched everything everywhere
 * would have made both desks pay for both, which is the failure worth naming out loud.
 *
 * <p><b>One state for the whole fan-out.</b> The service answers the three levels of a plan
 * separately, so a full tree is one read plus one per epic plus one per feature — but a card holding
 * a feature whose tasks are still in flight is a card that says an epic is smaller than it is. So the
 * panel waits for all of it and shows one loading state, and a failure anywhere is a failure of the
 * panel with one retry, rather than a page of half-drawn cards each offering its own.
 *
 * <p>The read is keyed on the project id in an effect, because the sub-navigation re-uses this
 * instance across a project hop. **A late answer is dropped** rather than rendered: the fan-out is
 * several round trips deep, so a hop can easily land while an older tree is still assembling, and
 * the last response to arrive is not the one the route is on.
 *
 * <p><b>Grouped from the one read, never from `?status=`.</b> The filter exists on the server, but
 * asking it five times would be five moments, and one of the five groups cannot be asked for at all
 * — done is a shape of the tree rather than a value on the row.
 *
 * <p><b>Two sections are always there, three appear only when they hold something.</b> Refining and
 * implementation are the work, so an empty one is a fact worth stating; done, superseded and
 * abandoned are the record, so they open collapsed with their count and stay out of the way of a
 * project that has none.
 *
 * <p>A transition re-reads the whole tree rather than splicing the answer in: superseding creates a
 * second epic, and a panel that patched one row would show a draft that is not there.
 *
 * <p><b>Start implementation is a third kind of press, and the panel remembers what it answered.</b>
 * It goes to one door that freezes the scope *and* stands a workspace with a coding agent up on the
 * wrapper's `epic/<slug>` branch, so it moves the epic (the tree is re-read) and produces an address
 * in another application (which is drawn beside the card). That memory is only the fast path: each
 * epic carries the **live workspaces implementing it**, derived by the service on every read, so a
 * reload and a second tab both show the way in and neither offers a second agent. What the in-memory
 * copy buys is the seconds between the press and the re-read.
 *
 * <p><b>One of a draft's buttons is not a transition.</b> Refine starts (or re-enters) a workspace on
 * the wrapper's `refining/<slug>` branch and navigates to it, leaving the epic exactly where it was.
 * It shares this panel's busy state and its error pinning — a project with no wrapper, a git host that
 * refused the ref and a workspaces service that is down all land beside the card, because in every one
 * of them the screen is still correct and only the workspace is missing — and it shares nothing else.
 *
 * <p><b>It listens as well as reads.</b> A refinement agent — or another tab — changes these epics
 * without this page doing anything, so the project's live channel hints and the panel re-reads. The
 * hint carries nothing, which is the point: there is no pushed shape to reconcile against a tree
 * this deep.
 *
 * <p><b>A hint's refresh is quiet.</b> Only an arrival, a project hop and the retry show the loading
 * state; a hint swaps the tree underneath the reader when it lands. Blanking the panel on every hint
 * would make the page flash for as long as an agent kept typing, and it would be dishonest — what is
 * on screen is a moment old, not unknown. For the same reason a quiet re-read that *fails* leaves
 * the tree standing: the next hint corrects it, and one bad round trip should not take the plan off
 * the screen.
 */
@Component({
  selector: 'app-epics-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, EntityActions, EntityCard, EntitySummaryRow, EntityTransitionPanel],
  template: `
    @if (behind()) {
      <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
    }

    <app-async
      [state]="epics()"
      loadingLabel="Loading the epics"
      errorLabel="Could not load the epics"
      (retry)="load()"
    />

    @if (loaded()) {
      @if (entities().length === 0) {
        <app-empty message="This project has no epics yet." />
      } @else {
        <section class="group">
          <h3>Refining</h3>
          @if (groups().refining.length === 0) {
            <app-empty message="No epic is being drafted." />
          } @else {
            <div class="cards">
              @for (entity of groups().refining; track entity.id) {
                <div class="entry" [id]="anchor(entity)">
                  <app-entity-card [entity]="entity" />
                  <app-entity-actions
                    [entity]="entity"
                    [disabled]="inFlight() !== null"
                    [running]="running(entity)"
                    [error]="error(entity)"
                    [dispatch]="dispatch(entity)"
                    (chosen)="choose(entity, $event)"
                  />
                  @if (reshaping() === entity.id) {
                    <app-entity-transition-panel
                      [projectId]="projectId()"
                      [entityId]="entity.id"
                      (done)="reshaped()"
                      (cancelled)="reshaping.set(null)"
                    />
                  }
                </div>
              }
            </div>
          }
        </section>

        <section class="group">
          <h3>Implementation</h3>
          @if (groups().implementation.length === 0) {
            <app-empty message="No epic is being implemented." />
          } @else {
            <div class="cards">
              @for (entity of groups().implementation; track entity.id) {
                <div class="entry" [id]="anchor(entity)">
                  <app-entity-card [entity]="entity" />
                  <app-entity-actions
                    [entity]="entity"
                    [disabled]="inFlight() !== null"
                    [running]="running(entity)"
                    [error]="error(entity)"
                    [dispatch]="dispatch(entity)"
                    (chosen)="choose(entity, $event)"
                  />
                  @if (reshaping() === entity.id) {
                    <app-entity-transition-panel
                      [projectId]="projectId()"
                      [entityId]="entity.id"
                      (done)="reshaped()"
                      (cancelled)="reshaping.set(null)"
                    />
                  }
                </div>
              }
            </div>
          }
        </section>

        @if (groups().done.length > 0) {
          <details class="group">
            <summary>Done ({{ groups().done.length }})</summary>
            <div class="cards">
              @for (entity of groups().done; track entity.id) {
                <div class="entry" [id]="anchor(entity)">
                  <app-entity-card [entity]="entity" />
                  <app-entity-actions
                    [entity]="entity"
                    [disabled]="inFlight() !== null"
                    [running]="running(entity)"
                    [error]="error(entity)"
                    [dispatch]="dispatch(entity)"
                    (chosen)="choose(entity, $event)"
                  />
                  @if (reshaping() === entity.id) {
                    <app-entity-transition-panel
                      [projectId]="projectId()"
                      [entityId]="entity.id"
                      (done)="reshaped()"
                      (cancelled)="reshaping.set(null)"
                    />
                  }
                </div>
              }
            </div>
          </details>
        }

        @if (groups().superseded.length > 0) {
          <details class="group">
            <summary>Superseded ({{ groups().superseded.length }})</summary>
            <div class="rows">
              @for (entity of groups().superseded; track entity.id) {
                <app-entity-summary-row
                  [entity]="entity"
                  [successorTitle]="successorTitle(entity)"
                />
              }
            </div>
          </details>
        }

        @if (groups().abandoned.length > 0) {
          <details class="group">
            <summary>Abandoned ({{ groups().abandoned.length }})</summary>
            <div class="rows">
              @for (entity of groups().abandoned; track entity.id) {
                <app-entity-summary-row [entity]="entity" />
              }
            </div>
          </details>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    /* The channel marker is the panel's own line, above every group: it is about the whole tree
       rather than about one of the sections. There is no heading of its own to hang it on any more
       — the epics page names this panel, and a second "Epics" here would only repeat it. */
    .behind {
      margin: 0 0 0.5rem;
      color: #6b7280;
      font-size: 0.8rem;
      font-style: italic;
    }
    h3 {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .group {
      margin-top: 1rem;
    }
    summary {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    details .cards,
    details .rows {
      margin-top: 0.5rem;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
  `,
})
export class EpicsOverview {
  private readonly api = inject(EntitiesApi);
  private readonly projects = inject(ProjectsApi);
  private readonly events = inject(ProjectEvents);
  private readonly refining = inject(RefiningService);
  private readonly router = inject(Router);

  readonly projectId = input.required<string>();

  /**
   * The project's slug — what a link out of this overview is spelled with, since the URL grammar
   * names projects by slug and only the API resolves ids.
   *
   * Optional, falling back to the id, so a caller that has not resolved the slug yet still
   * produces a working address: this application redirects an id in the first segment to the slug.
   */
  readonly projectSlug = input<string>('');

  protected readonly epics = signal<Loadable<readonly Entity[]>>(LOADING);

  protected readonly inFlight = signal<InFlight | null>(null);

  protected readonly failure = signal<Failure | null>(null);

  /**
   * Which epic has its reshape form open, or null — one at a time, keyed by id.
   *
   * <p><b>It is not the busy state and deliberately not part of it.</b> Opening the form makes no
   * request and moves nothing, so the other cards' buttons stay live: a reader who opened the wrong
   * one presses Cancel rather than finding the desk frozen. The panel below owns everything about the
   * write, and this desk learns no transition rule at all — it holds an id and re-reads when it is
   * told the write landed.
   */
  protected readonly reshaping = signal<string | null>(null);

  /**
   * Where a "Start implementation" sent an agent, by epic id — the only record there is, and it
   * lives no longer than this component. See the class note on why nothing re-reads it.
   */
  private readonly dispatches = signal<ReadonlyMap<string, EpicAgentDispatchDto>>(new Map());

  protected readonly loaded = computed(() => this.epics().kind === 'ready');

  protected readonly entities = computed<readonly Entity[]>(() => {
    const state = this.epics();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly groups = computed(() => groupEpics(this.entities()));

  private readonly titles = computed(() => entityTitles(this.entities()));

  /** Whether the channel has ever been up. Nothing is "behind" before it has ever been current. */
  private readonly wasLive = signal(false);

  /**
   * Whether to say the panel is lagging. It stays quiet on a page that never had a channel at all —
   * an SSE endpoint an older service does not serve is not a reader's problem.
   */
  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  /** Which project the last run of the read effect was for, so a hop is told apart from a hint. */
  private watching: string | null = null;

  /** The hint count that run had seen. The number itself means nothing; only its movement does. */
  private hinted = 0;

  /** How many reads have started. A read that is no longer the newest is dropped when it lands. */
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const hints = this.events.invalidations('epics')();
      if (!projectId) {
        return;
      }
      // Arrival and a project hop show the loading state. A hint on the project already on screen
      // never does — that is the whole difference between the two ways this effect runs.
      const quiet = projectId === this.watching && hints !== this.hinted;
      this.watching = projectId;
      this.hinted = hints;
      untracked(() => {
        this.events.connect(projectId);
        void this.load(projectId, quiet);
      });
    });

    effect(() => {
      if (this.events.connected()) {
        this.wasLive.set(true);
      }
    });

    inject(DestroyRef).onDestroy(() => this.events.close());
  }

  protected anchor(entity: Entity): string {
    return entityAnchor(entity.archetype, entity.id);
  }

  protected running(entity: Entity): string | null {
    const flight = this.inFlight();
    return flight?.id === entity.id ? flight.key : null;
  }

  protected error(entity: Entity): string | null {
    const failure = this.failure();
    return failure?.id === entity.id ? failure.message : null;
  }

  /**
   * What this epic's last successful start answered, or null.
   *
   * It is offered to every card and not only to the drafts, because the press *moves* the epic: by
   * the time the tree has been re-read the card the link belongs to is in the implementation
   * section, and pinning the link to the refining section would make it vanish at the exact moment
   * it became useful.
   */
  protected dispatch(entity: Entity): EpicAgentDispatchDto | null {
    return this.dispatches().get(entity.id) ?? null;
  }

  /** The successor's title when this list holds it; null draws no link — see the row component. */
  protected successorTitle(entity: EpicEntity): string | null {
    const id = entity.supersededByEpicId;
    return id ? (this.titles().get(id) ?? null) : null;
  }

  /**
   * Do what the button asked for — one of three quite different things, told apart by the action's
   * own discriminant rather than by reading a status.
   *
   * The three share the busy state and the error-pinning and nothing else: a transition moves the epic
   * and re-reads the tree, refining leaves the epic exactly where it was and navigates away, and
   * starting implementation moves the epic *and* stands a workspace up somewhere else.
   */
  protected async choose(entity: EpicEntity, action: EntityAction): Promise<void> {
    const id = entity.id;
    if (action.kind === 'reshape') {
      // It opens a form and sends nothing, so it takes no busy state and clears no failure.
      this.reshaping.set(id);
      return;
    }
    this.inFlight.set({ id, key: actionKey(action) });
    this.failure.set(null);
    try {
      if (action.kind === 'refine') {
        await this.refine(entity);
      } else if (action.kind === 'start') {
        await this.start(entity);
      } else if (action.kind === 'transition') {
        await this.projects.transitionEpic(id, action.target);
        await this.load();
      }
    } catch (error) {
      this.failure.set({ id, message: describeError(error) });
    } finally {
      this.inFlight.set(null);
    }
  }

  /**
   * A reshape landed: close the form and read the project again.
   *
   * <p>A full re-read rather than a splice, for a stronger version of the transition's reason. One
   * request can promote a feature to an epic and re-shape the tasks under it, so what changed is the
   * *shape of the tree* and not a row's status — there is no patch a panel could apply that would be
   * anything other than a second, worse implementation of the read it is about to do anyway.
   */
  protected reshaped(): void {
    this.reshaping.set(null);
    void this.load();
  }

  /**
   * Freeze this epic's scope and put an implementing agent on it, then keep where it went.
   *
   * <p><b>The tree is re-read, which is the difference from {@link refine}.</b> That press leaves the
   * epic `REFINING` and re-reading would confirm a tree nothing changed; this one genuinely moved the
   * row — `REFINING` to `IMPLEMENTATION` — so the card has to leave the Refining section and appear
   * under Implementation, and a panel that skipped the read would go on drawing a draft the service
   * no longer has. The door fires the project's `epics` hint as well, but the redraw must not depend
   * on a live channel being up: the reader pressed this button and is looking at its result.
   *
   * <p>The answer is remembered *before* the read, so the link is drawn against whichever section the
   * card lands in.
   */
  private async start(entity: EpicEntity): Promise<void> {
    const id = entity.id;
    const dispatch = await this.projects.dispatchEpicAgent(id);
    this.dispatches.update((known) => new Map(known).set(id, dispatch));
    await this.load();
  }

  /**
   * Open this epic's refining workspace, starting one if there is none, then go to it.
   *
   * <p><b>The tree is not re-read afterwards, because nothing about it changed.</b> The epic is
   * `REFINING` before the press and `REFINING` after it — what the press produced is a branch and a
   * container in another service — so re-reading would be several round trips confirming a tree the
   * page is about to leave anyway. That is the difference from a transition, and it is why the two
   * share only the busy state and the failure.
   */
  private async refine(entity: EpicEntity): Promise<void> {
    await this.refining.open(entity);
    await this.router.navigate([
      this.projectSlug() || this.projectId(),
      'epics',
      entity.slug,
      'refining',
    ]);
  }

  /**
   * Read the project's epics.
   *
   * A loud read blanks what is on screen first — arrival, a project hop, a retry, a transition. A
   * quiet one leaves the tree up and swaps it when the new one arrives, and leaves it up when the
   * new one does not: a hint's refresh that failed means the panel is a moment old, which is what it
   * already was, so taking the plan off the screen would report a problem by causing a worse one.
   */
  protected async load(projectId = this.projectId(), quiet = false): Promise<void> {
    if (!quiet) {
      this.epics.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const tree = await this.api.list(projectId, 'EPIC');
      if (this.newest(projectId, attempt)) {
        this.epics.set(ready(tree));
      }
    } catch (error) {
      if (this.newest(projectId, attempt) && !(quiet && this.loaded())) {
        this.epics.set(failed(error));
      }
    }
  }

  /**
   * Whether an answer that has just landed is still the one the panel is waiting for.
   *
   * Two ways it is not. The project may have moved on — the fan-out is several round trips deep, so
   * a hop lands easily while an older tree is still assembling. Or a newer read may have started for
   * the *same* project: hints arrive while an agent works, and an older tree overwriting a newer one
   * would put the panel a step behind and keep it there until the next hint.
   */
  private newest(projectId: string, attempt: number): boolean {
    return attempt === this.attempt && projectId === this.projectId();
  }
}
