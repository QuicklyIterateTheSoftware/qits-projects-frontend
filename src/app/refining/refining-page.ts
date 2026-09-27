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
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import { ArchetypesApi, type ArchetypeRegistry } from '../api/archetypes-api';
import { DesignsApi } from '../api/designs-api';
import { epicDossier, ticketDossier, type DossierOwner } from '../api/dossier-api';
import { EntitiesApi } from '../api/entities-api';
import { WorkspaceDaemonApi } from '../api/workspace-daemon-api';
import { WorkspaceEvents, anyOf } from '../api/workspace-events';
import { ProjectsApi } from '../api/projects-api';
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import { ProjectParam } from '../nav/project-param';
import {
  lifecycleMoves,
  lifecycleOf,
  refiningBranch,
  statusBadge,
  type LifecycleMove,
} from '../project/entities-model';
import {
  archetypeLabel,
  entityRoute,
  nodeById,
  parseEntityNumber,
  refinePrompt,
  refinementRoute,
  type EntityNode,
} from '../project/entity-nodes';
import { restatement, subjectsOf } from '../project/entity-transition-model';
import { Async } from '../ui/async';
import {
  IDLE,
  LOADING,
  describeError,
  failed,
  ready,
  statusOf,
  type Loadable,
} from '../ui/loadable';
import { ActivityBar } from './activity-bar';
import { AgentActivityMemory } from './agent-activity-memory';
import { AgentsPanel } from './agents/agents-panel';
import { ChatPanel } from './chat/chat-panel';
import { PickedContext } from './chat/picked-context';
import { DesignPanel } from './design/design-panel';
import { DesignSelection } from './design/design-selection';
import { DossierPanel } from './dossier/dossier-panel';
import type { WebViewFreeze } from './design/freeze';
import {
  EpicDocument,
  insertImageAt,
  type EpicImageInsertion,
  type EpicSelection,
} from './epic-document';
import { FilesPanel } from './files/files-panel';
import { PanelPlaceholder } from './panel-placeholder';
import { RefiningService } from './refining-service';
import { SketchPanel } from './sketch/sketch-panel';
import { SketchSelection } from './sketch/sketch-selection';
import { StartingPanel } from './starting/starting-panel';
import type { ProcessOutcome } from './starting/process-log';
import { StatusStrip } from './status-strip';
import { TabHost } from './tabs/tab-host';
import { TabPanel } from './tabs/tab-panel';
import { DEFAULT_TAB, DURABLE_TABS, STARTING_SLUG, isDurableTab, type TabDef } from './tabs/tabs';
import { WebViewPanel } from './web-view/web-view-panel';

/**
 * How long the transient tab stays after its operation finishes.
 *
 * Without it a fast container start flashes a tab nobody gets to read, and the final state — which is
 * the whole reason to look — is the part that vanishes fastest.
 */
export const LINGER_MS = 5000;

/**
 * What each durable tab says while its panel is still to come.
 *
 * Empty now that every tab has one. Kept, because {@link RefiningPage.panelNote} is what a tab added
 * ahead of its panel falls back to, and a placeholder that names the surface is a better screen than
 * an empty box.
 */
const PANEL_NOTES: Readonly<Record<string, string>> = {};

/**
 * Whether a state draws something of its own — which, for the two this shell hands to `app-async`,
 * means loading or failed. Ready and idle draw nothing there, by that component's own contract, and
 * that contract is what {@link RefiningPage.silent} is asking about.
 */
function speaking(state: Loadable<unknown>): boolean {
  return state.kind === 'loading' || state.kind === 'error';
}

/** What the page had to resolve before it could show anything: the entity, and its neighbours. */
interface Subject {
  /** The epic or ticket this room refines — what the header names and the room is matched by. */
  readonly node: EntityNode;
  /** The project's nodes, so a peer room in the activity bar can be addressed by its number. */
  readonly nodes: readonly EntityNode[];
  /** The served registry — what the moves are drawn from, and the walk the first word is read off. */
  readonly registry: ArchetypeRegistry;
}

/**
 * The room you sit in while an agent refines an epic or a ticket.
 *
 * ## What it is
 *
 * A refinement is a qits-projects row and a container on the project's **wrapper** repository, on
 * `refining/<slug>`. This page is its detail UI — copied from qits-spa-workspaces, which is this
 * codebase's sanctioned way to share a screen — with one difference that shapes the whole file: **the
 * URL does not name the room.**
 *
 * ## Resolution, and why the URL is what it is
 *
 * `:project/work/:number/refinement` names the *entity* — the entity's page plus `refinement` — and
 * the room is looked up from it (qits-397; it used to be `:project/epics/:epicSlug/refining`, which
 * still redirects here). Nothing about a room belongs in an address: a URL carrying a room's row id
 * would rot the moment the room is discarded and a new one opened, while the entity's number is
 * stable for its whole life. Both archetypes with a lifecycle have a room since qits-395.
 *
 * Three reads resolve it:
 *
 * 1. The project's entities (epics with their trees, and tickets) — the number is looked up in them,
 *    because there is no read by number; see `project/entity-nodes.ts`.
 * 2. The served archetype registry — the words the subject's archetype may hold, which is what the
 *    room's lifecycle steps are drawn from.
 * 3. `GET /projects/api/projects/{id}/refinements` — the project's rooms, of which the one whose
 *    `entityId` is the subject's is this page's; the rest are the activity bar's peers.
 *
 * Then `GET …/{id}/active-process` for the transient tab, and the room's hint channel.
 *
 * **Nothing here polls.** The channel is what replaced that, and an idle room produces no traffic.
 *
 * ## No workspace is a state, not an error
 *
 * A discard resolves the workspace and leaves the `refining/<slug>` ref behind, so an epic that was
 * being refined yesterday resolves to nothing today. That is not a broken page: it is an offer to start
 * again, made with the same find-or-create flow the epic card uses, which adopts the existing branch.
 * Rendering a 404 there would ask the reader to go back to the epics list and press a button that does
 * exactly this.
 *
 * ## Nothing on the screen is never a state
 *
 * The shell used to have three branches — the tab host, the offer, and no `@else` — so every moment
 * that was none of them drew an empty content area. That is the one screen a reader cannot tell from
 * a page that failed to load, and it was reachable on the ordinary path: the refinements signal was
 * seeded `idle`, and idle draws nothing anywhere. A freshly created refinement is where it stopped
 * being a flicker, because {@link loadRefinements} used to hold the whole listing back until the
 * single-row drift read had answered, and that read refreshes the wrapper's git mirror — cold
 * exactly when the branch it is asked about was cut a second ago.
 *
 * Both halves are now closed by construction: every state of the two reads draws something (the
 * `app-async` bars, the tab host, the offer), and {@link silent} catches whatever is left with a
 * branch of its own. The rule is worth keeping when this file grows: **there is no fourth way to
 * render nothing.**
 *
 * ## The URL's tab
 *
 * **The tab is a query parameter and not a trailing path segment.** A trailing segment gets
 * tab-switch-without-remount for free, and gets *epic*-switch-without-remount too, which is a bug: the
 * page would keep showing the previous epic's workspace. `?tab=` removes the question, keeps every tab
 * a shareable link, and makes a bare URL mean "no tab pinned" by simple absence rather than by a slug
 * someone has to strip. An unknown slug is normalised away back to the bare URL; a bare URL is never
 * helpfully filled in.
 *
 * An *epic* change is still a path change under one route config, so Angular reuses this component —
 * hence {@link mounted}, which is the one place that reuse is worth fighting.
 */
@Component({
  selector: 'app-refining-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActivityBar,
    AgentsPanel,
    Async,
    ChatPanel,
    DesignPanel,
    DossierPanel,
    EpicDocument,
    FilesPanel,
    PanelPlaceholder,
    QitsBadge,
    QitsButton,
    RouterLink,
    SketchPanel,
    StartingPanel,
    StatusStrip,
    TabHost,
    TabPanel,
    WebViewPanel,
  ],
  templateUrl: './refining-page.html',
  styleUrl: './refining-page.css',
})
export class RefiningPage {
  private readonly refining = inject(RefiningService);
  private readonly refinementsApi = inject(RefinementsApi);
  private readonly entitiesApi = inject(EntitiesApi);
  private readonly archetypes = inject(ArchetypesApi);
  private readonly daemon = inject(WorkspaceDaemonApi);
  private readonly events = inject(WorkspaceEvents);
  private readonly memory = inject(AgentActivityMemory);
  private readonly router = inject(Router);
  private readonly picked = inject(PickedContext);
  private readonly projects = inject(ProjectsApi);
  private readonly designs = inject(DesignsApi);
  private readonly designSelection = inject(DesignSelection);
  private readonly sketchSelection = inject(SketchSelection);
  private readonly route = inject(ActivatedRoute);
  private readonly param = inject(ProjectParam);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * The project, from the address's first segment: the id for every request, the slug for every
   * link. Both come from {@link ProjectParam}, which is also what corrects an old address spelling
   * the id.
   */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;
  /** The address's own segment: the entity's qualified number, `qits-1337` (or the bare `1337`). */
  protected readonly entityParam = computed(() => this.params().get('number') ?? '');
  protected readonly entityNumber = computed(() => parseEntityNumber(this.entityParam()));

  /**
   * The branch this room is on: the room row's own once there is one, and until then the
   * `refining/<slug>` the service would cut — which is only ever drawn, never matched against.
   */
  protected readonly branch = computed(
    () => this.workspace()?.branch ?? refiningBranch(this.resolved()?.node.slug ?? ''),
  );

  protected readonly subject = signal<Loadable<Subject>>(LOADING);

  /**
   * The wrapper's refinements — **LOADING from the first frame.**
   *
   * `idle` means "nobody asked", and on the ordinary path nobody ever does not ask: the
   * constructor's effect issues the listing before anything can be painted. Seeding it idle
   * described a state that does not exist there, and the template paid for the lie — neither the tab
   * host (which wants a matched row) nor the offer (which wants a *settled* absence) draws on idle,
   * so the whole first round trip was a blank content area with no spinner and no banner to explain
   * it. Idle remains reachable and remains meant: {@link loadRefinements} sets it for an address
   * that names no project, which is the one case where nothing was asked for.
   */
  protected readonly workspaces = signal<Loadable<readonly RefinementDto[]>>(LOADING);

  /** The create offer's own state, so a failure to start one is reported where it was asked for. */
  protected readonly starting = signal(false);
  protected readonly startFailure = signal<string | null>(null);

  /** Why the last Freeze did not become a design. Shown on the Web view tab, where it was pressed. */
  protected readonly freezeFailure = signal<string | null>(null);
  protected readonly autoStartFailure = signal<string | null>(null);
  private autoContainerRoute: string | null = null;
  private autoContainerWorkspaceId = 0;

  /**
   * The remount guard.
   *
   * Angular reuses a component when only a path parameter changes, which is right for a tab and wrong
   * for an epic: the page reads its identity into a dozen signals and a live channel, and a reused
   * instance would keep the previous entity's everything. So a change of the number sets this false, and
   * a microtask later sets it true — one frame with the subtree gone is what actually destroys it.
   */
  protected readonly mounted = signal(true);
  private mountedFor: string | null = null;

  /**
   * How many times the guard has fired. Public because a spec is its only reader, and because the
   * thing worth asserting — a *tab* change reuses and an *epic* change does not — is invisible from the
   * DOM once the microtask has been and gone.
   */
  readonly remounts = signal(0);

  /** The process the transient tab is showing, which outlives the process itself by {@link LINGER_MS}. */
  protected readonly shownProcessId = signal<string | null>(null);
  private linger: ReturnType<typeof setTimeout> | null = null;
  private autoSelected: string | null = null;
  /** A failed setup stays open until its workspace starts another operation or this page is left. */
  private retainFailedProcess = false;

  /** Whether the transient tab currently holds the selection. Never written to the URL. */
  private readonly transient = signal(false);

  /**
   * The same moves offered on a refining epic in the project overview, minus Refine and minus
   * Reshape.
   *
   * <p>Refine is excluded and the filter says so directly, rather than keeping only the transitions:
   * this page **is** the refining workspace, so offering to open it would be a button that goes where
   * the reader already is. Start implementation stopped being a transition on 2026-09-08 without
   * stopping being an ending, and a keep-the-transitions filter would have dropped it here silently.
   *
   * <p>Reshape is excluded for a different reason, and it is about this room rather than about the
   * press. Reshaping is a claim on the *project's tree* — it needs every epic, feature, task and
   * ticket in the project as a candidate pool, because a promotion is only meaningful next to what it
   * could sit under. This room holds one epic and nothing else, so the form would open with a parent
   * picker that could offer nothing, and the reader would be told it was impossible when it is merely
   * elsewhere. The two desks are where the whole project is on screen, and that is where the press
   * lives. Named in the filter rather than folded into a "keep only the endings" rule, for exactly
   * the reason above: a rule about which kinds end a refinement would drop the next new kind by
   * accident, where a named exclusion has to be thought about.
   */
  /** The entity this room is about, once it has resolved. */
  protected readonly node = computed<EntityNode | null>(() => this.resolved()?.node ?? null);

  /** `Epic` or `Ticket` — what the header and the first tab call the subject. */
  protected readonly subjectLabel = computed(() => {
    const label = archetypeLabel(this.node()?.archetype ?? 'entity');
    return label.charAt(0).toUpperCase() + label.slice(1);
  });

  protected readonly statusBadge = computed(() => statusBadge(this.node()?.status ?? null));

  /** A ticket's impetus — the reporter's words, which a ticket's refinement answers. */
  protected readonly impetus = computed(() => {
    const entity = this.node()?.entity;
    return entity?.archetype === 'TICKET' ? entity.impetus : null;
  });

  /**
   * The lifecycle steps the room offers — the same derivation the entity's page uses, so "Mark
   * refined" here and there is one rule. They go through the archetype's lifecycle door and then
   * back to the entity's page, because a moved entity is one the room may no longer be for.
   */
  protected readonly moves = computed<readonly LifecycleMove[]>(() => {
    const subject = this.resolved();
    return subject
      ? lifecycleMoves(subject.registry, subject.node.archetype, subject.node.status)
      : [];
  });
  protected readonly resolutionPending = signal<string | null>(null);
  protected readonly resolutionFailure = signal<string | null>(null);

  /** Which entity the subject on hand was resolved for, so a hop is told from a hint. */
  private resolvedFor: string | null = null;

  /**
   * How many refinement reads have started. A read that is no longer the newest is dropped when it
   * lands — see {@link loadRefinements}, which writes twice and must not let an older listing's
   * second write overtake a newer listing's first.
   */
  private attempt = 0;

  /**
   * What makes the workspace row stale: its agent activity, its cleanliness and its container's
   * lifecycle.
   */
  private readonly workspaceHints = anyOf(this.events, 'agent-activity', 'git-status', 'process');
  private readonly processHints = this.events.invalidations('process');

  constructor() {
    // Every load is driven off the URL and never off a click, which is what makes a deep link, the
    // back button and a press behave identically.
    effect(() => {
      const key = `${this.projectId()}/${this.entityParam()}`;
      if (key !== this.resolvedFor) {
        this.resolvedFor = key;
        untracked(() => void this.loadSubject());
      }
    });

    effect(() => {
      const projectId = this.projectId();
      // An entity hop re-reads the listing too: the page's own row comes out of it, and a reused
      // component would otherwise keep matching against the previous entity's read.
      this.entityParam();
      this.workspaceHints();
      untracked(() => void this.loadRefinements(projectId));
    });

    effect(() => {
      const workspaceId = this.workspaceRowId();
      this.processHints();
      untracked(() => void this.loadActiveProcess(workspaceId));
    });

    effect(() => {
      const workspaceId = this.workspaceRowId();
      if (workspaceId > 0) {
        this.events.open(workspaceId);
      }
    });

    // Entering a refining route makes its in-container tools usable without a separate Start press.
    // The route key resets the one-shot guard when Angular reuses this component for another epic;
    // workspace hints do not, so a deliberate Stop is not immediately undone by the next refresh.
    effect(() => {
      const routeKey = `${this.projectId()}/${this.entityParam()}`;
      if (routeKey !== this.autoContainerRoute) {
        this.autoContainerRoute = routeKey;
        this.autoContainerWorkspaceId = 0;
        this.autoStartFailure.set(null);
      }
      const subject = this.resolved();
      const belongsToRoute =
        subject?.node.projectId === this.projectId() &&
        subject.node.number === this.entityNumber();
      const workspace = belongsToRoute ? this.workspace() : null;
      if (!workspace || this.autoContainerWorkspaceId === workspace.id) return;
      this.autoContainerWorkspaceId = workspace.id;
      if (workspace.runtimeStatus === 'RUNNING' || workspace.runtimeStatus === 'PROVISIONING')
        return;
      untracked(() => void this.startContainerOnEntry(workspace.id));
    });

    effect(() => this.guardRemount(this.entityParam()));

    // A slug nobody recognises is normalised away rather than obeyed — and rather than being left in
    // the URL looking like it meant something.
    effect(() => {
      const slug = this.query().get('tab');
      if (slug !== null && !isDurableTab(slug)) {
        untracked(() =>
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          }),
        );
      }
    });

    // A process that has just appeared takes the selection. Once per process, so someone who moved to
    // another tab is not dragged back by the next frame of the same log.
    effect(() => {
      const processId = this.shownProcessId();
      if (processId && processId !== this.autoSelected) {
        this.autoSelected = processId;
        untracked(() => this.transient.set(true));
      }
    });

    inject(DestroyRef).onDestroy(() => {
      this.events.close();
      this.daemon.resetReachability();
      if (this.linger) {
        clearTimeout(this.linger);
      }
    });
  }

  // ---- what is on screen ---------------------------------------------------------------------

  private readonly resolved = computed<Subject | null>(() => {
    const state = this.subject();
    return state.kind === 'ready' ? state.value : null;
  });

  /** Both live on the refinement row now — the wrapper is the server's business. */
  protected readonly repositoryId = computed(() => this.workspace()?.repositoryId ?? '');
  protected readonly mainBranch = computed(() => this.workspace()?.parent ?? '');
  protected readonly title = computed(() => this.resolved()?.node.title ?? this.entityParam());

  /**
   * The one line of context the prompt-rewrite helper is given — what this chat is about, and
   * nothing more.
   *
   * It is **derived, never stored**. The refinement row used to carry a `preamble` column holding
   * the epic's title, description and whole feature/task tree, rendered once when the refinement was
   * created; that made the rewrite's context a copy of the very draft this page spends the session
   * editing, and it went stale the moment the agent touched anything. The row names its epic in
   * `epicId` — that is its key — so the scope is an attribute, and this computes the sentence from
   * the epic the page has already resolved to draw its header. Rename the epic and the next rewrite
   * is told the new name.
   *
   * `[preamble]` stays the binding's name down to {@link PromptPanel} because that is the daemon's
   * word for the field on `POST /prompt-refinements`; renaming it here while the wire kept the old
   * word would be two names for one thing.
   */
  protected readonly promptContext = computed(() => {
    const node = this.resolved()?.node;
    return node ? refinePrompt(node) : `# Refine: ${this.title()}`;
  });
  protected readonly description = computed(() => this.resolved()?.node.description ?? '');

  /**
   * The room this page is about: the one whose `entityId` is the subject's.
   *
   * The listing answers ACTIVE workspaces only, so a match is a live workspace and there is nothing to
   * filter on status.
   */
  protected readonly workspace = computed<RefinementDto | null>(() => {
    const state = this.workspaces();
    if (state.kind !== 'ready') {
      return null;
    }
    const id = this.resolved()?.node.id;
    return id ? (state.value.find((entry) => roomEntity(entry) === id) ?? null) : null;
  });

  protected readonly workspaceRowId = computed(() => this.workspace()?.id ?? 0);

  /**
   * The other rooms open right now — the activity bar's row. Every refinement is a room this page
   * can open (by its entity's number), so none is filtered out; the bar drops rooms without agent
   * activity itself.
   */
  protected readonly refiningPeers = computed<readonly RefinementDto[]>(() => {
    const state = this.workspaces();
    if (state.kind !== 'ready') {
      return [];
    }
    return state.value;
  });

  /**
   * The wrapper's workspaces are known, and none of them is on this branch.
   *
   * That is the create offer's condition and it needs both halves: an unanswered listing is not an
   * absence, and drawing "there is no workspace" while the read is in flight would flash an offer at a
   * page that is about to show a running container.
   */
  protected readonly absent = computed(
    () =>
      this.subject().kind === 'ready' && this.workspaces().kind === 'ready' && !this.workspace(),
  );

  /**
   * Whether the page has nothing at all to say — the condition the template's last branch exists to
   * make impossible.
   *
   * It is asked of the two `app-async` states rather than of a flag, because they are the two things
   * that speak for the page when there is no content: while either is loading or failed the reader
   * has a bar and a sentence, and drawing "nothing resolved" beside them would contradict what they
   * say. Everything else — a matched workspace, a settled absence — is drawn by the branches above,
   * so reaching this one means genuinely nothing is happening and nothing has gone wrong, which is
   * the state an address naming no project produces.
   */
  protected readonly silent = computed(
    () => !speaking(this.subject()) && !speaking(this.workspaces()),
  );

  protected readonly reachability = this.daemon.reachability;
  protected readonly live = this.events.connected;

  protected readonly urlTab = computed(() => {
    const slug = this.query().get('tab');
    return isDurableTab(slug) ? slug! : DEFAULT_TAB;
  });

  protected readonly selected = computed(() =>
    this.transient() && this.shownProcessId() ? STARTING_SLUG : this.urlTab(),
  );

  /** The row: the transient tab when there is one, then the durable refinement tools. */
  protected readonly tabs = computed<readonly TabDef[]>(() => {
    const activity = this.workspace()?.agentActivity ?? null;
    const durable = DURABLE_TABS.map((tab) => {
      if (tab.slug === 'epic') {
        return { ...tab, label: this.subjectLabel() };
      }
      if (tab.slug === 'agents' && activity) {
        return {
          ...tab,
          dot: activity === 'BUSY' ? ('accent' as const) : ('success' as const),
          dotTitle:
            activity === 'BUSY' ? 'The agent is working' : `Agent ${activity.toLowerCase()}`,
        };
      }
      return tab;
    });
    return this.shownProcessId()
      ? [
          durable[0],
          { slug: STARTING_SLUG, label: 'Starting', inUrl: false, pinFront: true },
          ...durable.slice(1),
        ]
      : durable;
  });

  protected readonly durableTabs = DURABLE_TABS;

  protected panelNote(slug: string): string {
    return PANEL_NOTES[slug] ?? '';
  }

  // ---- reads ------------------------------------------------------------------------------------

  /**
   * Resolve the wrapper and the epic. Both or neither: the page cannot draw a header without the epic
   * and cannot read a workspace without the repository, so one loading state covers them.
   */
  protected async loadSubject(): Promise<void> {
    const projectId = this.projectId();
    const number = this.entityNumber();
    if (!projectId || !this.entityParam()) {
      this.subject.set(IDLE);
      return;
    }
    if (number === null) {
      this.subject.set(failedAddress(this.entityParam()));
      return;
    }
    this.subject.set(LOADING);
    // An entity hop must not leave the previous entity's rows on screen matching against the new
    // one. LOADING rather than IDLE because the sibling effect re-reads them in this same flush.
    this.workspaces.set(LOADING);
    try {
      this.subject.set(await this.resolveSubject(projectId, number));
    } catch (error) {
      this.subject.set(failed(error));
      return;
    }
    await this.upgradeMatch();
  }

  /**
   * Swap this room's light listing row for its full projection — git drift included, which only the
   * single-row read pays for. Called after the listing lands *and* after the subject resolves,
   * because the two are read in parallel and the room is matched by the subject's id: whichever
   * arrives second is the one that can make the match.
   */
  private async upgradeMatch(attempt = this.attempt): Promise<void> {
    const id = this.resolved()?.node.id;
    const listed = this.workspaces();
    if (!id || listed.kind !== 'ready') {
      return;
    }
    const match = listed.value.find((entry) => roomEntity(entry) === id);
    if (!match) {
      return;
    }
    try {
      const full = await this.refinementsApi.get(match.id);
      const current = this.workspaces();
      if (attempt !== this.attempt || current.kind !== 'ready') {
        return;
      }
      this.workspaces.set(
        ready(current.value.map((entry) => (entry.id === match.id ? full : entry))),
      );
    } catch {
      // The light row is already drawing the page; the drift arrives with the next hint.
    }
  }

  /**
   * Re-read the subject without blanking the room — after a write this page made itself (an image
   * inserted into the description), where the room is correct and only one field moved.
   */
  private async refreshSubject(): Promise<void> {
    const projectId = this.projectId();
    const number = this.entityNumber();
    if (!projectId || number === null) {
      return;
    }
    try {
      const next = await this.resolveSubject(projectId, number);
      if (next.kind === 'ready') {
        this.subject.set(next);
      }
    } catch {
      // The room still shows the description as it was; the next visit reads it again.
    }
  }

  private async resolveSubject(projectId: string, number: number): Promise<Loadable<Subject>> {
    const [{ node, nodes }, registry] = await Promise.all([
      this.refining.resolve(projectId, number),
      this.archetypes.registry(),
    ]);
    if (!node) {
      return { kind: 'error', status: 404, message: `No entity numbered ${number} in this project.` };
    }
    return ready({ node, nodes, registry });
  }

  /**
   * Read the wrapper's refinements, and **draw the page off the listing rather than off the
   * upgrade.**
   *
   * The two reads are deliberately not one moment. The listing is the light projection — live
   * halves, no git drift — and it is everything this page needs to decide *which* screen it is
   * showing: a matched branch is a workspace, no match is the offer. The single-row read
   * that follows adds drift for the status strip alone, and on the service that read refreshes the
   * wrapper's git mirror behind a lock: a fetch, or a clone when the mirror is cold. Publishing only
   * after it settled therefore spent an unbounded git operation before the first paint, and spent it
   * hardest in exactly the case that has the least to gain — a refinement created seconds ago, whose
   * branch the mirror has never seen and whose drift is `null` anyway. That was the blank page: not
   * an error, not a stall, a page correctly waiting for something it did not need yet.
   *
   * So the rows are published as they arrive and the row this page is about is swapped underneath a
   * screen already drawn. An upgrade that fails changes nothing, as before; an upgrade that is slow
   * now costs a late "3 ahead" on one tab instead of the whole page.
   *
   * {@link attempt} is what makes two writes per read safe: a hint can start another listing while
   * an upgrade is still out, and the older answer must not be allowed to land on top of the newer
   * one. Only the newest read may write.
   */
  protected async loadRefinements(projectId: string): Promise<void> {
    if (!projectId) {
      // Idle is the honest word for an address that names no project: nothing was asked, and
      // nothing is coming. Returning quietly here is what left a page seeded LOADING shimmering
      // forever at a reader who had nothing to wait for.
      this.workspaces.set(IDLE);
      return;
    }
    const attempt = ++this.attempt;
    // Loud only when there is nothing on screen to keep: a hint's re-read swaps the rows when they
    // arrive, and blanking the page for every agent keystroke would be worse than a moment's lag.
    if (this.workspaces().kind !== 'ready') {
      this.workspaces.set(LOADING);
    }
    try {
      const rows = await this.refinementsApi.list(projectId);
      if (attempt !== this.attempt) {
        return;
      }
      // Before the signal, so the bar's order is settled by the time anything renders it.
      this.memory.observe(rows);
      this.workspaces.set(ready(rows));

      await this.upgradeMatch(attempt);
    } catch (error) {
      if (attempt === this.attempt) {
        this.workspaces.set(failed(error));
      }
    }
  }

  /**
   * Ask what is running, and let the answer drive the transient tab.
   *
   * A null answer while a tab is showing means the operation finished without this page seeing its
   * terminal frame — a late attach, or a reload after the fact — so it starts the same linger rather
   * than leaving a tab that never closes.
   */
  private async loadActiveProcess(workspaceId: number): Promise<void> {
    if (workspaceId <= 0) {
      return;
    }
    try {
      const processId = await this.refinementsApi.activeProcess(workspaceId);
      if (processId) {
        this.clearLinger();
        if (processId !== this.shownProcessId()) {
          this.retainFailedProcess = false;
        }
        this.shownProcessId.set(processId);
      } else if (this.shownProcessId() && !this.retainFailedProcess) {
        this.startLinger();
      }
    } catch {
      // The transient tab is an extra, not the page. A failed lookup leaves the row as it was.
    }
  }

  private async startContainerOnEntry(workspaceId: number): Promise<void> {
    this.autoStartFailure.set(null);
    try {
      const answer = await this.refinementsApi.ensureContainer(workspaceId);
      if (answer.technicalProcessId) this.onStarted(answer.technicalProcessId);
    } catch (error) {
      this.autoStartFailure.set(describeError(error));
    } finally {
      await this.loadRefinements(this.projectId());
    }
  }

  // ---- what the page does -----------------------------------------------------------------------

  /**
   * Start the refining workspace from here — the same find-or-create the epic card presses.
   *
   * It is the same call and not a copy of it, which is what makes the offer honest: if a workspace was
   * started in another tab in the meantime, this finds it rather than failing.
   */
  protected async startRefining(): Promise<void> {
    const subject = this.resolved();
    if (!subject || this.starting()) {
      return;
    }
    this.starting.set(true);
    this.startFailure.set(null);
    try {
      await this.refining.open(subject.node.id);
      await this.loadRefinements(this.projectId());
    } catch (error) {
      this.startFailure.set(describeError(error));
    } finally {
      this.starting.set(false);
    }
  }

  /**
   * An activity-bar press: that epic's refining page, on its Chat tab, which is where the next prompt
   * goes.
   *
   * The workspace row id is deliberately *not* in the URL. It is resolved from the branch on arrival,
   * exactly as this page resolves its own — so the row the bar was drawn from can be gone by the time
   * the press lands and the destination still comes out right.
   */
  protected openPeer(workspaceRowId: number): void {
    const peer = this.refiningPeers().find((entry) => entry.id === workspaceRowId) ?? null;
    const node = peer ? nodeById(this.resolved()?.nodes ?? [], roomEntity(peer)) : null;
    if (node) {
      void this.router.navigate(refinementRoute(this.projectSlug(), node) as string[], {
        queryParams: { tab: 'chat' },
      });
    }
  }

  protected chooseTab(slug: string): void {
    if (slug === STARTING_SLUG) {
      this.transient.set(true);
      return;
    }
    this.transient.set(false);
    // A push rather than a replace, so the back button walks tabs.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: slug },
      queryParamsHandling: 'merge',
    });
  }

  /** Put an epic passage or writing point into prompt context, then reveal Chat to use it. */
  protected pickEpic(selection: EpicSelection): void {
    const workspaceId = this.workspaceRowId();
    if (workspaceId <= 0) {
      return;
    }
    this.picked.use(workspaceId);
    this.picked.addEpic({ slug: this.resolved()?.node.slug ?? '', ...selection });
    this.chooseTab('chat');
  }

  /**
   * Put an image into the subject's description — a field edit, so it goes through the multi-entity
   * transition door as a restatement of the row (the per-archetype PUTs are retired). The subject is
   * then re-read quietly: the room is correct and one field moved.
   */
  protected async insertEpicImage(insertion: EpicImageInsertion): Promise<void> {
    const current = this.resolved();
    const entity = current?.node.entity;
    if (!current || !entity) return;
    const description = insertImageAt(
      current.node.description ?? '',
      insertion.line,
      this.workspaceRowId(),
      insertion.attachment,
    );
    const registry = await this.archetypes.registry();
    const subject = subjectsOf([entity]).find((candidate) => candidate.id === entity.id);
    if (!subject) return;
    await this.entitiesApi.transitionEntities(
      new Map([[entity.id, restatement(registry, subject, { DESCRIPTION: description })]]),
    );
    await this.refreshSubject();
  }

  /**
   * A page frozen on the Web view tab becomes a design, and the reader is taken to it.
   *
   * The jump is the point: a capture that quietly filed itself away would leave the reader pressing
   * Freeze twice to check it worked. The selection is requested rather than passed, because the
   * Design panel may not be mounted yet — it picks the row up when its listing arrives.
   *
   * The 413 is named: it is the one failure the reader can act on, by freezing a smaller page.
   */
  protected async freezeIntoDesign(frozen: WebViewFreeze): Promise<void> {
    const workspaceRowId = this.workspaceRowId();
    if (workspaceRowId <= 0) {
      return;
    }
    this.freezeFailure.set(null);
    try {
      const created = await this.designs.create(workspaceRowId, {
        title: frozen.title,
        html: frozen.html,
        sourceRoute: frozen.route,
        truncated: frozen.truncated,
      });
      this.designSelection.open(created.id);
      this.chooseTab('design');
    } catch (error) {
      this.freezeFailure.set(
        statusOf(error) === 413
          ? 'That page is over the size limit, so it was not saved.'
          : `That page was not saved — ${describeError(error)}.`,
      );
    }
  }

  protected editSketch(attachmentId: string): void {
    this.sketchSelection.open(attachmentId);
    this.chooseTab('sketch');
  }

  /** The Starting tab's process reached its terminal frame. Failed setup stays available for review. */
  protected onSettled(outcome: ProcessOutcome): void {
    this.events.invalidateAll();
    if (outcome === 'failed') {
      this.clearLinger();
      this.retainFailedProcess = true;
      return;
    }
    this.startLinger();
  }

  protected onStarted(processId: string): void {
    this.clearLinger();
    this.retainFailedProcess = false;
    this.shownProcessId.set(processId);
  }

  protected onChanged(): void {
    void this.loadRefinements(this.projectId());
  }

  /**
   * Take one lifecycle step from the room — through the archetype's own lifecycle door, so the step
   * runs everything a step means (the phase advance, and the resolving move that ends this room) —
   * then go to the entity's page, which is where a moved entity is read.
   */
  protected async move(move: LifecycleMove): Promise<void> {
    const current = this.resolved();
    if (!current || this.resolutionPending()) return;
    const node = current.node;
    this.resolutionPending.set(move.target);
    this.resolutionFailure.set(null);
    try {
      if (node.archetype === 'TICKET') {
        await this.entitiesApi.transition(node.id, move.target);
      } else {
        await this.projects.transitionEpic(node.id, move.target);
      }
      await this.router.navigate(entityRoute(this.projectSlug(), node) as string[]);
    } catch (error) {
      this.resolutionFailure.set(describeError(error));
    } finally {
      this.resolutionPending.set(null);
    }
  }

  protected reload(): void {
    void this.loadSubject();
  }

  /**
   * Ask for everything again — what the residue branch offers, where there is no one failed read to
   * point a retry at. Both, and not just the subject: reaching that branch means neither of them has
   * an answer, and re-issuing one of the two would leave the reader pressing a button that changes
   * nothing.
   */
  protected retryAll(): void {
    void this.loadSubject();
    void this.loadRefinements(this.projectId());
  }

  /** The entity's own page — where the room's crumb leads back to. */
  protected readonly entityLink = computed(() => {
    const node = this.resolved()?.node;
    return node ? entityRoute(this.projectSlug(), node) : null;
  });

  /** The dossier this room writes: the epic's, or the ticket's. */
  protected dossierOwner(): DossierOwner {
    const node = this.resolved()?.node;
    return node?.archetype === 'TICKET' ? ticketDossier(node.id) : epicDossier(node?.id ?? '');
  }

  /**
   * Whether the dossier takes writes here. A ticket's pages are writable at every status; an epic's
   * scope — dossier included — is writable only in the lifecycle's **first** word (the service's
   * `requireReported`), read off the served walk rather than spelled here.
   */
  protected dossierEditable(): boolean {
    const subject = this.resolved();
    if (!subject) return false;
    if (subject.node.archetype === 'TICKET') return true;
    const walk = lifecycleOf(subject.registry, subject.node.archetype);
    return subject.node.status !== null && subject.node.status === walk[0];
  }

  /**
   * The dossier page named in the URL. An unknown or missing slug is not an error: the panel
   * normalises to the first page and says which one it settled on, and that is what
   * {@link #dossierPageChosen} writes back.
   */
  protected dossierPage(): string | null {
    return this.query().get('page');
  }

  /**
   * Follow the panel's choice in the URL, **replacing** rather than pushing: the fragment — a
   * heading — is what people step back through, not the page.
   */
  protected dossierPageChosen(slug: string): void {
    if (this.query().get('page') === slug) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: slug },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- plumbing ---------------------------------------------------------------------------------

  private guardRemount(entityParam: string): void {
    if (this.mountedFor === null) {
      this.mountedFor = entityParam;
      return;
    }
    if (this.mountedFor === entityParam) {
      return;
    }
    this.mountedFor = entityParam;
    untracked(() => {
      this.shownProcessId.set(null);
      this.transient.set(false);
      this.resolutionPending.set(null);
      this.resolutionFailure.set(null);
      this.startFailure.set(null);
      this.autoSelected = null;
      this.retainFailedProcess = false;
      this.daemon.resetReachability();
      this.remounts.update((count) => count + 1);
      this.mounted.set(false);
      queueMicrotask(() => this.mounted.set(true));
    });
  }

  private startLinger(): void {
    this.clearLinger();
    this.linger = setTimeout(() => {
      this.shownProcessId.set(null);
      this.transient.set(false);
      this.linger = null;
    }, LINGER_MS);
  }

  private clearLinger(): void {
    if (this.linger) {
      clearTimeout(this.linger);
      this.linger = null;
    }
  }
}

/** The entity a room names — `entityId`, with the legacy `epicId` for a row from an older service. */
function roomEntity(row: RefinementDto): string {
  return row.entityId ?? row.epicId ?? '';
}

/** An address whose segment names no number at all: a not-found, said as one. */
function failedAddress(segment: string): Loadable<never> {
  return { kind: 'error', status: 404, message: `“${segment}” is not an entity number.` };
}
