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
 * The seven **placeable** archetypes each name a directory in the wrapper's `.gitmodules` — the
 * archetype layout, `<directory>/<name>` — and a repository the wrapper does not mount somewhere is
 * not part of the project. `PROJECT` is the wrapper itself, `SERVICE_TEMPLATE` and `FORK` are rows
 * that deliberately sit outside any wrapper.
 *
 * <p>`APP` and `FRONTEND` are two different things and the pair is the reason `APP` exists. An
 * `-app` is a **standalone web application**: its own server, its own image, its own deployment,
 * reached at its own host. A `-frontend` is a **microfrontend** — it ships no image and no
 * deployment of its own, because a service carries it inside its image and serves it. Neither one
 * is a variant of the other, so they are two archetypes and two groups.
 *
 * <p>Under the **component layout** the directory states no archetype at all, so the two facts come
 * apart: see {@link RepositoryDto.component}.
 */
export type PlaceableArchetype =
  'SERVICE' | 'DAEMON' | 'LIBRARY' | 'APP' | 'FRONTEND' | 'CLI' | 'IMAGE';

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
   * <p>Typed as the chrome's own `QitsCategory` because it is the same word: the archetype
   * directory is what the sidebar's legacy groups are called and what a `<category>.details` slot
   * is keyed on. Saying so here is what lets a slot be composed from an archetype without a second
   * table — and it makes the compiler the thing that proves this table and the library's
   * `scope.ts` / `repositories.ts` still spell one vocabulary, since the two are deliberately
   * separate copies of it.
   */
  readonly directory: QitsCategory;
  /** The group heading. */
  readonly label: string;
  /** One of them, for “New <singular>”. */
  readonly singular: string;
}

/**
 * The seven groups, in display order, and the order is the project's own layout: what it deploys,
 * what runs beside it, what it shares, what it serves on its own, what a service serves for it,
 * what it hands a person, what it publishes.
 *
 * <p>The order is not this application's to choose. It is the platform's, and it is the same one
 * `DeploymentSpecParser.SLOTS` in qits-deployments, `EdgeRoutes.SLOTS` in qits-edge and
 * `QITS_NAV_SLOTS` / `QITS_CATEGORIES` in `@qits/ui-components` already spell — so `apps` sits
 * after the libraries and before the frontends here because it sits there in all three. A group
 * order that disagrees with the sidebar's is a page that reads as a different product on every
 * host.
 *
 * An archetype missing from this list is not placeable, so it has no group — see
 * `groupComponents` in the project page for where an unknown value goes instead.
 */
export const COMPONENT_TYPES: readonly ComponentType[] = [
  { archetype: 'SERVICE', directory: 'services', label: 'Services', singular: 'service' },
  { archetype: 'DAEMON', directory: 'daemons', label: 'Daemons', singular: 'daemon' },
  { archetype: 'LIBRARY', directory: 'libs', label: 'Libraries', singular: 'library' },
  { archetype: 'APP', directory: 'apps', label: 'Apps', singular: 'app' },
  { archetype: 'FRONTEND', directory: 'frontends', label: 'Frontends', singular: 'frontend' },
  { archetype: 'CLI', directory: 'cli', label: 'Command line', singular: 'CLI tool' },
  { archetype: 'IMAGE', directory: 'images', label: 'Images', singular: 'image' },
];

/**
 * The first segment that marks a wrapper path as the **component layout's**:
 * `components/<component>/<name>`.
 *
 * The server reserves it as a project slug for the same reason the seven category words are reserved
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
 * Where an entity stands in its life — **one lifecycle for every archetype that has one** (qits-392).
 *
 * <p>An epic and a ticket walk the same words over the same legal-target graph: `REPORTED` →
 * `REFINED` → `READY_FOR_DEV` → `IMPLEMENTING` → `IMPLEMENTED` → `VERIFYING` → `VERIFIED` → `DONE`,
 * plus `DROPPED`. The status is what has been *achieved*; the phase that runs while it holds is what
 * happens next.
 *
 * <p><b>`READY_FOR_DEV` (qits-887) is the scheduling decision.</b> `REFINED` says the plan is viable
 * and starts nothing; moving it on to `READY_FOR_DEV` is a person's approval, and it is
 * `READY_FOR_DEV`, not `REFINED`, that starts implement. Which moves a status has is still the served
 * registry's answer, never this comment's.
 *
 * <p><b>`IMPLEMENTING` and `VERIFYING` (qits-749) are the platform-set exceptions to that.</b> Each
 * sits between the pair of words it bridges — `IMPLEMENTING` between `READY_FOR_DEV` and
 * `IMPLEMENTED`, `VERIFYING` between `IMPLEMENTED` and `VERIFIED` — for an epic or a ticket, never
 * a campaign, and the service, not a person, writes them: the moment a dispatch is pressed, to
 * record that an implementation or a verification was started. Either can also be skipped over
 * entirely: the `SKIP` transition `kind` moves `READY_FOR_DEV` straight to `IMPLEMENTED` with no
 * `IMPLEMENTING` in between, or `IMPLEMENTED` straight to `VERIFIED` with no `VERIFYING` in
 * between.
 *
 * <p><b>A plain string, and not a union of today's words.</b> The vocabulary is the service's: the
 * served archetype registry (`GET /entities/archetypes`, each archetype's `lifecycle`) is where a
 * screen reads which words exist and in what order, so a word the service adds reaches the badges,
 * the desk's sections and the status moves without this file changing. A union here would be a
 * second copy of that list, and the copy that was not updated would be the one drawn — which is
 * exactly what happened to the four epic words qits-392 deleted.
 */
export type EntityStatus = string;

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
  /**
   * The per-project counter the unified entity gained: 1, 2, 3… within one project, never reused.
   *
   * <p>It is on the wire beside `id` rather than instead of it, because the two answer different
   * questions. The id is what an API call is addressed with and is a uuid nobody reads out loud; the
   * number is what a person *writes* — in a commit subject, in a branch name, in a sentence to
   * somebody else — and a counter that restarts per project is short enough to be worth writing.
   */
  readonly number: number;
  /**
   * The number as a person spells it: `<projectKey>-<number>`, so `qits-1337`.
   *
   * <p><b>Nullable, and null means exactly one thing</b> — the service could not resolve the owning
   * project row, so it has no key to compose the prefix from. A client draws **nothing** for that
   * rather than falling back to the number alone or, worse, printing `null-1337`: a half-spelled
   * identifier is one somebody may copy, and a copied identifier that resolves to nothing is worse
   * than an absent one.
   *
   * <p>Composed server-side and not here, unlike the branch names one level up. The project key is
   * not on this row, so a client composing it would need a second read and would be free to disagree
   * with the service about a row's own name.
   */
  readonly qualifiedId: string | null;
  readonly status: EntityStatus;
  /**
   * Whether the phase behind the current status cannot proceed — {@link TicketDto.blocked}, rule
   * for rule: orthogonal to status, cleared by any transition, and optional because it arrived after
   * epics were already on the wire — absent means false.
   */
  readonly blocked?: boolean;
  /**
   * The draft that replaced this one — set on a `DROPPED` epic that was superseded (the supersede
   * *operation* lands the epic DROPPED and names its successor here); null on every other.
   */
  readonly supersededByEpicId: string | null;
  /**
   * What has to be true for the work to be accepted (qits-887) — a list of one-line Markdown items,
   * in order. Optional because it arrived after epics were on the wire: absent (an older service) or
   * null reads as none. Written as a whole list through `PATCH /entities/{id}`; see
   * {@link ../project/entities-model#criterionProblems} for the item rules.
   */
  readonly acceptanceCriteria?: readonly string[] | null;
  /**
   * Who is on it — {@link TicketDto.assignee}, rule for rule: free text, null when nobody has said.
   * Optional because an epic carries it only from qits-887 on, where the service writes the
   * dispatched agent's identity into it on every press; absent reads as nobody.
   */
  readonly assignee?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Every workspace cut for this epic — {@link TicketDto.workspaces}, rule for rule. */
  readonly workspaces: readonly WorkspaceReferenceDto[];
}

/**
 * What a transition came to: the epic in its new state, and the draft it spawned.
 *
 * `successor` is a second row, not a field of the first, because superseding **creates** an epic —
 * a fresh `REPORTED` copy of the frozen scope. Every other transition answers a null there, so a
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
 *
 * <p><b>`status` (qits-763).</b> A feature now carries the same eight-word lifecycle as an epic or a
 * ticket, through the one `/entities/{id}/status` door — but `implementedOn` and `implementingOn`
 * stay, as history next to it rather than in place of it: they say *when* it got there, the status
 * says *where it stands*. `status` is optional and reads null on a server that does not serve it yet
 * (`legalStatuses` empty for FEATURE), which a reader falls back to those two markers for — see
 * {@link ../project/entities-model#featureStatus}.
 */
export interface FeatureDto {
  readonly id: string;
  readonly epicId: string;
  /**
   * The project this feature belongs to, carried on the row rather than reached through its epic.
   *
   * It arrived with the unified entity: a feature is now numbered within a project, so the project
   * has to be on the row for the number to mean anything — and a reader that had to walk up to the
   * epic to find out which project a feature is in would be walking a link the wire already answers.
   */
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  /** The per-project counter — {@link EpicDto.number}, rule for rule. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null. See {@link EpicDto.qualifiedId}, including why null draws nothing. */
  readonly qualifiedId: string | null;
  readonly dependsOnFeatureId: string | null;
  /**
   * The lifecycle word, or null on a server that has not grown one for FEATURE yet (qits-763).
   * Optional for the same reason, so an older response simply omits it. See the class note.
   */
  readonly status?: EntityStatus | null;
  /** ISO-8601 instant, or null while the feature is open. The task's twin is `implementedAt`. */
  readonly implementedOn: string | null;
  /**
   * ISO-8601 instant at which work on the feature started — set once one of its tasks is marked with
   * `mark_task_implementing`. Optional: absent on a server that does not serve it yet, which reads
   * the same as null. The task's twin is `implementingAt`.
   */
  readonly implementingOn?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A task under a feature, in one repository. Completion is `implementedAt` — see {@link FeatureDto}.
 *
 * <p><b>`status` (qits-763)</b> is the task's own twin of {@link FeatureDto.status}: the same
 * eight-word lifecycle, the same optional-and-null-until-served shape, and the same markers kept as
 * history beside it. See {@link ../project/entities-model#taskStatus}.
 */
export interface TaskDto {
  readonly id: string;
  readonly featureId: string;
  readonly repositoryId: string;
  /** The project this task belongs to — {@link FeatureDto.projectId}, for the same reason. */
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  /** The per-project counter — {@link EpicDto.number}, rule for rule. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null. See {@link EpicDto.qualifiedId}. */
  readonly qualifiedId: string | null;
  readonly dependsOnTaskId: string | null;
  /** The lifecycle word, or null — {@link FeatureDto.status}, rule for rule. */
  readonly status?: EntityStatus | null;
  /** ISO-8601 instant, or null while the task is open. The feature's twin is `implementedOn`. */
  readonly implementedAt: string | null;
  /**
   * ISO-8601 instant at which an implementing agent started the task (`mark_task_implementing`);
   * skippable, so a task may go straight to `implementedAt`. Optional: absent on a server that does
   * not serve it yet, which reads the same as null. The feature's twin is `implementingOn`.
   */
  readonly implementingAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * **One entity as it stands after a transition wrote it** — the unified row, every archetype's fields
 * on one record.
 *
 * <p>This is the only place the merged entity appears on the wire as itself. Every *read* is still
 * archetype-shaped — `EpicDto`, `TicketDto`, `FeatureDto`, `TaskDto`, on the four routes they always
 * had — because the service migrated the data and deliberately left the read contract byte-identical.
 * The transition door is the one endpoint that came *after* the merge, so it answers the merged shape,
 * and a client that flattened it back into four records would be undoing the only honest statement the
 * wire makes about what an entity now is.
 *
 * <p><b>Nearly everything is nullable, and that is the archetype talking.</b> A ticket has no
 * `implementedAt` and an epic has no repository. Rather than four partial types, the
 * record carries every property and answers null for the ones this row's archetype does not permit —
 * which is the same statement `permitted` makes in the archetype registry, seen from the data's side.
 *
 * <p>`parent` and `position` are the membership as it was written. A root answers a null parent.
 */
export interface EntityStateDto {
  readonly id: string;
  readonly archetype: string;
  readonly projectId: string;
  /** The per-project counter — {@link EpicDto.number}. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null. See {@link EpicDto.qualifiedId}: a null draws nothing. */
  readonly qualifiedId: string | null;
  readonly title: string;
  readonly slug: string;
  /** What the slug is unique *within* — which is why a reparent can collide on one. */
  readonly slugScope: string | null;
  readonly description: string | null;
  readonly status: string | null;
  readonly ticketType: string | null;
  readonly impetus: string | null;
  readonly assignee: string | null;
  readonly createdBy: string | null;
  readonly supersededBy: string | null;
  readonly repositoryId: string | null;
  readonly implementedAt: string | null;
  readonly dependsOn: string | null;
  /** {@link EpicDto.acceptanceCriteria}; absent on a service older than qits-887. */
  readonly acceptanceCriteria?: readonly string[] | null;
  readonly parent: string | null;
  readonly position: number | null;
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
 * Two values for a person to pick between, because the distinction has to be one a reporter can
 * make without thinking. A third kind — "task", "chore", "question" — would be a taxonomy this
 * platform has no use for: the plan is the epics, and a ticket is the small thing beside it.
 *
 * `MAINTENANCE` is the one exception, and it is not a third choice for a reporter: the platform
 * files it itself, against a failing maintenance release request, and closes it itself once the
 * release goes through. A person never picks it from a menu; the edit form only offers it back on a
 * ticket that already carries it, as the opt-out from that auto-close.
 */
export type TicketType = 'BUG' | 'IMPROVEMENT' | 'MAINTENANCE';

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
/**
 * A workspace cut for a ticket or an epic — every one of them, live and resolved alike, derived by
 * the service on every read and stored nowhere.
 *
 * <p>It is the workspace that carries the reference, never the row: a pointer on the ticket would
 * have to be cleared when the workspace is integrated or discarded, and one that is only ever
 * written links to a row nobody can open. But a resolved workspace **keeps appearing here**,
 * carrying its {@link status}, because it is the only record of where the work actually happened:
 * the branch that was cut, the sessions on it, the conversation that produced the change. A ticket
 * that dropped its workspaces the moment they resolved would answer "who did this, and where?" with
 * nothing, on exactly the tickets that have an answer.
 *
 * <p>`workspaceRowId` and `repositoryId` are the pair the link is composed from — that application
 * routes a workspace as `repositories/{repositoryId}/workspaces/{workspaceRowId}` — and `branch` is
 * what the link says out loud.
 */
export interface WorkspaceReferenceDto {
  readonly workspaceRowId: number;
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly branch: string;
  /**
   * `ACTIVE`, `INTEGRATED` or `ABANDONED` — and **absent means `ACTIVE`**.
   *
   * <p>Optional rather than required because it arrived after the reference did, and a required
   * field would rewrite every fixture in this repository that builds the four-field literal to
   * restate the default. A reader has one rule to remember and the compiler enforces none of it, so
   * nothing here tests `status === 'ACTIVE'`: the question is always asked as "is this one live",
   * with a missing value answering yes.
   *
   * <p>A bare `string` rather than a union, because the service owns the vocabulary and a word this
   * build has never seen should read as "not live" rather than fail to compile against a list that
   * moved.
   */
  readonly status?: string;
}

export interface TicketDto {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  /** The per-project counter — {@link EpicDto.number}. One sequence, shared with the epics. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null. See {@link EpicDto.qualifiedId}, including why null draws nothing. */
  readonly qualifiedId: string | null;
  readonly type: TicketType;
  readonly status: EntityStatus;
  /**
   * Whether the phase belonging to the ticket's current status **cannot proceed** — waiting on an
   * answer, on somebody else's change, on access nobody here can grant.
   *
   * <p>Orthogonal to {@link status} rather than a seventh value of it, because it says nothing about
   * what has been achieved: a blocked ticket is still exactly as far along as it was. It is also
   * **temporary** in a way a status is not — any transition clears it, since the phase that could not
   * proceed is over the moment the ticket moves.
   *
   * <p>Optional for {@link WorkspaceReferenceDto.status}'s reason: it arrived after the ticket did,
   * and absent means false.
   */
  readonly blocked?: boolean;
  /** Free text — whoever is looking at it. Null when nobody has said. */
  readonly assignee: string | null;
  /** Stamped from the session, never sent. Null for a row with no principal behind it. */
  readonly createdBy: string | null;
  /** {@link EpicDto.acceptanceCriteria}, rule for rule. */
  readonly acceptanceCriteria?: readonly string[] | null;
  /**
   * Why the ticket exists, in the reporter's own words — one sentence, almost always: "{some error}
   * occurs {in some context}", or "{an existing part} should be {something to introduce or
   * improve}". A bug's steps to reproduce may ride along and do not count against that length.
   *
   * <p><b>This is the intake field, and no later phase rewrites it.</b> Refining answers it rather
   * than editing it: what the reporter said is the record of what brought the ticket about, and a
   * ticket whose impetus had been polished into a work statement has lost the only sentence that
   * says why anybody should care. That is a rule the **prompt templates** hold the phases to, not a
   * guard — the field stays editable, because triage fixing a badly written impetus is exactly the
   * edit it needs.
   *
   * <p>Nullable only for rows written before there was an impetus to write; a create sends one.
   */
  readonly impetus: string | null;
  /**
   * **The refinement's output**, not the reporter's words: what is to be done about the impetus,
   * written by the refine phase and markdown like every description on this service.
   *
   * Null until refining has run — which is an ordinary state, not a gap, and draws as the sentence
   * saying so rather than as an empty panel.
   */
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Every workspace cut for this ticket, live and resolved — the record of where its work happened,
   * which outlives the work. **Only the `ACTIVE` ones bear on whether a dispatching button is
   * offered**; an integrated or abandoned one is a link and nothing more, and reading the list's
   * length as "somebody is on it" would close that button for ever. Empty on a write's answer too:
   * an edit is not the read that asks.
   */
  readonly workspaces: readonly WorkspaceReferenceDto[];
}

/**
 * One thing somebody said about a work entity — a ticket, an epic, a feature, a task or a campaign
 * (qits-551). Every archetype shares one thread now; the service's `entity_id` column is a foreign
 * key into the one `entity` table, not an archetype-specific one.
 *
 * <p>`body` is markdown and is **not** nullable: a comment with nothing in it is not a comment, so
 * the service refuses one rather than storing a row that draws as blank space.
 *
 * <p>`author` is the same server-stamped, nullable field {@link TicketDto.createdBy} is, and for the
 * same reason. `updatedAt` moving past `createdAt` is the only record that a comment was edited —
 * there is no revision history and no `edited` flag, so the two timestamps together are what the
 * "edited" hint is derived from.
 */
export interface CommentDto {
  readonly id: string;
  readonly entityId: string;
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

/**
 * An entity's block flag as the write left it, with the archetype and status it belongs to —
 * `POST /projects/api/entities/{id}/blocked`'s answer, for every archetype that carries one: an
 * epic, a ticket or a campaign. A feature and a task stay refused (409) even once they carry a
 * status of their own (qits-763) — blocking one was never in scope, lifecycle or not.
 */
export interface EntityBlockDto {
  readonly entityId: string;
  readonly archetype: string;
  readonly status: EntityStatus;
  readonly blocked: boolean;
}

/** The block flag, wrapped — the whole answer to the entity block door. */
export interface EntityBlockResponse {
  readonly block: EntityBlockDto;
}

/** One entity's comments, oldest first, which is the order a conversation is read in. */
export interface CommentEntriesResponse {
  readonly entries: readonly { readonly comment: CommentDto }[];
}

/** One comment, wrapped — the answer to a post and to an edit. */
export interface CommentResponse {
  readonly comment: CommentDto;
}

/**
 * How much of the flow one press runs — the only difference between the two dispatching actions.
 *
 * <p>`FLOW` is **Dispatch**: start the phase the status implies and let each transition start the
 * next one. `PHASE` is **Run the next phase**: one phase, then stop and wait for the next press. The
 * bit is stored on the entity by the press, because the transition that reads it arrives hours later.
 */
export type DispatchMode = 'FLOW' | 'PHASE';

/**
 * Which phase a status starts — the service's words, never computed here.
 *
 * <p>`REPORTED` starts refine, `READY_FOR_DEV` implement, `IMPLEMENTED` verify, and the rest start
 * nothing — `REFINED` included: it waits on a person to schedule it (qits-887).
 * That rule lives in exactly one place on the service (`PhasePrompts.phaseOf`) and the SPA learns its
 * answer from {@link EntityDispatchStateDto.nextPhase}; a switch here would be a second copy of it.
 */
export type DispatchPhase = string;

/**
 * Whether a coding agent was actually started on the workspace a dispatch landed in.
 *
 * <p>`SKIPPED_RUNNING` is a success, not a refusal: the workspace already had an agent working in
 * it, and starting a second one would put two of them on the same branch.
 */
export type AgentLaunch = 'SCHEDULED' | 'SKIPPED_RUNNING';

/**
 * Where one press of Dispatch or Run the next phase put an agent — `POST /entities/{id}/dispatch`.
 *
 * <p><b>`workspaceRowId` is a number and `repositoryId` is a string</b>, which is qits-workspaces'
 * own split: together they are the workspace's address there,
 * `repositories/{repositoryId}/workspaces/{workspaceRowId}`. The branch is the entity's own on the
 * project's wrapper — `ticket/<slug>` or `epic/<slug>`.
 *
 * <p><b>Nothing here is stored.</b> It is the answer to one press; the record that survives a reload
 * is the entity's own `workspaces`, and pressing again is find-or-create onto the same workspace.
 */
export interface EntityDispatchDto {
  readonly entityId: string;
  readonly archetype: string;
  /** The phase this press started: `refine`, `implement` or `verify`. */
  readonly phase: DispatchPhase;
  readonly mode: DispatchMode;
  readonly workspaceRowId: number;
  readonly repositoryId: string;
  readonly branch: string;
  /** Whether this press created the workspace, rather than re-entering one that was there. */
  readonly fresh: boolean;
  readonly agentLaunch: AgentLaunch;
}

/** One dispatch, wrapped — the whole answer to `POST /projects/api/entities/{id}/dispatch`. */
export interface EntityDispatchResponse {
  readonly dispatch: EntityDispatchDto;
}

/**
 * **What the dispatching press answers, for every archetype** — discriminated by key, not by a tag.
 *
 * <p>On an epic or a ticket it is `{dispatch}`: where the agent went. On a campaign the press is the
 * campaign's *start* (qits-417), and it answers `{progress}` — the same wrapper
 * `GET /campaigns/{id}/progress` answers — because a start dispatches nothing itself; it authorises
 * the members to run. `'progress' in answer` is the narrowing.
 */
export type EntityDispatchAnswer = EntityDispatchResponse | CampaignProgressResponse;

/**
 * What a press *would* do, read before anybody presses — `GET /entities/{id}/dispatch`.
 *
 * <p>This is what decides whether Dispatch and Run the next phase are offered and what they say:
 * `dispatchable` false (a VERIFIED, DONE or DROPPED entity, a blocked ticket, a feature or a task)
 * draws them disabled, and `nextPhase` names the phase a press starts. The refine action reads the
 * same answer — refinement is the REPORTED phase, which is `nextPhase === 'refine'` — so no screen
 * on this client maps a status word to a phase.
 *
 * <p>`mode` is the bit the last press stored, or null when nothing has pressed yet.
 */
export interface EntityDispatchStateDto {
  readonly entityId: string;
  readonly archetype: string;
  readonly status: EntityStatus | null;
  readonly nextPhase: DispatchPhase | null;
  readonly blocked: boolean;
  readonly dispatchable: boolean;
  readonly mode: DispatchMode | null;
}

/** The state, wrapped — the whole answer to `GET /projects/api/entities/{id}/dispatch`. */
export interface EntityDispatchStateResponse {
  readonly state: EntityDispatchStateDto;
}

/**
 * One row of an entity's history, as the audit log keeps it.
 *
 * <p>`epicId` is the log's **subtree key**, not literally an epic: a ticket's rows carry the ticket's
 * id there, a feature's and a task's their epic's. That is why one read of `GET /epics/{key}/audit`
 * answers a whole tree, and why a feature's page filters the answer by `entityId`. `snapshot` is the
 * row as JSON after the write, which the page does not parse.
 */
export interface AuditEntryDto {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly epicId: string;
  readonly operation: string;
  readonly changedBy: string | null;
  readonly changedAt: string;
  readonly snapshot: string | null;
}

/** The audit subtree, newest first. */
export interface AuditEntriesResponse {
  readonly entries: readonly AuditEntryDto[];
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
 * <p>The nine below are what it stores today, and its own DTO says the vocabulary may grow. That is
 * why this is not a union: a closed one would make a platform that added a tenth state fail to
 * type against a build of this SPA that is otherwise perfectly able to draw it. Every reader here
 * therefore decides what an unknown word means for itself, the way {@link RepositoryDto}'s
 * archetype is handled — and each of those decisions is stated where it is made.
 *
 * - `PENDING` — created, waiting on the gates for the fold's sha.
 * - `READY` — the gates passed; the worker is about to call the release door.
 * - `RELEASED` — **the tag is cut, and the request is still open.** `version` is the calver it
 *   landed as, and what remains is everything the release promised: the publish run going green,
 *   the deployment going live, the tag reaching `main`.
 * - `REJECTED` — a build went red. The refusal stands until a push re-arms the request.
 * - `CONFLICTED` — the sources cannot be folded; `conflict` says which paths and whose head. The
 *   service does *not* re-fold one on its sweep, so it stands until a push changes the content.
 * - `FAILED` — the release itself did not go through; `retryable` says whether the sweep keeps
 *   trying it or the refusal stands.
 * - `FINALIZED` — **the done state.** The tag is merged into `main` and everything the release
 *   promised has happened; `mergedToMainAt` says when.
 * - `WITHDRAWN` — the ask is moot. Terminal, and it frees the sources for a fresh request.
 * - `OBSOLETE` — a later release request for the same repository superseded this unfinished one;
 *   `supersededBy` names it. Terminal, and nothing here is anybody's to answer.
 *
 * <p><b>"Open" means "not finalized", and it is a wider set than it used to be.</b> A request is
 * finished in exactly three of the words above — `FINALIZED`, `WITHDRAWN` and `OBSOLETE` — and open
 * in every other, `RELEASED` included. A tag is the middle of the lifecycle rather than the end of
 * it, so a reader asking "what is still going on here" is asked to see the released-and-unfinalized
 * rows, which are precisely the ones that can still get stuck.
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
  /**
   * What the conflicting entry **is** — `gitlink` for a submodule pin, `file` for everything else.
   *
   * <p>Worth its own field because the two read nothing alike: a file conflict is text somebody
   * merges, a gitlink conflict is two shas one of which is usually simply newer. Without it both
   * draw as a path with the word `content` beside them, which is true of the file and useless about
   * the submodule.
   *
   * <p>A plain string rather than a union, for the reason every vocabulary field on these DTOs is:
   * the service's answer may grow a third word and a build that cannot type it should still draw
   * the row.
   */
  readonly kind?: string | null;
  /**
   * The three sides of the conflicting entry — the merge base, the target's and the head's — as
   * 40-hex, or null where that side has none (a gitlink added on both sides has no base).
   *
   * <p>On a `gitlink` these are the **submodule's** commits, which is what makes them worth drawing:
   * `headSha` above is the commit in *this* repository that introduced the row and says nothing
   * about which pin is being asked for.
   *
   * <p>Optional, and all four fields above can be absent together: a conflict recorded before the
   * service grew them has only the original four, and this SPA is routinely ahead of the service
   * build serving it. Absent means "not said", never "none" — a row without them draws exactly as it
   * did before.
   */
  readonly base?: string | null;
  readonly ours?: string | null;
  readonly theirs?: string | null;
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
 * <p>`mergedToMainAt` is the end of the lifecycle, and it is what `FINALIZED` means: a release is a
 * tag, the tag is merged into `main` once everything the release promised has happened, and only
 * then is the request finished. A `RELEASED` request with a `version` and no `mergedToMainAt`
 * shipped and is still open — waiting on its publish run, its deployment, or somebody. Null on
 * everything that has not released, where there is nothing to have reached `main`.
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
  /**
   * **Every quality gate this repository configures, with what each says about the current fold.**
   * A request is held by all of them and by no other; a gate the repository does not configure is
   * simply absent from the list and is never waited on.
   *
   * <p>Absent where the service has none to give — an answer from a build older than the field —
   * and that absence is **not** the same as an empty array. Empty means "this repository configures
   * no gate", which is a request releasable at once; `undefined` means "this service does not report
   * gates", where the approval fields above are still the whole of what is known. Readers here keep
   * drawing the old panel for `undefined` and the new one for an array, empty included.
   */
  readonly gates?: readonly ReleaseGateDto[];
  /**
   * **Every release-request automation that applies to this repository, with where each stands for
   * the CURRENT fold** — estate pins, screenshot baselines, and whatever kind qits-maintenance adds
   * next (qits-978). `gates` may carry its own `AUTOMATIONS` entry for the flat pass/fail read; this
   * is the detail behind it, one row per kind.
   *
   * <p><b>Optional and nullable, and both spellings mean one thing: draw today's page, unchanged.</b>
   * `undefined` is an answer from a service build older than the field — the ordinary case while
   * this SPA ships ahead of the service it talks to — and `null` is a build that has the field and
   * had nothing to report for this request. Neither is an automation kind this repository applies
   * to; an **empty array** is that, and it is a different, later answer: the repository was asked
   * and nothing applies, which reads as a passed line rather than as nothing to show.
   */
  readonly automations?: readonly ReleaseAutomationDto[] | null;
  /**
   * **The one release pipeline, as phases with the gates between them** — the same facts
   * {@link gates} carries, arranged as the sequence they actually happen in.
   *
   * <p><b>Optional and nullable, and both spellings mean one thing: draw today's gate lines,
   * unchanged.</b> `undefined` is an answer from a service build older than the field, which is the
   * ordinary case on the day this SPA ships — it is released ahead of the service that grew it — and
   * `null` is a build that has the field and had no pipeline to report for this request. Neither is a
   * pipeline with nothing in it, and neither is anything a reader should be shown a new, empty panel
   * for: the request is exactly as gated as it was, `gates` still says by what, and the panel that
   * draws it is still there. That is why the pipeline panel *delegates* to the gate panel rather than
   * re-deriving the old view — the legacy rendering is the same component it always was, so
   * "unchanged" is guaranteed rather than asserted.
   *
   * <p>A present pipeline does **not** make {@link gates} stale or redundant: the two are answered
   * from the same state and the gate set remains what a caller asks when it wants the flat list.
   */
  readonly pipeline?: ReleasePipelineDto | null;
  readonly conflict: MergeConflictDto | null;
  /**
   * The request that **obsoleted this one** — the later ask for the same repository that took over
   * the work this one never finished — or null everywhere else.
   *
   * <p>It is an id and nothing else, which is all the address needs: a request's page is a sibling
   * of this one's, so the link is spelled without asking anything further of the service. Optional
   * for the ordinary reason every field here is: an answer from a service build older than the
   * field must read as "nothing superseded this", which is exactly what `undefined` means to the
   * one reader that draws it.
   */
  readonly supersededBy?: string | null;
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

/**
 * One quality gate of a release request.
 *
 * <p>`kind` is `CI`, `APPROVAL`, `PUBLISH` or `DEPLOYMENT`, and `state` is `PENDING`, `PASSED`,
 * `FAILED` or `UNKNOWN` — both plain strings rather than unions, the honesty every open vocabulary
 * on this file is typed with: the service owns the words, they may grow, and a word this build has
 * never heard of is drawn as itself rather than guessed into a colour.
 *
 * <p><b>`PUBLISH` is the tag's own release pipeline</b> — the run that builds what the tag says and
 * pushes it wherever it goes. Like `DEPLOYMENT` it is answered *after* the tag rather than in front
 * of it, and it is the reason a `RELEASED` request is still open. A `FAILED` publish is the one gate
 * on this list whose cure is neither a push nor a person's decision: it is an environmental failure,
 * and it is retried on the run itself with `qits ci retry`.
 *
 * <p>**`UNKNOWN` is not `PENDING`.** It means the repository's gate configuration could not be read
 * at all, so neither which gates apply nor whether any has passed is known. A gate quietly in
 * progress and a configuration nobody could read are different things to whoever is looking at the
 * page, and only one of them is somebody's to fix.
 */
export interface ReleaseGateDto {
  readonly kind: string;
  readonly state: string;
  /**
   * Why this gate applies — set only on `APPROVAL`, e.g. `configured by manual-review` or
   * `changes .config/qits/: .config/qits/release.yml, .config/qits/deployments.yml`, the two joined
   * with `; ` where both are true. Absent or null everywhere else, and on an answer from a service
   * build older than the field.
   */
  readonly detail?: string | null;
}

/**
 * One release-request automation — a regeneration that runs on every fold and has to be fresh for
 * `mergedSha` before the request may release: estate pins, screenshot baselines, and whatever kind
 * qits-maintenance adds next (qits-978's own abstraction, `ReleaseRequestAutomation`).
 *
 * <p><b>`kind` and `state` are plain strings, the same honesty every open vocabulary on this file is
 * typed with.</b> Adding a kind is meant to cost this page nothing, and a repository's own gate
 * configuration is the one thing here that genuinely grows — so a kind or a state this build has
 * never heard of is drawn as itself rather than failing to type or guessed into a verdict.
 *
 * <p><b>The states, as the service documents them today</b> — and the vocabulary may grow, exactly
 * as {@link ReleaseGateDto.state} may:
 * <ul>
 *   <li>`FRESH` — already good for `mergedSha`, whether because nothing needed regenerating, a run
 *       landed and moved nothing (`NOTHING_TO_DO`), or it was carried forward from a previous fold
 *       whose outcome this fold's own changes could not have invalidated.</li>
 *   <li>`REQUESTED` — waiting for a run slot.</li>
 *   <li>`RUNNING` — a run is in flight now.</li>
 *   <li>`COMMITTED` — a green run moved a branch, which re-folds the request; this fold is never the
 *       one that ships.</li>
 *   <li>`FAILED` — the run was red, or its commit was refused. {@link detail} says more.</li>
 *   <li>`UNKNOWN` — applicability or the plan could not be decided, or the dispatch itself could not
 *       be made. The sweep retries it, the same way an `UNKNOWN` {@link ReleaseGateDto} does.</li>
 *   <li>`SUPERSEDED` — the request's fold moved on before this outcome arrived; discarded, though a
 *       push it made may still have re-folded the request.</li>
 *   <li>`WAIVED` — a person waived the gate for this exact fold (`foldSha` below matches it).</li>
 * </ul>
 *
 * <p>`runId` and `branch` are null wherever the state has no run or no commit to point at yet —
 * `REQUESTED` has neither, and the plan answering `FRESH` outright never ran at all. `detail` is the
 * service's own sentence, mirroring {@link ReleaseGateDto.detail}: null where the state says enough
 * by itself. `foldSha` is the fold this row's outcome is actually about, which is what a waiver is
 * checked against — it need not be `mergedSha` on a row the request has not re-settled yet.
 */
export interface ReleaseAutomationDto {
  readonly kind: string;
  readonly label: string;
  readonly state: string;
  readonly foldSha: string;
  readonly runId: string | null;
  readonly branch: string | null;
  readonly detail: string | null;
  readonly updatedAt: string;
}

/**
 * What the manual re-run door answers — `POST …/automations/{kind}/runs`. A 202, because the run
 * has only just been dispatched and there is nothing settled yet to report beyond its id.
 */
export interface AutomationRunResponse {
  readonly id: string;
}

/**
 * Which phase of the one release pipeline a row is about.
 *
 * <p><b>Closed where {@link ReleaseGateDto}'s `kind` and `state` are open, and the asymmetry is the
 * argument {@link ReleaseRequestSourceKind} makes.</b> A gate's vocabulary is the service's to grow —
 * a repository may configure a kind of check nobody has thought of yet, and a state may gain a fifth
 * word — so a build of this SPA that could not type one would fail to draw a request it is otherwise
 * perfectly able to show. The phases are the opposite kind of fact: the service enumerates exactly
 * these three, they are the *shape* of the pipeline rather than an entry in it, and a fourth would be
 * a new release lifecycle rather than a new word for the old one. The panel switches on this value to
 * decide what a row is called and where it sits in the tree, so a phase it has never heard of has no
 * position to be drawn at — which is precisely the case worth failing to type.
 *
 * <p>It is exported on its own because the rerun door takes one as a path segment: the enumeration is
 * the whole of what makes that segment safe to spell into an address.
 */
export type ReleasePipelinePhase = 'QA' | 'PUBLISH' | 'DEPLOY';

/**
 * One phase of the release pipeline, as the service reports it right now.
 *
 * <p><b>`state` is a closed union here and that is not a contradiction of the rule above.</b> These
 * six are qits-ci's own run states forwarded whole, `UNKNOWN` included, and `UNKNOWN` is what a word
 * nobody could resolve already arrives as — the service normalises rather than passing an unfamiliar
 * word through, so there is no seventh value to be surprised by. Where an open vocabulary genuinely
 * survives to this client it is typed as a plain string, which is what
 * {@link ReleasePipelineGateDto} does.
 *
 * <p><b>`runId` is one field naming two different things, and the service's own record is the reason.</b>
 * For `QA` and `PUBLISH` it is a qits-ci run id; for `DEPLOY` it is a deployment request id in
 * qits-deployments. They are not interchangeable and nothing here composes an address out of one
 * without knowing which phase it came off — which is exactly why the panel reruns by *phase* rather
 * than by run id, and why this field is carried for the record rather than for the door.
 *
 * <p>`startedAt` and `finishedAt` are ISO-8601 instants and are **null together on a phase that has
 * not begun**, which is the ordinary state of every phase in front of the one that is running. A
 * finished instant with no start is a phase whose beginning was never recorded, not a phase that
 * finished before it started.
 */
export interface ReleasePhaseDto {
  readonly phase: ReleasePipelinePhase;
  readonly state: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  /** A qits-ci run id, or — on `DEPLOY` — a deployment request id. Null until something started. */
  readonly runId: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * One gate of the release pipeline, and **the pair of phases it stands between**.
 *
 * <p>`between` is what makes this a pipeline rather than a list: a gate is not a property of a phase,
 * it is the condition on the step from one phase to the next, and `DEPLOY_FINALIZED` is the step out
 * of the pipeline altogether. Drawing a gate under the phase it follows — which is what the panel
 * does — is a rendering decision made from this field, and a gate whose `between` this build has
 * never heard of therefore has no edge to be drawn on. It is nonetheless a closed union for the same
 * reason {@link ReleasePipelinePhase} is: the edges are the shape of the pipeline, and three phases
 * plus a terminus admit exactly these three steps.
 *
 * <p><b>`kind` and `state` are plain strings, kept open exactly as {@link ReleaseGateDto}'s are.</b>
 * `CI`, `APPROVAL`, `PUBLISH` and `DEPLOYMENT` are what the service sends today and `PENDING`,
 * `PASSED`, `FAILED` and `UNKNOWN` are what it says about them, but a repository's gate configuration
 * is the one thing on this surface that genuinely grows: the whole point of the gate set was that a
 * repository is held by what it *configures*, so a kind this build cannot name is a repository doing
 * something new and not an error. It is drawn as itself, uncoloured, rather than guessed into a
 * verdict — the rule every open vocabulary on this file is typed with.
 *
 * <p><b>A `PENDING` gate is a wait, never a refusal.</b> That is the single most load-bearing
 * sentence about this shape: the gate has not answered yet, the pipeline is holding in front of it,
 * and nothing has said no. Only `FAILED` is a refusal, and only `UNKNOWN` is "nobody could read
 * this". A renderer that coloured the three alike would report half the healthy pipelines on the
 * platform as broken.
 *
 * <p>`detail` is the service's own sentence about this gate — which run, which deployment, which
 * person, or, on `APPROVAL`, why it applies at all (`configured by manual-review`, or
 * `changes .config/qits/: .config/qits/release.yml, .config/qits/deployments.yml`, the two joined
 * with `; ` where both are true) — or null where it has nothing to add beyond the state. Optional
 * on an answer from a service build older than the field.
 */
export interface ReleasePipelineGateDto {
  readonly between: 'QA_PUBLISH' | 'PUBLISH_DEPLOY' | 'DEPLOY_FINALIZED';
  /** `CI`, `APPROVAL`, `PUBLISH`, `DEPLOYMENT` — open, and drawn as itself where it is none of them. */
  readonly kind: string;
  /** `PENDING`, `PASSED`, `FAILED`, `UNKNOWN` — open, and `PENDING` is a wait rather than a no. */
  readonly state: string;
  readonly detail?: string | null;
}

/**
 * The one release pipeline of a request: its phases, and the gates between them.
 *
 * <p><b>It replaces two pipelines that were never one picture.</b> What a reader had before was a
 * pre-tag gate list and a pair of after-the-tag gates drawn beside it, with nothing saying that the
 * second only happens because the first passed. The phases say it: QA, then publish, then deploy, in
 * that order, each held by the gates on the edge in front of it.
 *
 * <p><b>`phases` is not required to be complete, and the panel does not treat it as though it were.</b>
 * A phase the pipeline has not reached may simply be absent, which is the same fact as present-and-
 * `PENDING` and must draw identically — a reader who saw two rows before the tag and three after it
 * would read the third as something that had just been added rather than as something that had always
 * been coming. What a *missing* phase does not tell apart is a repository that deploys nothing, which
 * is why the deployment row is drawn on the evidence of a `DEPLOYMENT` gate as well as on the phase.
 */
export interface ReleasePipelineDto {
  readonly phases: readonly ReleasePhaseDto[];
  readonly gates: readonly ReleasePipelineGateDto[];
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
 * <p>Every verdict here is one the release gate waits on. There used to be a `gating` flag saying
 * otherwise — a red verdict the gate read and ignored — and it is gone (ticket 9441bc6e): a verdict
 * that is not a verdict about the commit is not a thing any more, so a red line on this list is
 * always a reason a release is stuck and is drawn as one.
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
  readonly finishedAt: string;
}

/**
 * Every verdict recorded for one commit, **newest first** — the service's order, which this SPA
 * keeps rather than re-sorts.
 *
 * <p>The list is deliberately not reduced to a single word on the service side, and this SPA does
 * not reduce it either: a fold can be built more than once (a re-run, a second pipeline, two recipes
 * over the same sha), and "the" status of a commit is a summary that hides
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
  /** The base side's tree mode — `100644`, `160000`, … — null where the entry did not exist. */
  readonly oldMode: string | null;
  /** The fold side's tree mode, on the same terms. */
  readonly newMode: string | null;
  /**
   * The base side's object id, null where the entry did not exist. Git's all-zero id for an absent
   * side is normalised away by the service rather than handed on.
   */
  readonly oldSha: string | null;
  /** The fold side's object id, on the same terms. */
  readonly newSha: string | null;
  /**
   * What the gitlink resolves to, non-null exactly where either mode is `160000`. Null for every
   * ordinary file — which is what the page routes on, rather than parsing the modes itself.
   */
  readonly submodule: SubmoduleRefDto | null;
}

/**
 * What a `160000` tree entry actually names: the sibling repository the fold's own `.gitmodules`
 * resolves the path to, and the two commits of *that* repository the release moves between.
 *
 * <p>Without it a wrapper's release reads as a wall of opaque `Subproject commit` pairs in
 * repositories the diff never names. Labelling a row costs nothing — every field here comes out of
 * the wrapper's own fold plus one row lookup — which is why the whole change set arrives labelled
 * and expanding *one* row into its commits is the separate, more expensive read.
 *
 * <p><b>`detail` is the whole of whether this row can be expanded.</b> Null means the gitlink
 * resolved and both pins are there to ask about; a sentence — "Added by this release", "This
 * submodule is not a repository of this project" — is what the page draws *instead* of an
 * expansion, because each of those is a fact about one submodule and not an error about the fold.
 */
export interface SubmoduleRefDto {
  readonly repositoryId: string | null;
  /** The sibling's addressable name, null when the manifest declared nothing usable. */
  readonly name: string | null;
  /** The pin on the base side, null when this release adds the gitlink. */
  readonly oldSha: string | null;
  /** The pin on the fold side, null when this release removes it. */
  readonly newSha: string | null;
  /** Why this cannot be expanded, in a sentence. Null exactly when it can. */
  readonly detail: string | null;
}

/**
 * One gitlink of a fold, **expanded**: the sibling repository's own commits and changed files
 * between the two pins.
 *
 * <p>This is the answer a wrapper release actually poses. The wrapper's diff says one forty-
 * character string became another; what the release *is* lives entirely in the sibling.
 *
 * <p><b>`files` paths are relative to the SUBMODULE</b>, not to the wrapper. The page joins them
 * under the gitlink's path to splice them into one tree, and splits them apart again to ask for a
 * patch — the two halves are the address of that read.
 *
 * <p>Every failure is a sentence on `detail` rather than a status code, for the same reason
 * {@link SubmoduleRefDto} carries one: a wrapper fold is twenty-seven of these rows, and one
 * unreachable sibling must not take the other twenty-six down with it.
 */
export interface SubmoduleChangesDto {
  /** The gitlink's path in the wrapper — the address asked by, echoed back. */
  readonly path: string;
  readonly repositoryId: string | null;
  readonly name: string | null;
  readonly oldSha: string | null;
  readonly newSha: string | null;
  /** The sibling's commits in `oldSha..newSha`, newest first. Empty is a real answer. */
  readonly commits: readonly ReleaseRequestCommitDto[];
  /** The sibling's changed files between the pins, capped like every other change list here. */
  readonly files: readonly CommitFileChangeDto[];
  readonly truncated: boolean;
  /** Why this is all there is. Null only when the expansion is complete and unremarkable. */
  readonly detail: string | null;
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

// ---- campaigns (qits-413 … qits-418) ------------------------------------------------------------

/**
 * **A campaign in a project's listing** — `GET /projects/{projectId}/campaigns` answers
 * `{"campaigns": [CampaignSummaryDto…]}`, oldest first.
 *
 * <p>A campaign is a root of work on the one desk, like an epic or a ticket, but it gathers other
 * entities rather than holding a tree of its own. The listing carries **no timestamps, no slug and no
 * description** — the service ships exactly these fields — so a desk card draws what is here and the
 * detail page reads {@link CampaignDto} for the rest.
 */
export interface CampaignSummaryDto {
  readonly id: string;
  readonly number: number;
  readonly qualifiedId: string | null;
  readonly projectId: string;
  readonly title: string;
  readonly status: EntityStatus;
  /** Whether the phase behind the current status cannot proceed — {@link TicketDto.blocked}, rule for rule. */
  readonly blocked?: boolean;
  /** Whether it has ever been started. */
  readonly started: boolean;
  /** Whether its start is live now — leaving REFINED and READY_FOR_DEV both pauses it. */
  readonly active: boolean;
  /** How many members it gathers. */
  readonly members: number;
}

export interface CampaignsResponse {
  readonly campaigns: readonly CampaignSummaryDto[];
}

/** A campaign's start; null on a campaign never started. */
export interface CampaignStartDto {
  readonly firstStartedAt: string | null;
  readonly startedAt: string | null;
  readonly startedBy: string | null;
  readonly active: boolean;
}

/** The entity one membership gathers, as a member row draws it. */
export interface CampaignMemberEntityDto {
  readonly id: string;
  readonly archetype: string;
  readonly qualifiedId: string | null;
  readonly title: string;
  readonly status: EntityStatus | null;
  readonly blocked: boolean;
}

/** Where the campaign's dispatch of a member landed; every field null until it has. */
export interface CampaignDispatchDto {
  readonly workspaceId: string | null;
  readonly branch: string | null;
  readonly agentLaunch: string | null;
}

/** The four catalogue kinds a criterion can be. */
export type CriterionKind = 'ENTITY_STATUS' | 'DEPLOYMENT_ACTIVE' | 'SCM_RELEASE' | 'APPROVAL';

/** Another member reaches `status`. */
export interface EntityStatusPredicate {
  readonly entityId: string;
  readonly status: EntityStatus;
}

/** `applicationName` goes live — in `environmentName` and at least `minimumVersion`, when set. */
export interface DeploymentActivePredicate {
  readonly applicationName: string;
  readonly environmentName: string | null;
  readonly minimumVersion: string | null;
}

/** `repositoryName` releases — in `projectId` and at least `minimumVersion`, when set. */
export interface ScmReleasePredicate {
  readonly repositoryName: string;
  readonly projectId: string | null;
  readonly minimumVersion: string | null;
}

/** A person's yes. It matches no event, so it carries nothing. */
export type ApprovalPredicate = Readonly<Record<string, never>>;

/**
 * **One criterion as the condition door states it** — the four predicate shapes, discriminated on
 * `kind`. The service writes every key of a shape, optional ones as `null`, and refuses a key the
 * shape does not have; the SPA's forms produce exactly these.
 */
export type CriterionSpec =
  | { readonly kind: 'ENTITY_STATUS'; readonly predicate: EntityStatusPredicate }
  | { readonly kind: 'DEPLOYMENT_ACTIVE'; readonly predicate: DeploymentActivePredicate }
  | { readonly kind: 'SCM_RELEASE'; readonly predicate: ScmReleasePredicate }
  | { readonly kind: 'APPROVAL'; readonly predicate: ApprovalPredicate };

/** What latched a criterion: an event, or `STATE_AT_START` with no event id. */
export interface CriterionEvidenceDto {
  readonly eventId: string | null;
  readonly signature: string;
  readonly summary: string;
}

/** Who approved an APPROVAL criterion, and what they said. */
export interface CriterionApprovalDto {
  readonly approvedBy: string | null;
  readonly note: string | null;
}

/** One AND'd criterion: its kind, its predicate, whether it is the seeded one, and its latch. */
export type CriterionDto = CriterionSpec & {
  readonly id: string;
  readonly seeded: boolean;
  readonly satisfiedAt: string | null;
  readonly evidence: CriterionEvidenceDto | null;
  readonly approval: CriterionApprovalDto | null;
};

/** One OR'd group of a condition. */
export interface CriterionGroupDto {
  readonly id: string;
  readonly criteria: readonly CriterionDto[];
}

/** One membership: the entity it gathers, its run record and its condition. `position` is 0-based. */
export interface CampaignMemberDto {
  readonly membershipId: string;
  readonly position: number;
  readonly entity: CampaignMemberEntityDto;
  /** Set once the campaign has claimed the member — dispatched it, or joined it running. */
  readonly claimedAt: string | null;
  readonly joinedRunning: boolean;
  readonly dispatchedAt: string | null;
  readonly dispatch: CampaignDispatchDto;
  readonly dispatchRefusal: string | null;
  readonly dispatchRefusedAt: string | null;
  readonly dispatchError: string | null;
  readonly groups: readonly CriterionGroupDto[];
}

/** A campaign with its start and its members, ordered by position. */
export interface CampaignDto {
  readonly id: string;
  readonly number: number;
  readonly qualifiedId: string | null;
  readonly projectId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: EntityStatus;
  /** Whether the phase behind the current status cannot proceed — {@link TicketDto.blocked}, rule for rule. */
  readonly blocked?: boolean;
  readonly start: CampaignStartDto | null;
  readonly members: readonly CampaignMemberDto[];
}

export interface CampaignResponse {
  readonly campaign: CampaignDto;
}

export interface CampaignMemberResponse {
  readonly member: CampaignMemberDto;
}

/** One criterion of a `PUT …/condition` body: `id` restates an existing one and keeps its latch. */
export type ConditionCriterion = CriterionSpec & { readonly id?: string };

/** One OR'd group of a `PUT …/condition` body. The service refuses an empty one. */
export interface ConditionGroup {
  readonly criteria: readonly ConditionCriterion[];
}

/**
 * The eight words a member's progress is, derived by the service in this order, the first match
 * winning: DROPPED, DONE, DISPATCH_FAILED, JOINED_RUNNING, RUNNING, REFUSED, READY, WAITING.
 */
export type CampaignMemberState =
  | 'DROPPED'
  | 'DONE'
  | 'DISPATCH_FAILED'
  | 'JOINED_RUNNING'
  | 'RUNNING'
  | 'REFUSED'
  | 'READY'
  | 'WAITING';

/** The campaign a progress read is of. */
export interface CampaignProgressCampaignDto {
  readonly id: string;
  readonly qualifiedId: string | null;
  readonly title: string;
  readonly status: EntityStatus;
  /** Whether the phase behind the current status cannot proceed — {@link TicketDto.blocked}, rule for rule. */
  readonly blocked?: boolean;
  readonly start: CampaignStartDto | null;
}

/**
 * The criteria evaluator's health: `connected` is the event stream's live connection,
 * `lastSweepCompletedAt` and `stalled` the catch-up sweep's census.
 */
export interface CampaignEvaluatorDto {
  readonly connected: boolean;
  readonly lastSweepCompletedAt: string | null;
  readonly stalled: boolean;
}

/**
 * One criterion judged. The progress read carries **no predicate** — `wouldBeSatisfiedBy` is the
 * service's own sentence for it — and `satisfiable: false` (ENTITY_STATUS alone) comes with `reason`.
 */
export interface CampaignCriterionProgressDto {
  readonly id: string;
  readonly kind: CriterionKind;
  readonly seeded: boolean;
  readonly satisfied: boolean;
  readonly wouldBeSatisfiedBy: string;
  readonly satisfiable: boolean;
  readonly reason: string | null;
  readonly evidence: CriterionEvidenceDto | null;
  readonly approval: CriterionApprovalDto | null;
  readonly satisfiedAt: string | null;
}

/** One OR'd group, and whether every one of its criteria is latched. */
export interface CampaignGroupProgressDto {
  readonly id: string;
  readonly satisfied: boolean;
  readonly criteria: readonly CampaignCriterionProgressDto[];
}

/** One member's progress: its state, what it waits for (entity ids), its condition judged. */
export interface CampaignMemberProgressDto {
  readonly membershipId: string;
  readonly position: number;
  readonly entity: CampaignMemberEntityDto;
  readonly state: CampaignMemberState;
  readonly waitsFor: readonly string[];
  readonly joinedRunning: boolean;
  readonly groups: readonly CampaignGroupProgressDto[];
  readonly dispatchedAt: string | null;
  readonly dispatch: CampaignDispatchDto;
  readonly dispatchRefusal: string | null;
  readonly dispatchRefusedAt: string | null;
  readonly dispatchError: string | null;
}

/** How a campaign is doing — derived on every read; nothing of it is stored. */
export interface CampaignProgressDto {
  readonly campaign: CampaignProgressCampaignDto;
  readonly evaluator: CampaignEvaluatorDto;
  readonly members: readonly CampaignMemberProgressDto[];
}

/**
 * `GET /campaigns/{id}/progress`'s answer — and what the start press
 * (`POST /entities/{id}/dispatch` on a campaign) answers too.
 */
export interface CampaignProgressResponse {
  readonly progress: CampaignProgressDto;
}
