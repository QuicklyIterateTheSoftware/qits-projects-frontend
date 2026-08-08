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

/** Which MCP servers a launch is wired to. `REPOSITORY` is the one that carries the epic tools. */
export type AgentMcpScope = 'ACTIONS' | 'REPOSITORY';

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

  /** Launch a coding agent. The answer is the command to attach a socket to. */
  async launch(projectId: string, request: LaunchAgentRequest): Promise<CommandDto> {
    const answer = await this.proxy.post<CommandEnvelope>(projectId, '/agents', request);
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
