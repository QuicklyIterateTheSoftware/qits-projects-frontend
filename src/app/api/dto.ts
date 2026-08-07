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
 * total surface is six endpoints.
 */

/**
 * What a repository is for.
 *
 * The six **placeable** archetypes each name a directory in the wrapper's `.gitmodules`, and that
 * directory is what makes them placeable: a component repository lives at `<directory>/<name>` or
 * it is not part of the project. `PROJECT` is the wrapper itself, `SERVICE_TEMPLATE` and `FORK` are
 * rows that deliberately sit outside any wrapper.
 *
 * `INTEGRATION` and `APPLICATION` are legacy values that release A still reads off old rows —
 * {@link normalizeArchetype} folds them into `LIBRARY` and `FRONTEND`. Both arms go away with
 * release B, and so do these two union members.
 */
export type PlaceableArchetype = 'SERVICE' | 'DAEMON' | 'LIBRARY' | 'FRONTEND' | 'CLI' | 'IMAGE';

/** Every archetype the service can answer with, placeable or not, current or legacy. */
export type RepositoryArchetype =
  PlaceableArchetype | 'PROJECT' | 'SERVICE_TEMPLATE' | 'FORK' | 'INTEGRATION' | 'APPLICATION';

/** One group on the project page: an archetype, the wrapper directory it lands in, and its words. */
export interface ComponentType {
  readonly archetype: PlaceableArchetype;
  /** The directory under the wrapper root — the derivation the server's reconcile also makes. */
  readonly directory: string;
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

/** The legacy values and what they became. Deleted with release B, along with their union arms. */
const LEGACY_ARCHETYPES: Readonly<Record<string, PlaceableArchetype>> = {
  INTEGRATION: 'LIBRARY',
  APPLICATION: 'FRONTEND',
};

/**
 * The archetype as the current taxonomy names it.
 *
 * Applied on the way in rather than trusted from the wire, because release A widens the check
 * constraint without rewriting rows: a repository row written before the rework legitimately still
 * says `INTEGRATION`, and a page that grouped on the raw value would draw an "other" bucket for a
 * library. Anything unrecognised passes through untouched — inventing a group for it would hide it.
 */
export function normalizeArchetype(archetype: RepositoryArchetype): RepositoryArchetype {
  return LEGACY_ARCHETYPES[archetype] ?? archetype;
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
 * `url` is null for a repository born blank on the platform git host: there is no external origin
 * to name, only the host's own name-addressed route.
 */
export interface RepositoryDto {
  readonly id: string;
  readonly name: string;
  readonly url: string | null;
  readonly mainBranch: string;
  readonly archetype: RepositoryArchetype;
  readonly projectId: string;
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

/** projects' list envelope: entries, each wrapping the thing it lists. */
export interface ProjectEntriesResponse {
  readonly entries: readonly { readonly project: ProjectDto }[];
}

/** The same envelope one level down, plus the wrapper the rows are supposed to agree with. */
export interface RepositoryEntriesResponse {
  readonly entries: readonly { readonly repository: RepositoryDto }[];
  readonly wrapper: WrapperDto | null;
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
}

/** What creation came to: the row, its project, and where it landed in the wrapper. */
export interface CreateRepositoryResponse {
  readonly repository: RepositoryDto;
  readonly projectId: string;
  readonly wrapperPath: string;
}

/** What the reconcile did with one wrapper path. */
export type ReconcileAction =
  'CREATED' | 'ADOPTED' | 'KEPT' | 'ARCHETYPE_UPDATED' | 'DEREGISTERED' | 'SKIPPED';

/** One path's outcome. `repositoryId` is null where nothing was resolved — a SKIPPED entry. */
export interface ReconcileOutcomeDto {
  readonly path: string;
  readonly repositoryId: string | null;
  readonly action: ReconcileAction;
  readonly detail: string | null;
}

/**
 * The wrapper reconcile's answer.
 *
 * `warnings` is not an error channel: a path under a directory no archetype names is skipped and
 * said out loud, and the rest of the reconcile still ran. A page that dropped them would leave an
 * entry silently absent from every group.
 */
export interface WrapperReconcileResponse {
  readonly outcomes: readonly ReconcileOutcomeDto[];
  readonly warnings: readonly string[];
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
