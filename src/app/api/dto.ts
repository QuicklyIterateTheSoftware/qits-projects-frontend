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
 * <p>The six below are what it stores today, and its own DTO says the vocabulary may grow. That is
 * why this is not a union: a closed one would make a platform that added a seventh state fail to
 * type against a build of this SPA that is otherwise perfectly able to draw it. Every reader here
 * therefore decides what an unknown word means for itself, the way {@link RepositoryDto}'s
 * archetype is handled — and each of those decisions is stated where it is made.
 *
 * - `PENDING` — created, waiting on the gates for its sha.
 * - `READY` — the gates passed; the worker is about to call the release door.
 * - `RELEASED` — landed, and `version` is the calver it landed as.
 * - `REJECTED` — a gating build went red. The refusal stands until a push re-arms the request.
 * - `FAILED` — the release itself did not go through; `retryable` says whether the sweep keeps
 *   trying it or the refusal stands.
 * - `WITHDRAWN` — the ask is moot. Terminal, and it frees the branch for a fresh request.
 */
export type ReleaseRequestState = string;

/**
 * One release request — the asynchronous ask that replaced calling the release door blind.
 *
 * <p>`commitSha` is what the request is *about*: gates evaluate that commit and what lands is
 * pinned to it, so a new head on the branch re-arms this same row rather than opening a second.
 * That is why the sha is drawn beside the branch and not instead of it.
 *
 * <p>`detail` is the sentence explaining a request that is not simply pending or released, and it
 * is null for the two that are. `version` is null until the door answers with one.
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
  readonly branch: string;
  readonly commitSha: string;
  readonly state: ReleaseRequestState;
  readonly summary: string;
  readonly requester: string | null;
  readonly detail: string | null;
  readonly version: string | null;
  readonly retryable: boolean;
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
