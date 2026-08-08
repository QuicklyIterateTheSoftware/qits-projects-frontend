/**
 * The wire shapes **qits-workspaces** answers with, hand-written and copied field-for-field from the
 * Java records on the other side (`WorkspaceDto` and `WorkspaceController`'s nested request records).
 *
 * <p><b>A second dto file, deliberately not merged into `dto.ts`.</b> That one says, in its own
 * header, that it mirrors qits-projects' records — one service, one taxonomy, one set of envelopes.
 * A `WorkspaceDto` in there would quietly make the file about two services with two envelope
 * conventions and no way for a reader to tell which endpoint a type belongs to. The split *is* the
 * documentation: an import from `./workspaces-dto` is a call across a service boundary.
 *
 * <p>Copied from qits-spa-workspaces rather than shared through a library, which is this codebase's
 * sanctioned pattern for cross-SPA reuse — the same call `project/agent/terminal-socket.ts` and
 * `api/web-socket.ts` already made. The envelopes are genuinely inconsistent between the two
 * services — `{entries: [{workspace: …}]}` here, `{entries: [{repository: …}]}` there — and these
 * interfaces say so rather than pretending otherwise.
 *
 * <p>`Instant` arrives as an ISO-8601 string; every timestamp below is typed as one.
 */

/** A workspace's resolution state. `ACTIVE` is the only one this screen can do anything with. */
export type WorkspaceStatus = 'ACTIVE' | 'INTEGRATED' | 'ABANDONED';

/**
 * The container's runtime state, independent of {@link WorkspaceStatus}: the branch is the source of
 * truth and the container is a recreatable cache of it.
 *
 * It is shown and never gated on. **Both merges read the durable branch, not the container** —
 * qits-workspaces merges from the bare origin's refs — so a STOPPED workspace releases and
 * integrates exactly as well as a RUNNING one, and disabling a button on one would be a fiction.
 */
export type WorkspaceRuntimeStatus = 'RUNNING' | 'STOPPED' | 'PROVISIONING' | 'FAILED';

/**
 * The coding-agent activity rollup, as last reported by the in-container `workspace-daemon`.
 *
 * **`ENDED` arrives, and then ages out.** The registry keeps a finished session's entry for thirty
 * minutes (`qits.workspace.agent-activity.ended-ttl-ms`) and expires it after that, so the rollup
 * answers `ENDED` for half an hour after a session stops and null afterwards. A live report always
 * wins: a resume overwrites the `ENDED` entry.
 */
export type AgentActivityState = 'IDLE' | 'BUSY' | 'WAITING' | 'ENDED';

/**
 * One workspace, as qits-workspaces lists it.
 *
 * `id` is the identifier every route addresses — including the two merge ones. `workspaceId` is the
 * branch-derived *label*: unique only per repository and reusable once the workspace resolves, so it
 * is displayed and never used to address anything.
 *
 * `parent` is the branch this work goes home to, and it is what picks the door: a workspace whose
 * parent is the repository's default branch is **released**, any other workspace is **integrated**
 * into that parent. So the field is not decoration — it decides which action is offered.
 *
 * `branch` is what identifies a *refining* workspace here: the refining workspace of an epic is the
 * ACTIVE workspace on `refining/<epicSlug>` in the project's wrapper repository, and nothing stores
 * that association. See `refiningBranch` in the epics model.
 */
export interface WorkspaceDto {
  readonly id: number;
  readonly workspaceId: string;
  readonly parent: string | null;
  readonly branch: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly conflictsWithParent: boolean;
  readonly status: WorkspaceStatus;
  readonly runtimeStatus: WorkspaceRuntimeStatus | null;
  readonly runtimeError: string | null;
  readonly clean: boolean | null;
  readonly agentActivity: AgentActivityState | null;
  readonly preamble: string | null;
  readonly result: string | null;
  readonly resolvedAt: string | null;
  readonly daemonConnectedAt: string | null;
  readonly daemonVersion: string | null;
  readonly daemonBuildTime: string | null;
  readonly daemonOutdated: boolean | null;
  /** When the row was created. Optional: a deployed service may not answer it yet. */
  readonly createdAt?: string;
}

/** The workspace list envelope: entries, each wrapping the thing it lists. */
export interface WorkspaceEntriesResponse {
  readonly entries: readonly { readonly workspace: WorkspaceDto }[];
}

/** What the single-workspace read answers. */
export interface WorkspaceResponse {
  readonly workspace: WorkspaceDto;
}

/**
 * What creating a workspace takes.
 *
 * **`repositoryId` rides in the body**, unlike the listing's query parameter: a create carries its
 * scope in the payload, and the repository is not a filter on a POST.
 *
 * `id` is the requested *label*, not an identifier — the created workspace's identifier comes back in
 * the answer. Labels are limited to `[A-Za-z0-9_-]` and 64 characters.
 *
 * `parent` blank means the repository's main branch, which the service fills in. `adoptExisting`
 * tells the service to take over a branch that already exists instead of creating one — and with it
 * false, **this call is what creates the branch**: qits-workspaces pushes the new ref through the
 * git host itself (`WorkspaceService.createBranchOnHost`). There is no second branch-creation
 * mechanism, and a client that added one would be racing this one.
 */
export interface CreateWorkspaceRequest {
  readonly repositoryId: string;
  readonly id: string;
  readonly parent: string;
  readonly branch: string;
  readonly preamble: string;
  readonly adoptExisting: boolean;
}

/** What a create answers: the workspace it just made. */
export interface CreateWorkspaceResponse {
  readonly workspace: WorkspaceDto;
}

/**
 * The workspace's currently-running technical process, or null when nothing is running.
 *
 * This is the Starting tab's discovery lookup: an id here means "open the payload-bearing stream at
 * `/technical-processes/{id}/events`", and null means the transient tab is simply not present.
 */
export interface ActiveProcessResponse {
  readonly technicalProcessId: string | null;
}

/**
 * What `ensure-container` and `recreate-container` answer: the workspace as it now stands, plus the
 * process doing the work.
 *
 * The two verbs differ in what they do and not in what they return, which is why one type covers
 * both. The process id is what the Starting tab attaches to without waiting for the `process` hint.
 */
export interface ContainerProcessResponse {
  readonly workspace: WorkspaceDto;
  readonly technicalProcessId: string | null;
}

/** What `discard` answers. One boolean, and the workspace is resolved by the time it arrives. */
export interface DiscardResponse {
  readonly success: boolean;
}

/** One entry in a resolved workspace's narrative: what happened to the branch, and when. */
export interface WorkspaceHistoryEventDto {
  readonly type: string;
  readonly branch: string | null;
  readonly parent: string | null;
  readonly target: string | null;
  readonly commit: string | null;
  readonly note: string | null;
  readonly at: string;
}

/**
 * A resolved workspace, as the history surface serves it.
 *
 * It is the narrative record and **not** a detail view's data: no branch state, no runtime status, no
 * clean flag, no daemon. A discarded refining workspace lands here, which is why the refining page
 * offers to start a fresh one rather than drawing this.
 */
export interface WorkspaceHistoryDetailDto {
  readonly id: number;
  readonly workspaceId: string;
  readonly parent: string | null;
  readonly status: WorkspaceStatus;
  readonly preamble: string | null;
  readonly result: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly events: readonly WorkspaceHistoryEventDto[];
}

/** The history read's envelope. */
export interface WorkspaceHistoryDetailResponse {
  readonly workspace: WorkspaceHistoryDetailDto;
}

/**
 * One frame of a technical process's replayable stream, copied field-for-field from
 * `TechnicalProcessFrame`.
 *
 * Every field but `kind` and `seq` is nullable because one record carries five frame shapes.
 * `segment` is null on `done` and `ping`; `line` is set only on `line`; `status` only on
 * `segment-settled` and `done`; `hint`/`hintTarget` only on a *failed* settle.
 *
 * `seq` is per-subscription and a reconnect replays everything with fresh ordinals — so it orders one
 * connection's frames and is never a resume token. The client rebuilds from scratch on every connect,
 * which is the intended contract rather than a fallback.
 */
export interface TechnicalProcessFrame {
  readonly segment: string | null;
  readonly kind: 'segment-open' | 'line' | 'segment-settled' | 'done' | 'ping';
  readonly seq: number;
  readonly line: string | null;
  readonly status: 'ok' | 'failed' | null;
  readonly hint: string | null;
  readonly hintTarget: string | null;
}

/**
 * The one documented failure classification: the verb hit a remote's auth wall.
 *
 * `hintTarget` names the repository to sign into, and **for a submodule child that is not the root
 * repository** — which is the common case here, because the wrapper is nothing but submodules. So a
 * UI acting on it must use the target it is given rather than the workspace's own repository.
 */
export const HINT_REMOTE_AUTH = 'remote-auth';

/**
 * What both `POST …/{id}/release` and `POST …/{id}/integrate` take. One field, and no target.
 *
 * **The target is not a parameter in either call: it is derived from the workspace.** Release always
 * lands on the repository's default branch, integrate always lands on the workspace's parent branch,
 * and both are facts the service already holds — so a client that could name a target would be
 * describing an API that does not exist.
 *
 * The summary becomes the merge commit's subject, as `release(<version>): <summary>` or
 * `integrate(<branch>): <summary>`, capped at 100 characters on both sides.
 */
export interface MergeRequest {
  readonly summary: string;
}

/** The summary cap, server-side `@Size(max = 100)` and the input's `maxlength` alike. */
export const SUMMARY_MAX_LENGTH = 100;

/**
 * What a successful release answers.
 *
 * All three fields are worth showing and none is derivable from the others: `version` is the stamp
 * just minted (`2026.731.193059` — year, month+day, time), `commitSha` is the merge commit carrying
 * both the merge and the version bump, and `branch` is the source branch that was released, which
 * the merge's parents record as a sha but never as a name.
 */
export interface ReleaseResponse {
  readonly version: string;
  readonly commitSha: string;
  readonly branch: string;
}

/**
 * What a successful integrate answers. **No version** — an integrate stamps none, because it is a
 * merge and not a release.
 *
 * `targetBranch` is the parent the work landed on. It is answered rather than assumed: the client
 * picked this door from the workspace's `parent`, and the service decides where an integrate goes.
 */
export interface IntegrateResponse {
  readonly commitSha: string;
  readonly branch: string;
  readonly targetBranch: string;
}

/** How loud a service event is. Set on the event, never derived from its text. */
export type ServiceEventSeverity = 'INFO' | 'WARNING' | 'ERROR';

/** What a service event reports. One member so far; the wire carries the name, so this is a type. */
export type ServiceEventKind = 'STATUS_CHANGED';

/** The supervisor state a `STATUS_CHANGED` event is reporting. */
export type ServiceEventStatus = 'STARTING' | 'READY' | 'RESTARTING' | 'CRASHED' | 'STOPPED';

/**
 * One durable thing that happened to a service.
 *
 * **This is the only place a browser can see a `CRASHED`.** The live list flattens every terminal
 * state to `STOPPED` — a service that dies leaves the supervisor's map — so the transition survives
 * here and nowhere else a client can reach.
 *
 * **`workspaceId` is the branch-derived label and `workspaceRowId` is the identity**, and the gap is
 * a real trap: the feed's server-side filter takes the *label*, which is unique only among ACTIVE
 * workspaces and is reused once one resolves. The row id is carried so the client can narrow again.
 */
export interface ServiceEventDto {
  readonly repoId: string;
  readonly workspaceId: string;
  readonly workspaceRowId: number | null;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly kind: ServiceEventKind;
  readonly severity: ServiceEventSeverity;
  readonly status: ServiceEventStatus | null;
  readonly summary: string | null;
  readonly logExcerpt: string | null;
  readonly commandId: string | null;
  readonly source: string | null;
  readonly anchorFrom: number | null;
  readonly anchorTo: number | null;
  readonly sourceEpoch: string | null;
  readonly timestamp: string;
}

/** The service-event feed envelope. */
export interface ServiceEventsResponse {
  readonly events: readonly ServiceEventDto[];
}

/** How a bootstrap step's most recent run ended. */
export type BootstrapOutcome = 'SKIPPED' | 'SUCCEEDED' | 'FAILED';

/**
 * The most recent run of one bootstrap step in one workspace.
 *
 * **One row per (workspace, step), overwritten on each run** — a last-run view and never a log.
 * `bootstrapCommandId` is the join key against the daemon's declared chain; `commandId` is null for a
 * `SKIPPED` step, which spawns no command and therefore has no output.
 */
export interface BootstrapRunDto {
  readonly bootstrapCommandId: string;
  readonly commandName: string;
  readonly outcome: BootstrapOutcome;
  readonly commandId: string | null;
  readonly exitCode: number | null;
  readonly ranAt: string;
}

/** The bootstrap-run envelope. */
export interface BootstrapRunsResponse {
  readonly runs: readonly BootstrapRunDto[];
}
