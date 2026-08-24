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
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { DesignsApi } from '../api/designs-api';
import { WorkspaceDaemonApi } from '../api/workspace-daemon-api';
import { WorkspaceEvents, anyOf } from '../api/workspace-events';
import { ProjectsApi } from '../api/projects-api';
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import { ProjectParam } from '../nav/project-param';
import { EpicActions } from '../project/epic-actions';
import {
  actionKey,
  actionsFor,
  refiningBranch,
  refiningEpicSlug,
  type EpicAction,
  type EpicNode,
} from '../project/epics-model';
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

/** What the page had to resolve before it could show anything: the epic. */
interface Subject {
  /** The epic, so the header can name it and the refining route can address its refinement. */
  readonly node: EpicNode;
}

/**
 * The room you sit in while an agent refines an epic.
 *
 * ## What it is
 *
 * A refining workspace is an ordinary qits-workspaces workspace, on the project's **wrapper**
 * repository, on the branch `refining/<epicSlug>`. So this page is the workspace detail UI — copied
 * from qits-spa-workspaces, which is this codebase's sanctioned way to share a screen — with one
 * difference that shapes the whole file: **the URL does not name the workspace.**
 *
 * ## Resolution, and why the URL is what it is
 *
 * `:project/epics/:epicSlug/refining` names the *epic*, and the workspace is looked up from it. That
 * is the same rule the epic card's Refine button follows and it is deliberate: the association between
 * an epic and its refining workspace is not stored anywhere, so the only honest address is the one that
 * can be re-resolved. A URL carrying a workspace row id would be a link that rots the moment the
 * workspace is discarded and a new one started — pointing at a resolved workspace with no container,
 * for an epic that is being refined right now.
 *
 * Three reads resolve it, and they are three because each answers something the others cannot:
 *
 * 1. `GET /projects/api/projects/{id}/repositories` — the wrapper repository id **and** its default
 *    branch, from the one read that carries both (drift is the difference between the rows and the
 *    wrapper, so the service answers them together).
 * 2. `GET /projects/api/projects/{id}/epics` plus that epic's features and tasks — the header's title
 *    and, if there is no workspace, the preamble a create would need.
 * 3. `GET /workspaces/api/workspaces?repositoryId=` — the ACTIVE workspaces of the wrapper, of which
 *    the one whose `branch` matches is this page's subject. The listing rather than a read by id,
 *    because the branch is all this page has to go on.
 *
 * Then `GET …/{workspaceId}/active-process` for the transient tab, and the workspace's hint channel.
 *
 * **Nothing here polls.** The channel is what replaced that, and an idle workspace produces no traffic.
 * The first `onopen` re-issues the workspace read, because the rule is "invalidate everything on every
 * connect" and a first connect is a connect — one duplicate is the price of having one rule.
 *
 * ## No workspace is a state, not an error
 *
 * A discard resolves the workspace and leaves the `refining/<slug>` ref behind, so an epic that was
 * being refined yesterday resolves to nothing today. That is not a broken page: it is an offer to start
 * again, made with the same find-or-create flow the epic card uses, which adopts the existing branch.
 * Rendering a 404 there would ask the reader to go back to the epics list and press a button that does
 * exactly this.
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
    EpicActions,
    EpicDocument,
    FilesPanel,
    PanelPlaceholder,
    QitsButton,
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
  protected readonly epicSlug = computed(() => this.params().get('epicSlug') ?? '');

  /** The branch this page is about, composed from the URL and never read off a field. */
  protected readonly branch = computed(() => refiningBranch(this.epicSlug()));

  protected readonly subject = signal<Loadable<Subject>>(LOADING);
  protected readonly workspaces = signal<Loadable<readonly RefinementDto[]>>(IDLE);

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
   * instance would keep the previous epic's everything. So a change of `epicSlug` sets this false, and
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

  /** The same lifecycle moves offered on a refining epic in the project overview, minus Refine. */
  protected readonly resolutionActions = actionsFor('REFINING').filter(
    (action) => action.kind === 'transition',
  );
  protected readonly resolutionPending = signal<string | null>(null);
  protected readonly resolutionFailure = signal<string | null>(null);

  /** Which epic the subject on hand was resolved for, so a hop is told from a hint. */
  private resolvedFor: string | null = null;

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
      const key = `${this.projectId()}/${this.epicSlug()}`;
      if (key !== this.resolvedFor) {
        this.resolvedFor = key;
        untracked(() => void this.loadSubject());
      }
    });

    effect(() => {
      const projectId = this.projectId();
      // An epic hop re-reads the listing too: the page's own row comes out of it, and a reused
      // component would otherwise keep matching against the previous epic's read.
      this.epicSlug();
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
      const routeKey = `${this.projectId()}/${this.epicSlug()}`;
      if (routeKey !== this.autoContainerRoute) {
        this.autoContainerRoute = routeKey;
        this.autoContainerWorkspaceId = 0;
        this.autoStartFailure.set(null);
      }
      const subject = this.resolved();
      const belongsToRoute =
        subject?.node.epic.projectId === this.projectId() &&
        subject.node.epic.slug === this.epicSlug();
      const workspace = belongsToRoute ? this.workspace() : null;
      if (!workspace || this.autoContainerWorkspaceId === workspace.id) return;
      this.autoContainerWorkspaceId = workspace.id;
      if (workspace.runtimeStatus === 'RUNNING' || workspace.runtimeStatus === 'PROVISIONING')
        return;
      untracked(() => void this.startContainerOnEntry(workspace.id));
    });

    effect(() => this.guardRemount(this.epicSlug()));

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
  protected readonly title = computed(() => this.resolved()?.node.epic.title ?? this.epicSlug());
  protected readonly description = computed(() => this.resolved()?.node.epic.description ?? '');

  /**
   * The workspace this page is about: the one whose branch is `refining/<epicSlug>`.
   *
   * The listing answers ACTIVE workspaces only, so a match is a live workspace and there is nothing to
   * filter on status.
   */
  protected readonly workspace = computed<RefinementDto | null>(() => {
    const state = this.workspaces();
    if (state.kind !== 'ready') {
      return null;
    }
    return state.value.find((entry) => entry.branch === this.branch()) ?? null;
  });

  protected readonly workspaceRowId = computed(() => this.workspace()?.id ?? 0);

  /**
   * The other epics being refined right now — the activity bar's row.
   *
   * **Refining branches only, and that narrowing is what makes the row pressable.** The bar's job is
   * "who needs me next", and a press has to land somewhere: this SPA addresses a workspace by the epic
   * it refines, so a workspace on `epic/…`, on a feature branch or on a hand-cut branch has no page
   * here to open. Carrying it would be a button that either goes nowhere or leaves for another SPA
   * mid-thought. So the row reads as *which epics have an agent working*, which is the question a
   * reader of this page actually has.
   *
   * The filter costs nothing: the listing is already in hand for the branch match above, and the bar
   * drops workspaces without agent activity itself.
   */
  protected readonly refiningPeers = computed<readonly RefinementDto[]>(() => {
    const state = this.workspaces();
    if (state.kind !== 'ready') {
      return [];
    }
    return state.value.filter((entry) => refiningEpicSlug(entry.branch) !== null);
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
    const epicSlug = this.epicSlug();
    if (!projectId || !epicSlug) {
      this.subject.set(IDLE);
      return;
    }
    this.subject.set(LOADING);
    this.workspaces.set(IDLE);
    try {
      this.subject.set(ready({ node: await this.refining.node(projectId, epicSlug) }));
    } catch (error) {
      this.subject.set(failed(error));
    }
  }

  protected async loadRefinements(projectId: string): Promise<void> {
    if (!projectId) {
      return;
    }
    try {
      const rows = await this.refinementsApi.list(projectId);
      // The listing is the light projection — live halves, no git drift. This page's own row is
      // upgraded to the full read (drift included), because the strip renders it; the peers stay
      // light, because the bar reads only branch and activity.
      const match = rows.find((entry) => entry.branch === this.branch());
      let value: readonly RefinementDto[] = rows;
      if (match) {
        try {
          const full = await this.refinementsApi.get(match.id);
          value = rows.map((entry) => (entry.id === match.id ? full : entry));
        } catch {
          // The light row still draws the page; the drift arrives with the next hint.
        }
      }
      // Before the signal, so the bar's order is settled by the time anything renders it.
      this.memory.observe(value);
      this.workspaces.set(ready(value));
    } catch (error) {
      this.workspaces.set(failed(error));
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
      await this.refining.open(subject.node);
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
    const branch =
      this.refiningPeers().find((entry) => entry.id === workspaceRowId)?.branch ?? null;
    const slug = refiningEpicSlug(branch);
    if (slug) {
      void this.router.navigate([this.projectSlug(), 'epics', slug, 'refining'], {
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
    this.picked.addEpic({ slug: this.epicSlug(), ...selection });
    this.chooseTab('chat');
  }

  protected async insertEpicImage(insertion: EpicImageInsertion): Promise<void> {
    const current = this.resolved();
    if (!current) return;
    const description = insertImageAt(
      current.node.epic.description ?? '',
      insertion.line,
      this.workspaceRowId(),
      insertion.attachment,
    );
    const epic = await this.projects.updateEpic(
      current.node.epic.id,
      current.node.epic.title,
      description,
    );
    this.subject.set(ready({ ...current, node: { ...current.node, epic } }));
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
   * Finish refinement from the document itself.
   *
   * Abandoning is intentionally two operations: discard first removes the container, volume,
   * workspace row and refinement branch; only then is the epic made terminal. If the second request
   * fails, Refine can recreate the workspace. Reversing that order could leave an abandoned epic
   * owning an unreachable active workspace with no UI from which to clean it up.
   */
  protected async resolveEpic(action: EpicAction): Promise<void> {
    if (action.kind !== 'transition' || this.resolutionPending()) return;
    const current = this.resolved();
    const workspace = this.workspace();
    if (!current || !workspace) return;

    this.resolutionPending.set(actionKey(action));
    this.resolutionFailure.set(null);
    try {
      if (action.target === 'ABANDONED') {
        await this.refinementsApi.discard(workspace.id);
      }
      await this.projects.transitionEpic(current.node.epic.id, action.target);
      await this.router.navigate([this.projectSlug()], {
        fragment: `epic-${current.node.epic.id}`,
      });
    } catch (error) {
      this.resolutionFailure.set(describeError(error));
    } finally {
      this.resolutionPending.set(null);
    }
  }

  protected reload(): void {
    void this.loadSubject();
  }

  /** Back to the epic this workspace refines. */
  protected backToEpics(): void {
    void this.router.navigate([this.projectSlug()], { fragment: `epic-${this.epicId()}` });
  }

  protected epicId(): string {
    return this.resolved()?.node.epic.id ?? '';
  }

  // ---- plumbing ---------------------------------------------------------------------------------

  private guardRemount(epicSlug: string): void {
    if (this.mountedFor === null) {
      this.mountedFor = epicSlug;
      return;
    }
    if (this.mountedFor === epicSlug) {
      return;
    }
    this.mountedFor = epicSlug;
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
