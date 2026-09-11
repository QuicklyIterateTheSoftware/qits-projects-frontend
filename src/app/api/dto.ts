/**
 * The wire shapes this client reads, hand-written and copied field-for-field from the Java records
 * on the other side (`ProjectDto`, `RepositoryDto`, `SyncStatusDto` in qits-projects, plus the
 * request/response records nested inside its controllers).
 *
 * Hand-written rather than generated, deliberately — the same call qits-spa-ci made. The platform
 * generates OpenAPI *documents*, not clients, and every controller here nests its request and
 * response records inside the request type, so a generator names them positionally: qits-projects'
 * committed document already calls the list-projects response `Response19` and one entry `Entry4`.
 * A page written against `Entry4` is worse than one written against the interfaces below, and the
 * total surface is a handful of endpoints.
 */

import type { QitsCategory } from '@qits/ui-components';

/**
 * What a repository is for.
 *
 * The six **placeable** archetypes each name a directory in the wrapper's `.gitmodules` — the
 * archetype layout, `<directory>/<name>` — and a repository the wrapper does not mount somewhere is
 * not part of the project. `PROJECT` is the wrapper itself, `SERVICE_TEMPLATE` and `FORK` are rows
 * that deliberately sit outside any wrapper.
 *
 * <p>Under the **component layout** the directory states no archetype at all, so the two facts come
 * apart: see {@link RepositoryDto.component}.
 */
export type PlaceableArchetype = 'SERVICE' | 'DAEMON' | 'LIBRARY' | 'FRONTEND' | 'CLI' | 'IMAGE';

/** Every archetype the service can answer with, placeable or not. */
export type RepositoryArchetype = PlaceableArchetype | 'PROJECT' | 'SERVICE_TEMPLATE' | 'FORK';

/** One group on the project page: an archetype, the wrapper directory it lands in, and its words. */
export interface ComponentType {
  readonly archetype: PlaceableArchetype;
  /**
   * The directory under the wrapper root in the **archetype layout** — the derivation the server's
   * reconcile also makes there. A component entry is mounted under {@link componentDirectory}
   * instead, and its directory names no archetype.
   *
   * <p>Typed as the chrome's `QitsCategory` because it is the same word: the archetype directory
   * is what the sidebar's legacy groups are called and what a `<category>.details` slot is keyed
   * on. Saying so here is what lets a slot be composed from an archetype without a second table.
   */
  readonly directory: QitsCategory;
  /** The group heading. */
  readonly label: string;
  /** One of them, for “New <singular>”. */
  readonly singular: string;
}

/**
 * The six groups, in display order, and the order is the project's own layout: what it deploys,
 * what runs beside it, what it shares, what it serves, what it hands a person, what it publishes.
 *
 * An archetype missing from this list is not placeable, so it has no group — see
 * `groupComponents` in the project page for where an unknown value goes instead.
 */
export const COMPONENT_TYPES: readonly ComponentType[] = [
  { archetype: 'SERVICE', directory: 'services', label: 'Services', singular: 'service' },
  { archetype: 'DAEMON', directory: 'daemons', label: 'Daemons', singular: 'daemon' },
  { archetype: 'LIBRARY', directory: 'libs', label: 'Libraries', singular: 'library' },
  { archetype: 'FRONTEND', directory: 'frontends', label: 'Frontends', singular: 'frontend' },
  { archetype: 'CLI', directory: 'cli', label: 'Command line', singular: 'CLI tool' },
  { archetype: 'IMAGE', directory: 'images', label: 'Images', singular: 'image' },
];

/**
 * The first segment that marks a wrapper path as the **component layout's**:
 * `components/<component>/<name>`.
 *
 * The server reserves it as a project slug for the same reason the six category words are reserved
 * — it is what the middle segment of a repository address becomes.
 */
export const COMPONENTS_DIRECTORY = 'components';

/** The directory a component entry is mounted under: `components/<component>`. */
export function componentDirectory(component: string): string {
  return `${COMPONENTS_DIRECTORY}/${component}`;
}

/**
 * The archetype as the current taxonomy names it.
 *
 * Release B retired the last legacy values, so every archetype the service answers with is already
 * current and this maps nothing. Anything unrecognised passes through untouched — inventing a group
 * for it would hide it, and so is a **null**, which is the honest answer for a row the wrapper's
 * component layout never told a kind.
 */
export function normalizeArchetype(archetype: null): null;
export function normalizeArchetype(archetype: RepositoryArchetype): RepositoryArchetype;
export function normalizeArchetype(
  archetype: RepositoryArchetype | null,
): RepositoryArchetype | null;
export function normalizeArchetype(
  archetype: RepositoryArchetype | null,
): RepositoryArchetype | null {
  return archetype;
}

/** A project's dns record, or the whole object is null when it registers no domain. */
export interface ProjectDnsRecordDto {
  readonly domain: string;
  readonly type: string;
  readonly value: string;
}

/** A project. `slug` is the immutable git-safe identity; `name` is the editable display one. */
export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dns: ProjectDnsRecordDto | null;
}

/**
 * A repository.
 *
 * `name` is the registered alias — the basename the git host serves it under, and therefore the
 * half of `<directory>/<name>` the wrapper spells. It arrived with release A and it is what retires
 * every SPA's url-basename label hack.
 *
 * <p><b>`backupUrl` is a sync target, never a clone source.</b> A component repository is always
 * cloned from this platform's own git host — that is what the wrapper's relative `../<name>.git`
 * resolves to — and the backup is the twin the platform pushes to automatically, so that the
 * project survives the platform. The distinction is the whole reason the old `url` field is not
 * read here: it was the same string under a name that invited every reader to treat it as where
 * the code comes from, which it never was. It is still on the wire for one release as a deprecated
 * duplicate and is deliberately not declared, so release B's removal costs this client nothing.
 *
 * <p>Null means no backup is configured. After release C's reconcile has healed the rows every
 * repository carries one, so a null is worth showing as an absence rather than explaining away.
 */
export interface RepositoryDto {
  readonly id: string;
  readonly name: string;
  readonly backupUrl: string | null;
  readonly mainBranch: string;
  /**
   * What kind of component this is — the closed taxonomy the archetype-keyed child applications are
   * still selected by.
   *
   * <p><b>Null is a state now.</b> Under the component layout no directory states a kind, so a row
   * the reconcile mints there takes its archetype from the name's role suffix and keeps a null when
   * the name declares none. A null is deliberately not defaulted to anything here: the server does
   * not either, and a guessed kind would pick the wrong child applications.
   */
  readonly archetype: RepositoryArchetype | null;
  /**
   * The technical component this repository is part of — `qits-ci`, the unit a service, its
   * frontend and its daemon share — read from the wrapper path `components/<component>/<name>`.
   *
   * <p>An **open set**, so nothing here validates it. Null for an entry still mounted under an
   * archetype directory, which in a half-flipped project is some rows and not others.
   */
  readonly component: string | null;
  readonly projectId: string;
  readonly lastBackup: BackupAttemptDto | null;
}

/**
 * How the last push to the backup remote went.
 *
 * `AUTH_REQUIRED` is the one outcome with a **cure the reader can apply**, and that is why it is
 * not folded into `FAILED`: the credential store the platform pushes with is shared, so one
 * interactive sign-in fixes every repository at once. `UNREACHABLE` and `FAILED` are reports —
 * a forge that is down, a remote that refuses the ref — and neither is actionable from here.
 */
export type BackupOutcome = 'SUCCEEDED' | 'AUTH_REQUIRED' | 'UNREACHABLE' | 'FAILED';

/** One backup attempt. `at` is an ISO-8601 instant; `detail` carries the server's words, if any. */
export interface BackupAttemptDto {
  readonly outcome: BackupOutcome;
  readonly at: string;
  readonly detail: string | null;
}

/**
 * What a project-wide backup sync accepted: how many repositories were scheduled.
 *
 * A 202, not a 200, and the number is the whole answer — the work happens after the response, so
 * there are no outcomes to report yet. That asymmetry is what shapes the screen: the page cannot
 * await a result, so it re-reads the list a moment later rather than pretending to know.
 */
export interface BackupSyncResponse {
  readonly scheduled: number;
}

/** One line of the wrapper's `.gitmodules`, as the server read it at the wrapper's main tip. */
export interface WrapperEntryDto {
  /** `<directory>/<name>` — the path the submodule is committed at. */
  readonly path: string;
  /** The basename, which is what a repository row is matched by. */
  readonly name: string;
  /** The row this entry resolved to, or null for an entry no row matched — drift. */
  readonly repositoryId: string | null;
}

/**
 * The project's wrapper repository, and what its `.gitmodules` currently says.
 *
 * Null when the project has no wrapper at all, which is a project that cannot be reconciled rather
 * than one that happens to be empty — the two read differently on screen and must not be conflated.
 */
export interface WrapperDto {
  readonly repositoryId: string;
  readonly branch: string;
  readonly entries: readonly WrapperEntryDto[];
}

/**
 * Where an epic stands in its life, as the service stores it.
 *
 * **There is no `DONE` on the wire, and that is on purpose.** Done is read off the features — an
 * `IMPLEMENTATION` epic whose every feature is implemented — so storing it would be a second copy
 * of a fact the tree already carries, free to disagree with it. See `isDone` in the epics model.
 *
 * `REFINING` is the draft phase: everything is still being written. `IMPLEMENTATION` freezes the
 * scope and only the implemented markers move after it. `IMPLEMENTED` is shipped — declared
 * through the transition, which stamps any features and tasks still unmarked. `SUPERSEDED` sent
 * the plan back to the drawing board and names the draft that replaced it. `ABANDONED` is
 * terminal.
 */
export type EpicStatus = 'REFINING' | 'IMPLEMENTATION' | 'IMPLEMENTED' | 'SUPERSEDED' | 'ABANDONED';

/**
 * An epic: the backbone of a change to the platform.
 *
 * An epic may hold features and a feature may hold tasks, so the three together are the plan for a
 * change rather than three unrelated lists. `slug` is the git-safe identity the branch convention
 * is composed from; `title` is the editable display one. `createdAt` and `updatedAt` are ISO-8601
 * instants.
 *
 * There is **no completion field** here, and that shapes what a status badge can honestly say —
 * see `epicStatus` in the epics model.
 */
export interface EpicDto {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly status: EpicStatus;
  /** The draft that replaced this one. Set only on a `SUPERSEDED` epic; null on every other. */
  readonly supersededByEpicId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What a transition came to: the epic in its new state, and the draft it spawned.
 *
 * `successor` is a second row, not a field of the first, because superseding **creates** an epic —
 * a fresh `REFINING` copy of the frozen scope. Every other transition answers a null there, so a
 * caller that assumed a successor would invent one for an abandonment.
 */
export interface EpicTransitionResponse {
  readonly epic: EpicDto;
  readonly successor: EpicDto | null;
}

/**
 * A feature under an epic. `dependsOnFeatureId` names a sibling that has to land first.
 *
 * <p><b>Completion is `implementedOn` here and `implementedAt` on a task.</b> That is what the wire
 * says, so it is what this file says. Renaming one on the way in would leave every reader of this
 * client believing in a field no response carries, and the inconsistency is the service's to
 * settle — not this client's to paper over.
 */
export interface FeatureDto {
  readonly id: string;
  readonly epicId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dependsOnFeatureId: string | null;
  /** ISO-8601 instant, or null while the feature is open. The task's twin is `implementedAt`. */
  readonly implementedOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A task under a feature, in one repository. Completion is `implementedAt` — see {@link FeatureDto}. */
export interface TaskDto {
  readonly id: string;
  readonly featureId: string;
  readonly repositoryId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dependsOnTaskId: string | null;
  /** ISO-8601 instant, or null while the task is open. The feature's twin is `implementedOn`. */
  readonly implementedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** projects' list envelope: entries, each wrapping the thing it lists. */
export interface ProjectEntriesResponse {
  readonly entries: readonly { readonly project: ProjectDto }[];
}

/**
 * The same envelope one level down, plus the wrapper the rows are supposed to agree with.
 *
 * <p>`declared` is false for exactly one state: a **component row no wrapper entry names**. That is
 * the row the reader has to decide about — the row says it belongs to the project and the project's
 * configuration does not. Everything else is true, including the wrapper itself, an archetype no
 * component directory takes, and every row in a project whose wrapper is missing or empty, because
 * none of those is a disagreement anybody can act on.
 *
 * <p>The flag is the server's answer, not a hint: it resolves an entry to a row by id and then by
 * name, the same order the reconcile does. A client recomputing it from `wrapper` would be a second
 * implementation of that rule, free to disagree with the one that matters.
 */
export interface RepositoryEntriesResponse {
  readonly entries: readonly { readonly repository: RepositoryDto; readonly declared: boolean }[];
  readonly wrapper: WrapperDto | null;
}

/**
 * The same envelope at each level of the plan, and **the entry key is the level's own name**:
 * `epic`, then `feature`, then `task`. They are mirrored one by one rather than folded into a
 * generic wrapper, because the key is the part a generic type would have to guess.
 */
export interface EpicEntriesResponse {
  readonly entries: readonly { readonly epic: EpicDto }[];
}

/** One epic's features. */
export interface FeatureEntriesResponse {
  readonly entries: readonly { readonly feature: FeatureDto }[];
}

/** One feature's tasks. */
export interface TaskEntriesResponse {
  readonly entries: readonly { readonly task: TaskDto }[];
}

/**
 * What a ticket is about: something that is broken, or something that could be better.
 *
 * Two values and no more, because the distinction has to be one a reporter can make without
 * thinking. A third kind — "task", "chore", "question" — would be a taxonomy this platform has no
 * use for: the plan is the epics, and a ticket is the small thing beside it.
 */
export type TicketType = 'BUG' | 'IMPROVEMENT';

/**
 * Whether a ticket is still asking for something.
 *
 * Deliberately two values where {@link EpicStatus} has five. An epic has a *life* — drafted,
 * frozen, shipped, replaced — and each phase changes what may be done to it. A ticket is one
 * question, so it is answered or it is not, and `RESOLVED` covers "fixed", "done" and "we are not
 * doing this" alike: what actually happened is in the comments, which is where a sentence belongs.
 */
export type TicketStatus = 'OPEN' | 'RESOLVED';

/**
 * A ticket: one small, self-contained piece of work, beside the plan rather than inside it.
 *
 * <p>Project-scoped like an epic, and holding nothing under it — no features, no tasks, no
 * dependencies. That is the whole difference and it is what makes the two worth having separately:
 * an epic is read as a *tree* and a ticket is read as a *row*, so a ticket that grew children would
 * be an epic that had not noticed.
 *
 * <p>`slug` is the git-safe identity, and it is what the detail address is spelled with — the same
 * convention the epics' refining route uses, for the same reason: it is immutable where the title
 * is not, so a link stays pointing at the ticket it was made for after a retitle.
 *
 * <p>`assignee` is **free text and nullable**, not a reference to anything. This platform has no
 * user directory to point at, so a name here is a note about who is looking at it rather than a
 * foreign key — and `null` means nobody has said, which is a different fact from an empty string.
 *
 * <p>`createdBy` is stamped server-side from the session principal and is never sent by a client.
 * Null is a row written before there was a principal to stamp, or by one the service could not
 * name; it draws as the dash, not as an empty byline.
 */
export interface TicketDto {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly type: TicketType;
  readonly status: TicketStatus;
  /** Free text — whoever is looking at it. Null when nobody has said. */
  readonly assignee: string | null;
  /** Stamped from the session, never sent. Null for a row with no principal behind it. */
  readonly createdBy: string | null;
  /** Markdown, like every description on this service. Null when nothing was written. */
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One thing somebody said about a ticket.
 *
 * <p>`body` is markdown and is **not** nullable: a comment with nothing in it is not a comment, so
 * the service refuses one rather than storing a row that draws as blank space.
 *
 * <p>`author` is the same server-stamped, nullable field {@link TicketDto.createdBy} is, and for the
 * same reason. `updatedAt` moving past `createdAt` is the only record that a comment was edited —
 * there is no revision history and no `edited` flag, so the two timestamps together are what the
 * "edited" hint is derived from.
 */
export interface TicketCommentDto {
  readonly id: string;
  readonly ticketId: string;
  /** Stamped from the session, never sent. Null for a comment with no principal behind it. */
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One project's tickets, in the same entries envelope every list on this service uses — and with
 * the level's own name as the entry key, exactly as `epic`, `feature` and `task` are.
 *
 * The server sorts these **createdAt ascending**. The overview re-orders them itself rather than
 * asking for another sort: the two sections it draws want newest-first, and a client that trusted
 * an order it did not impose would silently draw the wrong one the day the server's changed.
 */
export interface TicketEntriesResponse {
  readonly entries: readonly { readonly ticket: TicketDto }[];
}

/** One ticket, wrapped — what every single-row write and read answers. */
export interface TicketResponse {
  readonly ticket: TicketDto;
}

/** One ticket's comments, oldest first, which is the order a conversation is read in. */
export interface TicketCommentEntriesResponse {
  readonly entries: readonly { readonly comment: TicketCommentDto }[];
}

/** One comment, wrapped — the answer to a post and to an edit. */
export interface TicketCommentResponse {
  readonly comment: TicketCommentDto;
}

/**
 * Whether a coding agent was actually started on the workspace a dispatch landed in.
 *
 * <p>`SKIPPED_RUNNING` is a success, not a refusal: the workspace already had an agent working in
 * it, and starting a second one would put two of them on the same branch. The two words exist so a
 * reader can be told which happened — the workspace is worth opening either way.
 */
export type TicketAgentLaunch = 'SCHEDULED' | 'SKIPPED_RUNNING';

/**
 * Where dispatching an agent onto a ticket put it: which workspace, on which repository's which
 * branch, and whether an agent was started there.
 *
 * <p><b>`workspaceRowId` is a number and `repositoryId` is a string</b>, which is qits-workspaces'
 * own split rather than an inconsistency here: a workspace is keyed by a row id in that service's
 * database, a repository by the id this service assigns. Both are carried through exactly as the
 * wire spells them, because together they are the address of the workspace in qits-workspaces —
 * `repositories/{repositoryId}/workspaces/{workspaceRowId}`.
 *
 * <p><b>`fresh` says the workspace was created for this press</b>; false is the find-or-create path
 * answering with the workspace a previous press left behind. Nothing on screen has to branch on it
 * — the link is the same either way — but it is the difference between "a container is starting"
 * and "the container is already there", which is why the door states it.
 *
 * <p><b>Nothing here is stored on the ticket.</b> The service keeps no queryable record of a
 * dispatch, so this shape is the *answer to one press* and not a field a later read brings back: a
 * page that reloads has no way to ask where the last agent went. Pressing again is idempotent —
 * find-or-create lands in the same workspace — so the cure for a lost link is another press.
 */
export interface TicketAgentDispatchDto {
  readonly workspaceRowId: number;
  readonly repositoryId: string;
  /** The branch the workspace is on — the ticket's own, as the service names it. */
  readonly branch: string;
  /** Whether this press created the workspace, rather than re-entering one that was there. */
  readonly fresh: boolean;
  readonly agentLaunch: TicketAgentLaunch;
}

/** One dispatch, wrapped — the whole answer to `POST /tickets/{id}/dispatch-agent`. */
export interface TicketAgentDispatchResponse {
  readonly dispatch: TicketAgentDispatchDto;
}

/**
 * Whether a coding agent was actually started on the workspace an epic's dispatch landed in — the
 * same two words {@link TicketAgentLaunch} carries, and read the same way.
 *
 * <p>A name of its own rather than a re-export, because the two doors are two flows and a shape
 * called `Ticket…` inside an epic's answer would say the wrong thing about where it came from. That
 * is the service's own stance on the record — {@code EpicAgentDispatchDto} is a separate record
 * beside {@code TicketAgentDispatchDto} for the same reason — and it is mirrored here rather than
 * flattened out.
 */
export type EpicAgentLaunch = 'SCHEDULED' | 'SKIPPED_RUNNING';

/**
 * Where "Start implementation" put an agent: which workspace, on which repository's which branch,
 * and whether an agent was started there.
 *
 * <p>The five fields are {@link TicketAgentDispatchDto}'s, and everything that note says about the
 * `workspaceRowId`/`repositoryId` split and about `fresh` holds here word for word. Two things are
 * different, and both are about the press rather than the shape.
 *
 * <p><b>The branch is the epic's, on the project's wrapper.</b> `epic/<slug>` over the whole estate,
 * not a component's repository: an epic's tasks name repositories one each and the epic itself names
 * none, so the aggregate workspace is the only honest answer.
 *
 * <p><b>`agentLaunch` matters more here, because the press is re-pressable by design.</b> An epic
 * already in IMPLEMENTATION is dispatched onto as it stands, and the far side then adopts the
 * workspace already on `epic/<slug>` and answers `SKIPPED_RUNNING` rather than starting a second
 * agent. That is a success, and it is the reason a second press is also the retry for a dispatch
 * that failed after the status had already moved.
 *
 * <p><b>Nothing here is stored on the epic</b>, exactly as nothing is stored on a ticket: this is the
 * answer to one press, so a reload forgets where the last agent went and the cure is another press.
 */
export interface EpicAgentDispatchDto {
  readonly workspaceRowId: number;
  readonly repositoryId: string;
  /** The branch the workspace is on — `epic/<slug>` on the wrapper, as the service names it. */
  readonly branch: string;
  /** Whether this press created the workspace, rather than re-entering one that was there. */
  readonly fresh: boolean;
  readonly agentLaunch: EpicAgentLaunch;
}

/** One dispatch, wrapped — the whole answer to `POST /epics/{id}/dispatch-agent`. */
export interface EpicAgentDispatchResponse {
  readonly dispatch: EpicAgentDispatchDto;
}

/**
 * Create a repository in a project: **exactly one** of `url` and `name`.
 *
 * The two are the two flows, not two spellings of one. `name` is a repository born blank on the
 * platform git host and seeded from the skeleton; `url` is an existing repository elsewhere,
 * cloned and adopted. Sending both, or neither, is a 400 — so the page's mode toggle is what
 * decides which field is on the request, and the other is simply absent.
 */
export interface CreateRepositoryRequest {
  readonly url?: string;
  readonly name?: string;
  readonly archetype: PlaceableArchetype;
  /**
   * The component to mount the entry under, or absent to let the wrapper's own layout decide.
   *
   * <p>Stating one places the submodule at `components/<component>/<name>`, whatever layout the
   * wrapper is in — so it is also how a project starts its flip. Stating none lands under the
   * archetype's directory, unless the wrapper already mounts anything under `components/`, and
   * then the server places it at `components/<name>/<name>`. **The wrapper has the last word**, and
   * the row's component is read back off the path the commit used.
   */
  readonly component?: string;
}

/** What creation came to: the row, its project, and where it landed in the wrapper. */
export interface CreateRepositoryResponse {
  readonly repository: RepositoryDto;
  readonly projectId: string;
  readonly wrapperPath: string;
}

/**
 * What the reconcile did with one wrapper entry, or with one row the wrapper no longer names.
 *
 * `SYNC_TARGET_UPDATED` is release C's: the row matched and stayed, and what changed is where the
 * platform pushes its backup to. It is a sibling of `ARCHETYPE_UPDATED` — both are "kept, but one
 * field of it is now right" — and it is the outcome that heals rows whose backup url was never
 * recorded. `COMPONENT_UPDATED` is the third of that family and the one the wrapper flip produces:
 * the submodule moved to `components/<component>/<name>`, so the row gained a component and kept
 * everything else. Without it a whole flip would read as a reconcile that did nothing.
 *
 * `UNDECLARED` is a **report, and nothing more**. The reconcile used to delete such a row; it does
 * not, because only a reader can tell a repository dropped from the wrapper by mistake from one
 * that should go, and the reconcile guessed wrong in the direction that loses work. Deleting it is
 * a button on its own card now.
 */
export type ReconcileOutcome =
  | 'CREATED'
  | 'ADOPTED'
  | 'KEPT'
  | 'ARCHETYPE_UPDATED'
  | 'COMPONENT_UPDATED'
  | 'SYNC_TARGET_UPDATED'
  | 'UNDECLARED'
  | 'SKIPPED';

/**
 * One line of the reconcile's answer, and **every field but `outcome` can be null**.
 *
 * The nulls are the shape of the three things a line can be about, so a renderer that assumed a
 * path would print `null` on two of them:
 *
 * - a wrapper entry: `path` is `<directory>/<name>` or `components/<component>/<name>`, `name` is
 *   what `../<name>.git` resolves to;
 * - an **undeclared row**: no entry named it, so there is no path — `name` is the row's alias and
 *   `repositoryId` the row that is still there, reported rather than removed;
 * - the **empty-manifest** answer: a wrapper declaring no submodules is answered with a single
 *   `SKIPPED` line carrying neither path nor name, because calling every component undeclared on
 *   the strength of a file that is not there would report the whole project as drift.
 *
 * `warning` is why an outcome is what it is, when the outcome does not say it — and it rides
 * **per entry**. There is no list of warnings beside the entries: a warning belongs to the line it
 * explains, and a page showing them apart could not say which path was skipped for which reason.
 */
export interface ReconcileEntryDto {
  readonly path: string | null;
  readonly name: string | null;
  readonly repositoryId: string | null;
  readonly archetype: RepositoryArchetype | null;
  /** The component the path mounted the entry under, or null under the archetype layout. */
  readonly component: string | null;
  readonly outcome: ReconcileOutcome;
  readonly warning: string | null;
}

/**
 * The wrapper reconcile's answer: which wrapper was read, and what became of every line in it.
 *
 * A per-entry failure is still a 200 — the outcomes *are* the result. The two error codes are about
 * the request instead: 404 for no such project, 400 for a project with no wrapper to reconcile
 * against, which is why the panel only offers the button when there is one.
 */
export interface WrapperReconcileResponse {
  readonly projectId: string;
  readonly wrapperRepositoryId: string;
  readonly branch: string;
  readonly entries: readonly ReconcileEntryDto[];
}

/** What re-asserting a project's dns record came to. `NOT_CONFIGURED` is not a failure. */
export type DomainOutcome = 'REGISTERED' | 'NO_MATCHING_ZONE' | 'NOT_CONFIGURED' | 'FAILED';

/** The dns reconcile's answer. A failed re-assertion is still a 200 — the outcome is the result. */
export interface ProjectReconcileResponse {
  readonly domain: DomainOutcome;
  readonly domainDetail: string | null;
}

/**
 * A repository's main branch measured against its remote with a read-only `ls-remote`.
 *
 * `ahead` and `behind` are null when they cannot be counted without fetching objects, which is a
 * third answer rather than zero — "we did not look" and "there is nothing" are different sentences.
 */
export interface SyncStatusDto {
  readonly branch: string;
  readonly remoteReachable: boolean;
  readonly remoteExists: boolean;
  readonly ahead: number | null;
  readonly behind: number | null;
}

/**
 * Where a release request has got to — the service's stored word, **as a plain string**.
 *
 * <p>The seven below are what it stores today, and its own DTO says the vocabulary may grow. That is
 * why this is not a union: a closed one would make a platform that added an eighth state fail to
 * type against a build of this SPA that is otherwise perfectly able to draw it. Every reader here
 * therefore decides what an unknown word means for itself, the way {@link RepositoryDto}'s
 * archetype is handled — and each of those decisions is stated where it is made.
 *
 * - `PENDING` — created, waiting on the gates for the fold's sha.
 * - `READY` — the gates passed; the worker is about to call the release door.
 * - `RELEASED` — landed, and `version` is the calver it landed as.
 * - `REJECTED` — a gating build went red. The refusal stands until a push re-arms the request.
 * - `CONFLICTED` — the sources cannot be folded; `conflict` says which paths and whose head. The
 *   service does *not* re-fold one on its sweep, so it stands until a push changes the content.
 * - `FAILED` — the release itself did not go through; `retryable` says whether the sweep keeps
 *   trying it or the refusal stands.
 * - `WITHDRAWN` — the ask is moot. Terminal, and it frees the sources for a fresh request.
 */
export type ReleaseRequestState = string;

/**
 * What kind of thing a source is.
 *
 * <p>Closed where {@link ReleaseRequestState} is open, and the difference is not an oversight: the
 * service's state javadoc says its vocabulary may grow, its source javadoc enumerates exactly these
 * two and says what distinguishes them. Nothing here switches on the word anyway — `implicit` is
 * what the drawing turns on — so a third kind arriving would still render; it would only fail to
 * type in code that names it.
 */
export type ReleaseRequestSourceKind = 'BRANCH' | 'RELEASED_TAG';

/**
 * One participant of a release request — what is being folded into the request's backing branch.
 *
 * <p>Two kinds travel in one shape and `implicit` tells them apart. A `BRANCH` with `implicit` false
 * is a branch somebody put on the request (`main` is on every request, because creating one implies
 * it). A `RELEASED_TAG` with `implicit` true is a release of the same repository that has not
 * reached `main` yet: derived, never caller-managed — it joins every open request of the repository
 * the moment a sibling releases and leaves them all when that tag is merged. That is why the two are
 * drawn differently and only the named ones can be reasoned about as somebody's choice.
 *
 * <p>`ref` is the fully qualified name the git host is given (`refs/heads/main`,
 * `refs/tags/2026.903.1`); `name` is the same thing as a person spells it, and is what is shown.
 */
export interface ReleaseRequestSourceDto {
  readonly kind: ReleaseRequestSourceKind;
  readonly name: string;
  readonly ref: string;
  readonly implicit: boolean;
  /**
   * How urgent this branch is — `LOWEST`, `LOW`, `MEDIUM`, `HIGH`, `HIGHER` or `BLOCKING`, declared
   * when the branch is put on the request and re-declarable while the request is open. `MEDIUM` is
   * what a branch has when nobody said anything.
   *
   * <p>**Absent on the implicit `RELEASED_TAG` sources**, which are derived rows the service never
   * persists and so has no priority to answer for — and absent on every answer from a service build
   * older than the field, which is the ordinary case while this SPA is ahead of the service it is
   * served by. Neither is `MEDIUM`, which is why this is optional rather than defaulted.
   *
   * <p>A plain string, exactly as `state` is: the service's vocabulary may grow and a word this
   * build has never heard of should still be drawn rather than fail to type.
   */
  readonly priority?: string;
}

/** One path the fold could not resolve, with the participant that introduced it. */
export interface ConflictedPathDto {
  readonly path: string;
  /** The source as it was spelled to the git host — `refs/heads/feature/x`, `refs/tags/2026.903.1`. */
  readonly head: string;
  readonly headSha: string;
  /** The git host's own word for the kind of conflict (`content`, and the merger's own reasons). */
  readonly reason: string;
}

/**
 * Why a `CONFLICTED` request could not be folded — the git host's answer, forwarded rather than
 * reworded. Null on every request that is not `CONFLICTED`, and cleared by the first fold that
 * succeeds.
 */
export interface MergeConflictDto {
  /** The ref the fold was being made onto — the request's backing branch. */
  readonly target: string;
  readonly conflicts: readonly ConflictedPathDto[];
}

/**
 * One release request — the asynchronous ask that replaced calling the release door blind.
 *
 * <p><b>A request is a merge of `sources`, not a branch head.</b> `backingBranch` is `release/<id>`,
 * the ref the git host folds them into, and `mergedSha` is the tip of that fold: what the gates
 * evaluate and what an execution is pinned to. A new head on any source re-folds this same row
 * rather than opening a second one, which is why the sha is drawn beside the sources and not instead
 * of them.
 *
 * <p>`mergedSha` is **null until the first fold lands**, and null on a `CONFLICTED` request whose
 * first fold never did. That reads as "nothing is gated yet" and never as "nothing to release",
 * which is why it is drawn as the em dash rather than left out.
 *
 * <p>`detail` is the sentence explaining a request that is not simply pending or released, and it
 * is null for the two that are. `version` is null until the door answers with one.
 *
 * <p>`releasedSha` is what the tag points at, and it is **not** `mergedSha`: the release commits the
 * rewritten manifests on top of the fold and tags that commit, so the two are a parent and its
 * child. It is the sha to open the release with in the code browser. Null on everything that has not
 * released, and null on a release made before the service recorded the column — a link built from it
 * is therefore dropped rather than drawn, while the one built from `version` still works.
 *
 * <p>`mergedToMainAt` is the end of the lifecycle and the only place it is visible: a release is a
 * tag and `main` is finalized after the deployment succeeds, so a `RELEASED` request with a
 * `version` and no `mergedToMainAt` shipped and has not reached `main` yet. Null on everything that
 * has not released, where there is nothing to have reached `main`.
 */
export interface ReleaseRequestDto {
  readonly id: string;
  readonly repoId: string;
  /**
   * The repository's public name, or null where it has none. A list scoped to one repository has no
   * use for it — the address already says which — but the project-wide list has nothing else to name
   * a row with, and an opaque id is not a name. The service resolves it live there, so a repository
   * renamed since the ask is drawn as it is addressed now.
   */
  readonly repoName: string | null;
  readonly backingBranch: string;
  readonly sources: readonly ReleaseRequestSourceDto[];
  readonly mergedSha: string | null;
  readonly state: ReleaseRequestState;
  readonly summary: string;
  readonly requester: string | null;
  /**
   * **Nobody is waiting on this request.** Derived by the service, never stored: true where the
   * `requester` is one of the platform's machine identities — a maintenance bump asked for the
   * release and stopped — and it is the difference between a `REJECTED` request somebody is
   * answering and one that is simply stuck with no reader. A list that draws both as "rejected" is
   * how a repository stops moving for four hours without anybody noticing.
   *
   * <p>It says who asked and **not** what state the request is in, so it is true on a healthy
   * pending bump as well. The badge is the two read together; see `unattendedBadge`.
   *
   * <p>Optional so an answer from a build older than the field is drawn as "not unattended" rather
   * than as `undefined`.
   */
  readonly unattended?: boolean;
  /**
   * The bug ticket filed because this request's gate went red with nobody watching, or null where
   * there is none. Null for ever on a request a person opened.
   */
  readonly gateTicketId?: string | null;
  readonly detail: string | null;
  /**
   * **Whether a person has to sign this release off** — the second gate, beside the build gate. A
   * green build is not enough on a repository whose releases are approved (today the project
   * wrapper): the request stays `PENDING` until somebody says yes.
   *
   * <p>Derived by the service from the repository's archetype and never stored on the request, which
   * is what makes a policy change reach the requests that are already open. Optional here for the
   * ordinary reason every field on this DTO is: this SPA ships ahead of the service that grew it, and
   * an answer from a build older than the field must read as "no approval gate" — which is exactly
   * what `undefined` means to every reader below, none of which draws an approval affordance without
   * a `true`.
   */
  readonly approvalRequired?: boolean;
  /**
   * Where the approval gate stands: `NOT_REQUIRED`, `WAITING`, `APPROVED` or `DECLINED`.
   *
   * <p>A plain string rather than a union, the same three-valued honesty `state` and `priority` are
   * typed with and for the service's own stated reason: the vocabulary may grow, and a build of this
   * SPA that cannot type a fifth word would fail to draw a request it is otherwise perfectly able to
   * show.
   *
   * <p>**It is an answer about the request's CURRENT `mergedSha`.** An approval is a statement about
   * content, so a push that re-folds the request moves it back to `WAITING` with no state to clear —
   * the decision below simply no longer names the fold the request is on.
   */
  readonly approvalState?: string;
  /**
   * Who made the current decision, when, and what they said about it — **null together** where there
   * is none: a repository nobody has to ask, a fold nobody has judged, and a fold whose decisions
   * were all made against a sha the request has since moved past, which are one answer on purpose.
   *
   * <p>They carry whichever decision is current, **a decline included**. `approvalState` already
   * says which it was, so a second neutral trio beside these would be two sets of the same three
   * fields and one of them would be read while the other was missed.
   */
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly approvalNote?: string | null;
  readonly conflict: MergeConflictDto | null;
  readonly version: string | null;
  readonly releasedSha: string | null;
  readonly mergedToMainAt: string | null;
  readonly retryable: boolean;
  /**
   * The request's **effective** priority: the highest of its named branches', which is the whole of
   * how a request comes to have one — the value is declared on the participants and the request's is
   * derived. A late escalation on one branch therefore raises the request, and nothing lowers it
   * while that branch is still on it.
   *
   * <p>Absent where the service has none to give: an answer from a build older than the field. The
   * implicit released tags are excluded from the max, so a request folding nothing but tags has no
   * priority either.
   *
   * <p><b>Nothing acts on it yet.</b> qits-ci does not reorder its queue by it and qits-deployments
   * records it without deploying differently; it is carried and displayed, and the ordering is a
   * feature of its own.
   */
  readonly priority?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One repository's release requests, newest first — the service sorts, this SPA does not re-sort. */
export interface ReleaseRequestsResponse {
  readonly requests: readonly ReleaseRequestDto[];
}

/** The single-request envelope, which the create, the read and the withdraw all answer with. */
export interface ReleaseRequestResponse {
  readonly request: ReleaseRequestDto;
}

/**
 * One CI run's terminal verdict about one commit, as qits-projects forwards it.
 *
 * <p>`status` is **qits-ci's own word** — `SUCCESS`, `FAILED`, `TIMED_OUT` and `CONFIG_ERROR`
 * today — and it is a plain string for the reason every open vocabulary on this file is: the
 * publisher owns it, it may grow, and a word this build has never heard of should be drawn as
 * itself rather than fail to type or be guessed into a colour. Only `SUCCESS` is read as a pass
 * anywhere in this SPA; everything else is drawn as a refusal, which is the safe direction for a
 * word nobody here knows.
 *
 * <p>`gating` is whether this run's verdict is one the release gate actually waits on. It is not
 * decoration: a repository runs pipelines that have nothing to do with releasing, and a red one of
 * those is a fact worth showing and **not** a reason a release is stuck. A panel that drew the two
 * alike would send somebody to fix a build that was never blocking anything.
 *
 * <p>`finishedAt` is always set, because only terminal runs are answered here — a queued or running
 * build does not appear at all, which is why an empty list means "no verdict yet" and never "no
 * run".
 */
export interface CommitBuildStatusDto {
  /** qits-ci's own run id — the coordinate its `runs/:runId` page is addressed by. */
  readonly runId: string;
  readonly status: string;
  /** The branch the run was made on, which for a release request is its backing branch. */
  readonly branch: string;
  readonly gating: boolean;
  readonly finishedAt: string;
}

/**
 * Every verdict recorded for one commit, **newest first** — the service's order, which this SPA
 * keeps rather than re-sorts.
 *
 * <p>The list is deliberately not reduced to a single word on the service side, and this SPA does
 * not reduce it either: a fold can be built more than once (a re-run, a second pipeline, a gating
 * and a non-gating recipe over the same sha), and "the" status of a commit is a summary that hides
 * exactly the run somebody is looking for. Each verdict is drawn as its own line, with its own link
 * into qits-ci.
 */
export interface ListCommitBuildsResponse {
  readonly builds: readonly CommitBuildStatusDto[];
}

/**
 * One commit a release request's fold brought in — the service's `CommitDto`, which every git read
 * on this surface answers with.
 *
 * `files` is empty for a merge commit, which git omits under `--name-only`; that is not "changed
 * nothing" and is drawn as nothing rather than as a count of zero.
 */
export interface ReleaseRequestCommitDto {
  readonly hash: string;
  /** git's own abbreviation. The full `hash` travels beside it for anything worth pasting. */
  readonly shortHash: string;
  readonly author: string;
  readonly email: string;
  /** The committer date, strict ISO-8601 (git `%cI`). */
  readonly date: string;
  /** The subject line, which is all a list wants. */
  readonly message: string;
  readonly files: readonly string[];
}

/**
 * What a release request folded in: the range `mergedSha^1..mergedSha`, which is exactly what its
 * sources contributed over the branch they were folded onto.
 *
 * <p>**The fold itself leads the list**, because a range ending at a commit contains it — its
 * message is the request's own summary, which reads as the newest thing in the release and is.
 *
 * <p>**An empty list is never an error**, and `detail` is the whole of the difference between the
 * three ways it happens: nothing has been folded yet, the fold is no longer in the repository's
 * history (a withdrawn request's backing branch is deleted, and history predating the mirror was
 * never there), or the fold genuinely brought nothing in. A page that drew "no commits" for all
 * three would be saying something false in two of them.
 */
export interface ReleaseRequestCommitsResponse {
  readonly mergedSha: string | null;
  readonly commits: readonly ReleaseRequestCommitDto[];
  readonly detail: string | null;
}

/**
 * One file a fold touched — the service's `CommitFileChangeDto`, spelled as it arrives.
 *
 * <p>`oldPath` is non-null only for a rename or a copy, and it is the one fact a rename's empty
 * patch cannot state for itself. The shared change tree calls the same field `previousPath`; the
 * mapping is done where the tree is drawn, because this file's job is to say what the wire says.
 */
export interface CommitFileChangeDto {
  readonly path: string;
  readonly oldPath: string | null;
  readonly changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'TYPE_CHANGED';
}

/**
 * What a release request's fold **changed** — the files, beside the commits, and the answer to
 * "what does this release actually do to the tree".
 *
 * <p><b>The base is the service's arithmetic and never the client's.</b> It is the newest release
 * tag that does not contain the fold, resolved to one commit; `baseTag` is the tag it was resolved
 * *from*, which is what a page says out loud ("since 2026.910.180413") because a reader knows
 * releases by version and not by sha. `baseTag` is null exactly when `base` is — a repository that
 * has never released is diffed against the empty tree, which is honestly what its first release
 * adds.
 *
 * <p><b>An empty list is an answer, and `detail` is the whole of the difference between the ways it
 * happens</b>: nothing folded yet, a fold no longer in the repository's history, a fold that
 * genuinely changed nothing over the previous release — or, with `truncated`, a list cut at the cap
 * with the sentence naming the true total. A page that drew "no changes" for all four would be
 * saying something false in three of them.
 */
export interface ReleaseRequestChangesResponse {
  readonly mergedSha: string | null;
  readonly base: string | null;
  readonly baseTag: string | null;
  readonly files: readonly CommitFileChangeDto[];
  readonly truncated: boolean;
  readonly detail: string | null;
}

/**
 * One file's unified diff, against whatever base the read it came from used.
 *
 * <p><b>An empty `diff` is an answer, not a failure</b>: git emits no patch for a binary change and
 * none for a pure rename, and the service declines to send one over roughly a mebibyte. The viewer
 * says so in a sentence rather than drawing a blank pane, which is why this shape carries the empty
 * string rather than a null.
 */
export interface CommitFileDiffDto {
  readonly path: string;
  readonly changeType: CommitFileChangeDto['changeType'];
  readonly diff: string;
}

/**
 * One thing a release published, in the platform's own vocabulary.
 *
 * <p>`type` is the release recipe's word — `docker`, `maven`, `npm`, `docs`, `daemon` — plus
 * `userflows`, which the service derives rather than reads. It is deliberately a plain string: a
 * kind this build has never heard of still arrives, and the rule here is to name it and offer no
 * link rather than to guess an address for it.
 *
 * <p>`version` is **not always the release's calver**: the userflow bundle is published at the
 * fold's sha, because its pipeline runs per release request.
 */
export interface ReleaseArtifactDto {
  readonly type: string;
  readonly name: string;
  readonly version: string;
}

/**
 * What one release put on the platform, read out of the released tag's own tree.
 *
 * <p>`deployable` is whether that tree declares `.config/qits/deployments.yml` — the platform's own
 * statement that something deploys this repository, and the whole of what tells a service apart from
 * a library. It is what the link to the deployment request is offered on: a library has no
 * deployment to look at.
 *
 * <p>**Every failure is a 200 with a sentence.** A request that has not released, a git host that
 * cannot be asked and a recipe that will not parse all answer here rather than by status code,
 * because this read draws a panel and "we could not ask" is a thing the panel can say. A repository
 * that declares no recipe published nothing and gets `detail: null` — publishing nothing is an
 * answer, and every SPA is in that case.
 */
export interface ReleaseArtifactsResponse {
  readonly version: string | null;
  readonly releasedSha: string | null;
  readonly deployable: boolean;
  readonly artifacts: readonly ReleaseArtifactDto[];
  readonly detail: string | null;
}
