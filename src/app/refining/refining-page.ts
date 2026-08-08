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
import { WorkspaceCommands } from '../api/workspace-commands';
import { WorkspaceDaemonApi } from '../api/workspace-daemon-api';
import { WorkspaceEvents, anyOf } from '../api/workspace-events';
import { WorkspaceServices } from '../api/workspace-services';
import { WorkspacesApi } from '../api/workspaces-api';
import type { WorkspaceDto } from '../api/workspaces-dto';
import { refiningBranch, refiningEpicSlug, type EpicNode } from '../project/epics-model';
import { Async } from '../ui/async';
import { IDLE, LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { MarkdownView } from '../ui/markdown-view';
import { ActionsPanel } from './actions/actions-panel';
import { ActivityBar } from './activity-bar';
import { AgentActivityMemory } from './agent-activity-memory';
import { AgentsPanel } from './agents/agents-panel';
import { ChatPanel } from './chat/chat-panel';
import { FilesPanel } from './files/files-panel';
import type { MergeResult } from './merge/merge-outcome';
import { PanelPlaceholder } from './panel-placeholder';
import { RefiningService } from './refining-service';
import { ServicesPanel } from './services/services-panel';
import { StartingPanel } from './starting/starting-panel';
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
 * Empty now that all six have one. Kept, because {@link RefiningPage.panelNote} is what a tab added
 * ahead of its panel falls back to, and a placeholder that names the surface is a better screen than
 * an empty box.
 */
const PANEL_NOTES: Readonly<Record<string, string>> = {};

/** What the page had to resolve before it could show anything: the wrapper, and the epic. */
interface Subject {
  /** The project's wrapper repository — where the refining branch lives. */
  readonly repositoryId: string;
  /** The wrapper's default branch, which is what decides the door home. */
  readonly mainBranch: string;
  /** The epic, so the header can name it and a create can build the preamble from it. */
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
 * `:projectId/epics/:epicSlug/refining` names the *epic*, and the workspace is looked up from it. That
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
    ActionsPanel,
    ActivityBar,
    AgentsPanel,
    Async,
    ChatPanel,
    FilesPanel,
    MarkdownView,
    PanelPlaceholder,
    QitsButton,
    ServicesPanel,
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
  private readonly workspacesApi = inject(WorkspacesApi);
  private readonly daemon = inject(WorkspaceDaemonApi);
  private readonly events = inject(WorkspaceEvents);
  private readonly memory = inject(AgentActivityMemory);
  private readonly serviceEntry = inject(WorkspaceServices);
  private readonly commandEntry = inject(WorkspaceCommands);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly projectId = computed(() => this.params().get('projectId') ?? '');
  protected readonly epicSlug = computed(() => this.params().get('epicSlug') ?? '');

  /** The branch this page is about, composed from the URL and never read off a field. */
  protected readonly branch = computed(() => refiningBranch(this.epicSlug()));

  protected readonly subject = signal<Loadable<Subject>>(LOADING);
  protected readonly workspaces = signal<Loadable<readonly WorkspaceDto[]>>(IDLE);

  /** The create offer's own state, so a failure to start one is reported where it was asked for. */
  protected readonly starting = signal(false);
  protected readonly startFailure = signal<string | null>(null);

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

  /** Whether the transient tab currently holds the selection. Never written to the URL. */
  private readonly transient = signal(false);

  /** Every merge made from this page — kept because a merge resolves the workspace under it. */
  protected readonly landed = signal<readonly MergeResult[]>([]);

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
      const repositoryId = this.repositoryId();
      this.workspaceHints();
      untracked(() => void this.loadWorkspaces(repositoryId));
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

  protected readonly repositoryId = computed(() => this.resolved()?.repositoryId ?? '');
  protected readonly mainBranch = computed(() => this.resolved()?.mainBranch ?? '');
  protected readonly title = computed(() => this.resolved()?.node.epic.title ?? this.epicSlug());
  protected readonly description = computed(() => this.resolved()?.node.epic.description ?? '');

  /**
   * The workspace this page is about: the one whose branch is `refining/<epicSlug>`.
   *
   * The listing answers ACTIVE workspaces only, so a match is a live workspace and there is nothing to
   * filter on status.
   */
  protected readonly workspace = computed<WorkspaceDto | null>(() => {
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
  protected readonly refiningPeers = computed<readonly WorkspaceDto[]>(() => {
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

  /**
   * A terminal run this workspace is doing that no agent is driving — the Actions dot.
   *
   * The split is deliberate and each dot points at its own tab: a chat has the Chat tab's, an agent run
   * has the Agents tab's, and a service has the Services tab's. It is only the *label* that is
   * narrowed, so a glance at the strip says which tab to open rather than merely that something is
   * happening somewhere.
   *
   * "Agent-driven" is read off `agentSessions` rather than off the kind, because an interactive agent
   * launch is a PTY like any other terminal run — what makes it the agent's is that a session is pinned
   * to it.
   */
  private readonly runningAction = computed(() => {
    const state = this.commandEntry.commands();
    if (state.kind !== 'ready') {
      return false;
    }
    return state.value.some(
      (command) =>
        command.kind === 'TERMINAL' &&
        command.status === 'RUNNING' &&
        command.agentSessions.length === 0,
    );
  });

  /**
   * The row: the transient tab when there is one, then the six.
   *
   * **Every dot here is drawn from something already in hand, and none of them costs a request.** The
   * Agents dot reads the workspace entry the strip already holds; the Services and Actions dots read
   * the two shared entries, which answer "nothing to say" until a panel has asked for them. That is
   * what keeps this page's load budget at what it says it is: a dot on a tab nobody has opened would
   * otherwise mean a fetch on every page open for a tab nobody may visit, on a screen whose stated
   * property is that an idle workspace produces no traffic at all. Absence of a dot means "not asked",
   * never "nothing running", and one click resolves it.
   */
  protected readonly tabs = computed<readonly TabDef[]>(() => {
    const activity = this.workspace()?.agentActivity ?? null;
    const servicesDot = this.serviceEntry.dot();
    const running = this.runningAction();
    const durable = DURABLE_TABS.map((tab) => {
      if (tab.slug === 'agents' && activity) {
        return {
          ...tab,
          dot: activity === 'BUSY' ? ('accent' as const) : ('success' as const),
          dotTitle:
            activity === 'BUSY' ? 'The agent is working' : `Agent ${activity.toLowerCase()}`,
        };
      }
      if (tab.slug === 'services' && servicesDot) {
        return { ...tab, dot: servicesDot, dotTitle: this.serviceEntry.dotTitle() };
      }
      if (tab.slug === 'actions' && running) {
        return { ...tab, dot: 'accent' as const, dotTitle: 'An action is running' };
      }
      return tab;
    });
    return this.shownProcessId()
      ? [{ slug: STARTING_SLUG, label: 'Starting', inUrl: false, pinFront: true }, ...durable]
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
      // In parallel: they are independent reads of two services, and the page needs both.
      const [wrapper, node] = await Promise.all([
        this.refining.wrapper(projectId),
        this.refining.node(projectId, epicSlug),
      ]);
      this.subject.set(ready({ ...wrapper, node }));
    } catch (error) {
      this.subject.set(failed(error));
    }
  }

  protected async loadWorkspaces(repositoryId: string): Promise<void> {
    if (!repositoryId) {
      return;
    }
    try {
      const workspaces = await this.workspacesApi.workspaces(repositoryId);
      // Before the signal, so the bar's order is settled by the time anything renders it.
      this.memory.observe(workspaces);
      this.workspaces.set(ready(workspaces));
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
      const processId = await this.workspacesApi.activeProcess(workspaceId);
      if (processId) {
        this.clearLinger();
        this.shownProcessId.set(processId);
      } else if (this.shownProcessId()) {
        this.startLinger();
      }
    } catch {
      // The transient tab is an extra, not the page. A failed lookup leaves the row as it was.
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
      await this.refining.open(this.projectId(), subject.node);
      await this.loadWorkspaces(subject.repositoryId);
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
      void this.router.navigate([this.projectId(), 'epics', slug, 'refining'], {
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

  /** The Starting tab's process reached its terminal frame. */
  protected onSettled(): void {
    this.events.invalidateAll();
    this.startLinger();
  }

  protected onStarted(processId: string): void {
    this.clearLinger();
    this.shownProcessId.set(processId);
  }

  protected onChanged(): void {
    void this.loadWorkspaces(this.repositoryId());
  }

  protected onMerged(result: MergeResult): void {
    this.landed.update((records) => [result, ...records]);
  }

  protected reload(): void {
    void this.loadSubject();
  }

  /** Back to the epic this workspace refines. */
  protected backToEpics(): void {
    void this.router.navigate([this.projectId()], { fragment: `epic-${this.epicId()}` });
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
      this.landed.set([]);
      this.startFailure.set(null);
      this.autoSelected = null;
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
