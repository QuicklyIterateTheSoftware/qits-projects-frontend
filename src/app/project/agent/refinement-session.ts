import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  AgentDaemonApi,
  type AgentType,
  type CommandDto,
  type LaunchAgentRequest,
} from '../../api/agent-daemon-api';
import { ProjectAgentApi, type AgentContainerDto } from '../../api/project-agent-api';
import { WEB_SOCKET_FACTORY } from '../../api/web-socket';
import { describeError, statusOf } from '../../ui/loadable';
import { EMPTY_TERMINAL_FRAMES, TerminalSocket } from './terminal-socket';

/**
 * Where the refinement session has landed.
 *
 * `dormant` is the state this starts and returns to, and it is the whole point: nothing has been
 * asked for, nothing is attached, and no container exists on this panel's account.
 */
export type SessionBranch =
  /** Nothing asked for. No container ensured, no socket, no reads. */
  | { readonly kind: 'dormant' }
  /** The ensure or the resolving reads are in flight. */
  | { readonly kind: 'resolving' }
  /** A running interactive agent run, wherever it was started. */
  | { readonly kind: 'attached'; readonly commandId: string }
  /** The launch answered with a sign-in terminal instead of a session. */
  | { readonly kind: 'signin'; readonly commandId: string }
  /** History exists and nothing is running, so nothing happens without another press. */
  | { readonly kind: 'idle'; readonly lastSessionId: string | null }
  /** The container is not there to be asked. */
  | { readonly kind: 'unavailable'; readonly message: string };

/** How many times a completed sign-in may replay the launch before the loop is called off. */
const REPLAY_LIMIT = 2;

/** The statuses that mean the container is not answering, as opposed to answering "no". */
const UNREACHABLE: readonly number[] = [0, 502, 503, 504];

/** What this panel launches. `REPOSITORY` is the scope carrying the epic tools. */
const FRESH: LaunchAgentRequest = { scope: 'REPOSITORY', mode: 'INTERACTIVE' };

/**
 * Whether a command is the sign-in terminal the launch path hands back instead of a session.
 *
 * **Lineage alone is not enough, and that is a real trap.** A sign-in terminal is recognisable
 * because it has no session lineage — true, but a *fresh Kimi* launch also arrives with none,
 * because Kimi cannot pin a session id and reports it later through a hook. Treating that as a
 * sign-in would replay the launch on top of a perfectly good agent. So the name the daemon gives
 * the login command is checked as well (`AgentLaunchService` names it "Claude sign-in" / "Kimi
 * sign-in"), and both have to agree.
 */
export function isSignInTerminal(command: CommandDto): boolean {
  return command.agentSessions.length === 0 && /sign-in$/i.test(command.actionName.trim());
}

/**
 * The project's refinement session: what it resolves to, and the socket it is attached through.
 *
 * ## Dormant until pressed
 *
 * **Nothing here runs on page load.** A container is an image pull and a repository clone, and a
 * session is a model process — the panel that owns this is collapsed by default and this object
 * does nothing at all until {@link start}. {@link use} only points it at a project; it makes no
 * request. That rule is what the panel's spec pins, and it is the reason the epics page stays as
 * cheap as it was before this existed.
 *
 * ## The resolution order, and the rule under it
 *
 * On {@link start} — never before — the container is ensured and then this resolves in exactly this
 * order:
 *
 * 1. **A running interactive agent run → attach**, wherever it was started. A second browser tab, a
 *    session left open yesterday, an agent still working: all the same branch.
 * 2. **A running sign-in terminal → attach to it**, because the container is waiting on a login and
 *    launching a second agent would only produce a second one.
 * 3. **No session history at all → launch fresh.**
 * 4. **History exists but nothing is running → idle on an explicit choice.**
 *
 * **Resuming is never automatic, and branch 4 is the whole reason this class is written down.** The
 * recorded last session can be gone from the agent's own state — a re-materialised container, a
 * pruned volume — and auto-resuming a vanished id exits instantly with "no conversation found", in
 * a loop the user never asked for. The daemon defends the same line from its side by refusing a
 * resume of a session this container does not own. A finished run does not auto-relaunch either,
 * because a crashing agent would relaunch forever. Every resume starts at a press.
 *
 * ## The sign-in terminal replays what it interrupted
 *
 * When the harness is not signed in, `POST /agents` answers a **login terminal** rather than a
 * session. It is a PTY like any other, so it renders in place; and when it closes, the launch it
 * interrupted is issued again, so completing the login continues what was actually asked for rather
 * than dropping the reader on a menu. The replay is capped, because a sign-in that keeps failing
 * must not become a launch loop.
 *
 * ## Detaching is not stopping, and stopping is not terminating
 *
 * Three different things, three different verbs, and conflating any two of them loses work:
 * {@link detach} closes the socket and leaves the agent running; {@link terminate} signals the
 * agent's process group; {@link stopContainer} stops the container the agent lives in. Only the
 * first is safe to do without asking.
 */
@Injectable({ providedIn: 'root' })
export class RefinementSession {
  private readonly host = inject(ProjectAgentApi);
  private readonly daemon = inject(AgentDaemonApi);
  private readonly openSocket = inject(WEB_SOCKET_FACTORY);
  private readonly document = inject(DOCUMENT);

  private readonly project = signal('');
  private readonly state = signal<SessionBranch>({ kind: 'dormant' });
  private readonly containerState = signal<AgentContainerDto | null>(null);
  private readonly harness = signal<AgentType | null>(null);
  private readonly inFlight = signal(false);
  private readonly problemText = signal<string | null>(null);

  /**
   * The attachment, as a signal rather than a field.
   *
   * It is read *through* by {@link frames} and {@link link}, so replacing the socket re-points both
   * without copying anything: a computed that reads `socketRef()?.frames()` re-tracks the new
   * socket's signal the moment the reference changes.
   */
  private readonly socketRef = signal<TerminalSocket | null>(null);
  private socketFor: string | null = null;

  /** The launch a sign-in terminal interrupted, held until it closes. */
  private held: LaunchAgentRequest | null = null;
  private replays = 0;

  /** Where the session has landed. Everything the panel draws below the header comes from this. */
  readonly branch = this.state.asReadonly();

  /** What the host last said about the container, or null before anything was asked. */
  readonly container = this.containerState.asReadonly();

  /** Which harness is running, once `/agents/available` has answered. Named, never chosen. */
  readonly agentType = this.harness.asReadonly();

  /** Whether an ensure, a launch, a stop or a terminate is in flight. */
  readonly busy = this.inFlight.asReadonly();

  /** What went wrong, in the service's own words where it had any. */
  readonly problem = this.problemText.asReadonly();

  /** What the proxy last said about the daemon — one sentence for the whole panel. */
  readonly reachability = this.host.reachability;

  /** The attached terminal's raw PTY frames and link state. */
  readonly frames = computed(() => this.socketRef()?.frames() ?? EMPTY_TERMINAL_FRAMES);
  readonly link = computed(() => this.socketRef()?.status() ?? 'disconnected');

  constructor() {
    // The sign-in terminal closed: re-issue the launch it interrupted. Driven off the link rather
    // than off a poll, because a clean close is exactly the daemon saying the login command is gone.
    effect(() => {
      const branch = this.state();
      const link = this.link();
      if (branch.kind !== 'signin' || link !== 'disconnected') {
        return;
      }
      untracked(() => void this.replayAfterSignIn());
    });
  }

  // ---- pointing it somewhere ---------------------------------------------------------------

  /**
   * Point at a project. **Makes no request**, by design — see the class note on dormancy.
   *
   * Idempotent for the same id. A different id drops everything: an attached socket, a held launch
   * and a container status all belong to one project and mean nothing in another.
   */
  use(projectId: string): void {
    if (this.project() === projectId) {
      return;
    }
    this.detach();
    this.project.set(projectId);
    this.containerState.set(null);
    this.harness.set(null);
    this.problemText.set(null);
    this.held = null;
    this.replays = 0;
    this.host.resetReachability();
  }

  // ---- reads -------------------------------------------------------------------------------

  /**
   * Ask the host where the container is, without creating one.
   *
   * The one request the panel makes on being expanded, and what an `agent-activity` hint re-runs.
   * `ABSENT` is a normal answer: most projects have never had a refinement session.
   */
  async refreshContainer(): Promise<void> {
    const projectId = this.project();
    if (!projectId) {
      return;
    }
    try {
      const container = await this.host.container(projectId);
      if (this.project() === projectId) {
        this.containerState.set(container);
      }
    } catch (error) {
      if (this.project() === projectId) {
        this.problemText.set(`The container status could not be read — ${describeError(error)}.`);
      }
    }
  }

  // ---- what a press does -------------------------------------------------------------------

  /**
   * Ensure the container, then resolve the session.
   *
   * The expensive press, and the only path that creates anything. A failure to ensure lands in
   * `unavailable` rather than in `resolving` forever: there is nothing to ask when there is no
   * container.
   */
  async start(): Promise<void> {
    const projectId = this.project();
    if (!projectId || this.inFlight()) {
      return;
    }
    this.inFlight.set(true);
    this.problemText.set(null);
    this.state.set({ kind: 'resolving' });
    try {
      this.containerState.set(await this.host.ensure(projectId));
    } catch (error) {
      this.state.set({
        kind: 'unavailable',
        message: `The agent container could not be started — ${describeError(error)}.`,
      });
      this.inFlight.set(false);
      return;
    }
    this.inFlight.set(false);
    await this.resolve();
  }

  /** Start a brand-new session. The Start press when history already exists, and nothing else. */
  async startFresh(): Promise<void> {
    await this.launch(FRESH);
  }

  /**
   * Continue a recorded session.
   *
   * **Only ever from a press** — see the class note on branch 4. The daemon refuses a resume of a
   * session this container does not own, which is the same line defended from the other side.
   */
  async resume(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await this.launch({ ...FRESH, resumeSessionId: sessionId });
  }

  /**
   * Let go of the socket. The agent keeps running — this is what a collapse and a destroy do, and
   * it is why neither asks a question first.
   */
  detach(): void {
    this.socketRef()?.close();
    this.socketRef.set(null);
    this.socketFor = null;
    this.state.set({ kind: 'dormant' });
  }

  /**
   * Signal the attached agent's process group.
   *
   * Distinct from {@link detach} in the one way that matters: the conversation ends. The panel puts
   * it behind a second press for exactly that reason.
   */
  async terminate(): Promise<void> {
    const projectId = this.project();
    const branch = this.state();
    const commandId =
      branch.kind === 'attached' || branch.kind === 'signin' ? branch.commandId : null;
    if (!projectId || !commandId || this.inFlight()) {
      return;
    }
    this.inFlight.set(true);
    this.problemText.set(null);
    try {
      await this.daemon.terminate(projectId, commandId);
      // The daemon closes the socket cleanly on its own; the screen keeps its final frame.
      await this.resolve();
    } catch (error) {
      this.problemText.set(`The agent could not be stopped — ${describeError(error)}.`);
    } finally {
      this.inFlight.set(false);
    }
  }

  /**
   * Stop the container.
   *
   * Lossless: the volume survives, so a later {@link start} restarts it in place. The socket is let
   * go first — there is nothing on the other end of it once the container is down.
   */
  async stopContainer(): Promise<void> {
    const projectId = this.project();
    if (!projectId || this.inFlight()) {
      return;
    }
    this.inFlight.set(true);
    this.problemText.set(null);
    try {
      const container = await this.host.stop(projectId);
      this.detach();
      this.containerState.set(container);
      this.host.resetReachability();
    } catch (error) {
      this.problemText.set(`The container could not be stopped — ${describeError(error)}.`);
    } finally {
      this.inFlight.set(false);
    }
  }

  /** Type into the attached PTY. */
  send(data: string): void {
    this.socketRef()?.send(data);
  }

  /** Tell the PTY its size. */
  resize(cols: number, rows: number): void {
    this.socketRef()?.resize(cols, rows);
  }

  /** Try the attachment again after the backoff budget was spent. */
  rearm(): void {
    this.socketRef()?.rearm();
  }

  clearProblem(): void {
    this.problemText.set(null);
  }

  // ---- the machinery -----------------------------------------------------------------------

  /** The four branches, in order. See the class note; the order is the contract. */
  private async resolve(): Promise<void> {
    const projectId = this.project();
    if (!projectId) {
      return;
    }
    this.state.set({ kind: 'resolving' });
    let commands: readonly CommandDto[];
    try {
      commands = await this.daemon.commands(projectId);
    } catch (error) {
      this.state.set({ kind: 'unavailable', message: unavailableMessage(error) });
      return;
    }
    if (this.project() !== projectId) {
      return;
    }
    // Named rather than chosen, and never allowed to fail the resolution: a launch with no
    // `agentType` takes the container's own default, which is the answer this read would have given.
    void this.loadHarness(projectId);

    // A lineage is what tells an agent run apart from any other interactive command the container
    // declares. A run this panel launched is attached directly by {@link launch} and never comes
    // back through here, which is why the "no lineage yet" case needs no second rule.
    const run = commands.find(
      (command) =>
        command.kind === 'TERMINAL' &&
        command.status === 'RUNNING' &&
        command.agentSessions.length > 0,
    );
    if (run) {
      this.attach(run.id, 'attached');
      return;
    }
    const signIn = commands.find(
      (command) => command.status === 'RUNNING' && isSignInTerminal(command),
    );
    if (signIn) {
      this.held ??= FRESH;
      this.attach(signIn.id, 'signin');
      return;
    }
    if (!(await this.hasHistory(projectId, commands))) {
      await this.launch(FRESH);
      return;
    }
    if (this.project() === projectId) {
      this.state.set({ kind: 'idle', lastSessionId: lastSessionOf(commands) });
    }
  }

  private async launch(request: LaunchAgentRequest): Promise<void> {
    const projectId = this.project();
    if (!projectId || this.inFlight()) {
      return;
    }
    this.inFlight.set(true);
    this.problemText.set(null);
    this.state.set({ kind: 'resolving' });
    try {
      const command = await this.daemon.launch(projectId, request);
      if (this.project() !== projectId) {
        return;
      }
      if (isSignInTerminal(command)) {
        // Not a session: a login terminal. Hold what was asked for, and replay it when this closes.
        this.held = request;
        this.attach(command.id, 'signin');
      } else {
        this.held = null;
        this.attach(command.id, 'attached');
      }
    } catch (error) {
      this.problemText.set(describeLaunch(error));
      this.state.set({ kind: 'idle', lastSessionId: null });
    } finally {
      this.inFlight.set(false);
    }
  }

  /**
   * One socket, keyed by command id.
   *
   * Keying it is the whole discipline: a relaunch is a *new* command, and reusing a socket bound to
   * a dead process is how a terminal ends up permanently showing someone else's exit.
   */
  private attach(commandId: string, kind: 'attached' | 'signin'): void {
    if (this.socketFor !== commandId) {
      this.socketRef()?.close();
      const socket = new TerminalSocket(
        this.host.socketUrl(this.project(), `/terminal/commands/${encodeURIComponent(commandId)}`),
        this.openSocket,
        this.document,
      );
      this.socketFor = commandId;
      this.socketRef.set(socket);
      socket.connect();
    }
    this.state.set(
      kind === 'signin' ? { kind: 'signin', commandId } : { kind: 'attached', commandId },
    );
  }

  /** Whether anything has ever run an agent here. Branch 3's only question. */
  private async hasHistory(projectId: string, commands: readonly CommandDto[]): Promise<boolean> {
    if (commands.some((command) => command.agentSessions.length > 0)) {
      return true;
    }
    try {
      return (await this.daemon.sessions(projectId)).length > 0;
    } catch {
      // A lineage read that failed is not evidence of history. Launching fresh is the safe answer:
      // it costs one session, where a wrong "there is history" would strand the reader on an idle
      // screen offering to resume something that may not exist.
      return false;
    }
  }

  /** The harness this container runs, for the status line. Never blocks and never fails a start. */
  private async loadHarness(projectId: string): Promise<void> {
    if (this.harness()) {
      return;
    }
    try {
      const available = await this.daemon.available(projectId);
      if (this.project() === projectId) {
        this.harness.set(available.defaultAgent);
      }
    } catch {
      // The status line simply does not name a harness. Nothing else depends on this.
    }
  }

  /** The sign-in terminal closed: re-issue the launch it interrupted, at most twice. */
  private async replayAfterSignIn(): Promise<void> {
    const held = this.held;
    this.held = null;
    if (!held) {
      this.state.set({ kind: 'idle', lastSessionId: null });
      return;
    }
    if (this.replays >= REPLAY_LIMIT) {
      this.problemText.set(
        'The sign-in terminal closed and the agent still is not signed in. Start a session again when it is.',
      );
      this.state.set({ kind: 'idle', lastSessionId: null });
      return;
    }
    this.replays += 1;
    await this.launch(held);
  }
}

/** The newest recorded session across the run list, or null when nothing ever pinned one. */
function lastSessionOf(commands: readonly CommandDto[]): string | null {
  // The list is newest first, so the first command carrying a lineage is the newest one; within a
  // command the *last* entry is the session it ended on.
  for (const command of commands) {
    const sessions = command.agentSessions;
    if (sessions.length > 0) {
      return sessions[sessions.length - 1].sessionId;
    }
  }
  return null;
}

/** Why the session cannot be resolved, said as a fact about the container rather than a status. */
function unavailableMessage(error: unknown): string {
  return UNREACHABLE.includes(statusOf(error))
    ? 'The container is not answering yet. The agent lives inside it, so there is nothing to resolve until it is.'
    : `The container could not be asked what is running — ${describeError(error)}.`;
}

/** A launch failure, preferring the daemon's own sentence — it explains refusals this cannot. */
function describeLaunch(error: unknown): string {
  const body = (error as { error?: { message?: string } } | null)?.error;
  if (body && typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }
  return UNREACHABLE.includes(statusOf(error))
    ? 'The container is not answering — an agent can only be launched inside a running one.'
    : 'The launch was refused.';
}
