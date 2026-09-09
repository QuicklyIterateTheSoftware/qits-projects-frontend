import { Injectable, inject } from '@angular/core';
import { ProjectAgentApi } from './project-agent-api';

/**
 * The projects daemon's own routes, reached through the container proxy.
 *
 * Written by hand from `daemons/qits-projects-daemon` — `ProjectsApi` is the route table and
 * `CommandJson`/`AgentJson` are the bodies — because the daemon ships no OpenAPI document. The
 * routes this panel needs:
 *
 * ```
 *   GET  /commands                     the run list, newest first
 *   POST /commands/{id}/terminate      signal a run's process group
 *   GET  /agents/available             the harnesses, and the default
 *   POST /agents                       launch a coding agent
 *   POST /agents/sign-in               open the sign-in terminal, deliberately
 *   GET  /agent-sessions               the session lineage
 *   WS   /terminal/commands/{id}       the PTY (opened by TerminalSocket, not here)
 * ```
 *
 * **A coding agent is a command.** `POST /agents` answers the same `{command: …}` envelope
 * `POST /commands` does, deliberately, so one decoder serves both and the launched run is attached
 * to exactly like any other terminal.
 *
 * **The daemon carries no `{projectId}` segment**: it serves one project, so the segment would be a
 * constant the caller has to get right. The identity comes back in the *bodies* instead — which is
 * why `CommandDto` has `projectId` and `repoName` where the workspaces daemon's has `workspaceId`
 * and `repoId`. Same shape, different ambient facts; do not copy that pair across.
 */

/** Whether a command is still going, and how it stopped if not. */
export type CommandStatus = 'RUNNING' | 'EXITED' | 'TERMINATED' | 'INTERRUPTED';

/** `TERMINAL` is an interactive PTY; `CHAT` is a coding agent over pipes; `SERVICE` is a long run. */
export type CommandKind = 'TERMINAL' | 'CHAT' | 'SERVICE';

/** Which harness ran, or is to run. */
export type AgentType = 'CLAUDE' | 'KIMI';

/**
 * Which MCP servers a launch is wired to. `REPOSITORY` is the one that carries the epic tools.
 *
 * Copied from the daemon's own enum, and it is worth saying which one: the *workspaces* daemon spells
 * the other member `ACTIONS`, this one spells it `PROJECT`, and sending the wrong word is a 400 with
 * nothing in the panel to explain it. Do not unify these two types across the two clients.
 */
export type AgentMcpScope = 'PROJECT' | 'REPOSITORY';

/**
 * **Where in the product a session was started from**, sent on the launch and reported back on the
 * command. It replaces the `desk` field this client used to send.
 *
 * <p><b>A surface is steering, not scoping.</b> Both of this daemon's surfaces launch into the same
 * {@link AgentMcpScope} with the same tools; the surface decides what the session is configured *as*
 * — which system prompt, model, effort, permission mode and MCP attachments the platform's stored
 * configuration for that place holds. Nothing is taken away from either, so an agent asked at the
 * tickets surface to open an epic still can.
 *
 * <p><b>The vocabulary is open and platform-wide</b> — eight keys today, of which this daemon serves
 * three (`project.epics`, `project.tickets` and the composed `epic.autonomous`, which no human
 * presses a button for). Only the two a human opens are spelled here, because only those are ever
 * *sent* from this client; `CommandDto.agentSurface` is a plain string for the same reason a
 * component name is, since a daemon may know a key this build has not been told about.
 */
export type AgentSurface = 'project.epics' | 'project.tickets';

/** `INTERACTIVE` is the full agent TUI on a PTY — the only mode this panel launches. */
export type AgentLaunchMode = 'CHAT' | 'INTERACTIVE';

/** How a session entered a command's lineage. */
export type AgentSessionSource = 'PINNED' | 'RESUMED' | 'FORKED' | 'SWITCHED' | 'REPORTED';

/** One session a command drove. In `Command.agentSessions` the **last** entry is the current one. */
export interface AgentSessionRefDto {
  readonly sessionId: string;
  readonly source: AgentSessionSource;
  readonly forkedFromSessionId?: string;
  readonly transcriptPath?: string;
  readonly recordedAt: string;
}

/**
 * One run inside the project's container.
 *
 * `projectId` and `repoName` are synthesized by the daemon: inside the container they are ambient,
 * so a command does not carry them, and the daemon puts them back so a caller can attribute a run
 * without asking a second question.
 */
export interface CommandDto {
  readonly id: string;
  readonly projectId: string;
  readonly repoName: string;
  readonly branch: string;
  readonly actionName: string;
  readonly actionId?: string;
  readonly status: CommandStatus;
  readonly interactive: boolean;
  readonly kind: CommandKind;
  readonly launchedAt: string;
  readonly finishedAt?: string;
  readonly exitCode?: number;
  readonly commitHash?: string;
  readonly shortCommitHash?: string;
  readonly agentSessions: readonly AgentSessionRefDto[];
  /**
   * Which surface started this run — the key {@link LaunchAgentRequest.surface} carried in.
   *
   * <p>Optional because two things answer nothing: a command launched before the daemon shipped the
   * field, and the sign-in terminal, which nobody starts from anywhere in the product. A reader that
   * needs a surface for an old row falls back — see
   * {@link ../project/agent/refinement-session#surfaceOf} — and that fallback has an expiry.
   */
  readonly agentSurface?: string;
}

/** The single-command envelope both `POST /commands` and `POST /agents` answer with. */
interface CommandEnvelope {
  readonly command: CommandDto;
}

/** The list envelope: newest first, each row keeping the `{command: …}` wrapper. */
interface CommandListResponse {
  readonly entries: readonly CommandEnvelope[];
}

/** The harnesses this container can launch, and the one a fresh launch takes by default. */
export interface AvailableAgentsDto {
  readonly agents: readonly AgentType[];
  readonly defaultAgent: AgentType;
}

/**
 * One session in the lineage.
 *
 * A tree rather than a list: `children` recurses along `forkedFromSessionId` edges. This panel reads
 * it for one question only — has anything ever run an agent here — so the depth is carried but not
 * drawn. An omitted `messageCount` means "not swept yet", which is why it is optional rather than
 * defaulted to zero.
 */
export interface AgentSessionNodeDto {
  readonly sessionId: string;
  readonly firstRecordedAt?: string;
  readonly forkedFromSessionId?: string;
  readonly messageCount?: number;
  readonly newestCommandId?: string;
  readonly children: readonly AgentSessionNodeDto[];
}

interface AgentSessionTreeResponse {
  readonly sessions: readonly AgentSessionNodeDto[];
}

/**
 * What a launch asks for.
 *
 * `deliverTaskPrompt` is never set by this client: it seeds the session with an instruction to fetch
 * a prompt through an MCP tool that no service implements, so the agent would be told to call
 * something that does not exist.
 */
export interface LaunchAgentRequest {
  readonly scope: AgentMcpScope;
  readonly mode: AgentLaunchMode;
  /**
   * Where in the product this session was started from. Sent on **every** launch this client makes;
   * an omitted one resolves to the shape-implied default, which is a rollout crutch and not a thing
   * to lean on. See {@link AgentSurface}.
   */
  readonly surface?: AgentSurface;
  readonly agentType?: AgentType;
  readonly initialContext?: string;
  readonly resumeSessionId?: string;
  readonly fork?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AgentDaemonApi {
  private readonly proxy = inject(ProjectAgentApi);

  /**
   * Every run this container has made, newest first.
   *
   * Unfiltered on purpose. The route takes `?status=`, but one unfiltered read answers both
   * questions resolution asks — what is running now, and whether anything ever ran — and a second
   * narrower read would be a second moment to disagree with the first.
   *
   * The store is in-memory and per container: a recreate starts it empty and a stopped container
   * has none at all. So an empty list is "nothing has run in *this* container", not "nothing ever".
   */
  async commands(projectId: string): Promise<readonly CommandDto[]> {
    const answer = await this.proxy.get<CommandListResponse>(projectId, '/commands');
    return (answer.entries ?? []).map((entry) => entry.command);
  }

  /**
   * The harnesses and the resolved default.
   *
   * Read **once per start**, to name the harness in the status line. There is no picker: the
   * refinement agent is the project's one agent, and a choice the panel cannot explain the
   * consequence of is worse than the container's own default.
   */
  async available(projectId: string): Promise<AvailableAgentsDto> {
    return this.proxy.get<AvailableAgentsDto>(projectId, '/agents/available');
  }

  /**
   * The session lineage, roots first.
   *
   * The index is in-memory and dies with the container; the transcripts do not, because the harness
   * writes them to a shared volume. What a recreate loses is the *index* — which is exactly why a
   * resume across containers is a press rather than something resolution does on its own.
   */
  async sessions(projectId: string): Promise<readonly AgentSessionNodeDto[]> {
    const answer = await this.proxy.get<AgentSessionTreeResponse>(projectId, '/agent-sessions');
    return answer.sessions ?? [];
  }

  /**
   * Launch a coding agent. The answer is the command to attach a socket to.
   *
   * **It can refuse.** A harness nobody has signed in on the shared credential volume used to be
   * answered by quietly substituting {@link launchLogin}'s bare REPL for the session that was asked
   * for; the library refuses instead, and this client's callers read that refusal with
   * {@link ./agent-sign-in#notSignedIn}.
   */
  async launch(projectId: string, request: LaunchAgentRequest): Promise<CommandDto> {
    const answer = await this.proxy.post<CommandEnvelope>(projectId, '/agents', request);
    return answer.command;
  }

  /**
   * Open the sign-in terminal: a PTY running the harness's own first-run onboarding, so an operator
   * can complete the one-time OAuth against the shared credential volume.
   *
   * **A door, not a fallback.** It used to be what a launch answered with when the harness was
   * signed out, which meant nobody could ask for it on purpose and everybody got it by accident.
   * Now the launch refuses and a caller that knows what it was trying to open presses this.
   *
   * Signing in here signs in every container on the volume, which is why one press is enough for the
   * whole platform and why this is not per project in anything but its address.
   */
  async launchLogin(projectId: string, agentType?: AgentType): Promise<CommandDto> {
    const answer = await this.proxy.post<CommandEnvelope>(
      projectId,
      '/agents/sign-in',
      agentType ? { agentType } : {},
    );
    return answer.command;
  }

  /**
   * Signal a running command's process group, and answer it in its post-terminate state.
   *
   * Distinct from *closing a socket*, which only detaches and leaves the agent running — the whole
   * reason collapsing the panel is free.
   */
  async terminate(projectId: string, commandId: string): Promise<CommandDto> {
    const answer = await this.proxy.post<CommandEnvelope>(
      projectId,
      `/commands/${encodeURIComponent(commandId)}/terminate`,
    );
    return answer.command;
  }
}
