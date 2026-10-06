import type {
  CampaignMemberDto,
  CampaignProgressDto,
  CampaignSummaryDto,
  EntityStatus,
  EpicDto,
  FeatureDto,
  TaskDto,
  TicketDto,
  TicketType,
  WorkspaceReferenceDto,
} from './dto';

/**
 * **The `/work` surface's one entity shape** (epic qits-965) — every archetype, addressed by its
 * qualified id (`qits-111`; a UUID still resolves).
 *
 * <p>The service answers the merged entity everywhere under `/projects/api/work`: a project's
 * listing (`GET /projects/{project}/work`), one entity (`GET /work/{q}`), a node's children, a
 * status move, a create. Nearly everything is nullable because the archetype decides which
 * properties a row has — a ticket has no `repositoryId`, an epic no `impetus`.
 *
 * <p><b>The listing is a summary.</b> It carries no `description` and no `acceptanceCriteria`;
 * `GET /work/{q}` and `GET /work/{q}/children` do. That is why both are optional here, and why
 * {@link ../api/entities-api#EntitiesApi.list} reads each root whole.
 */
export interface WorkEntityDto {
  readonly id: string;
  readonly archetype: string;
  readonly projectId: string;
  readonly number: number;
  /** `<projectKey>-<number>` — the address every `/work` path takes. Null when unresolvable. */
  readonly qualifiedId: string | null;
  readonly title: string;
  readonly slug: string;
  readonly slugScope?: string | null;
  /** Absent on the listing's summary rows; see the type's note. */
  readonly description?: string | null;
  readonly status: EntityStatus | null;
  /** What a move left behind; only a move's (and a transition's) answer carries it. */
  readonly statusBefore?: EntityStatus | null;
  readonly ticketType: TicketType | null;
  readonly impetus: string | null;
  readonly assignee: string | null;
  readonly createdBy: string | null;
  /** The successor's id on a superseded (so `DROPPED`) epic. */
  readonly supersededBy: string | null;
  readonly repositoryId: string | null;
  readonly implementedAt: string | null;
  readonly implementingAt?: string | null;
  /** A feature's or a task's sibling dependency, by id. */
  readonly dependsOn: string | null;
  /** The parent's id: a feature's epic, a task's feature; null on a root. */
  readonly parent: string | null;
  readonly position: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly changedBy?: string | null;
  /** On the lifecycle archetypes (epic, ticket, campaign); absent on a feature and a task. */
  readonly blocked?: boolean;
  /** Absent on the listing's summary rows; see the type's note. */
  readonly acceptanceCriteria?: readonly string[] | null;
}

/** `GET /projects/{project}/work`: the project's tree, flat — each root, then its descendants. */
export interface WorkListResponse {
  readonly entities: readonly WorkEntityDto[];
}

/** `GET /work/{q}/children`: the direct children, in membership order. */
export interface WorkChildrenResponse {
  readonly children: readonly WorkEntityDto[];
}

/** `GET /work/{q}/members`, and the answer of a member's move and remove. */
export interface WorkMembersResponse {
  readonly members: readonly CampaignMemberDto[];
}

/** `GET /work/{q}/workspaces`: every workspace a dispatch stood on the entity's branch. */
export interface WorkWorkspacesResponse {
  readonly workspaces: readonly WorkspaceReferenceDto[];
}

/** `GET /work/{q}/progress`. */
export interface WorkProgressResponse {
  readonly progress: CampaignProgressDto;
}

/**
 * The segment a `/work` path addresses an entity by: its qualified id, or — for a row whose project
 * could not be resolved, so it has none — its id, which the service still resolves.
 */
export function workRef(item: {
  readonly id: string;
  readonly qualifiedId?: string | null;
}): string {
  return item.qualifiedId || item.id;
}

/**
 * The client's per-archetype records, assembled from the merged shape at the boundary.
 *
 * <p>`EpicDto`, `TicketDto`, `FeatureDto` and `TaskDto` were the four archetype-shaped reads the
 * service retired for `/work`; the client model (`entities-model.ts`, `entity-nodes.ts`) is still
 * built on them, so the merged row is mapped onto them here, once, rather than every reader learning
 * the merged field names. The renames are the wire's: `supersededBy` was `supersededByEpicId`,
 * `ticketType` was `type`, `parent` was `epicId`/`featureId`, `dependsOn` was
 * `dependsOnFeatureId`/`dependsOnTaskId`, and a feature's `implementedAt`/`implementingAt` were
 * `implementedOn`/`implementingOn`.
 */
export function epicOf(
  work: WorkEntityDto,
  workspaces: readonly WorkspaceReferenceDto[] = [],
): EpicDto {
  return {
    id: work.id,
    projectId: work.projectId,
    title: work.title,
    slug: work.slug,
    description: work.description ?? null,
    number: work.number,
    qualifiedId: work.qualifiedId,
    status: work.status ?? 'REPORTED',
    blocked: work.blocked ?? false,
    supersededByEpicId: work.supersededBy,
    acceptanceCriteria: work.acceptanceCriteria ?? [],
    assignee: work.assignee,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    workspaces,
  };
}

/** A ticket row; see {@link epicOf}. */
export function ticketOf(
  work: WorkEntityDto,
  workspaces: readonly WorkspaceReferenceDto[] = [],
): TicketDto {
  return {
    id: work.id,
    projectId: work.projectId,
    title: work.title,
    slug: work.slug,
    number: work.number,
    qualifiedId: work.qualifiedId,
    type: work.ticketType ?? 'BUG',
    status: work.status ?? 'REPORTED',
    blocked: work.blocked ?? false,
    assignee: work.assignee,
    createdBy: work.createdBy,
    acceptanceCriteria: work.acceptanceCriteria ?? [],
    impetus: work.impetus,
    description: work.description ?? null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    workspaces,
  };
}

/** A feature row; see {@link epicOf}. */
export function featureOf(work: WorkEntityDto): FeatureDto {
  return {
    id: work.id,
    epicId: work.parent ?? '',
    projectId: work.projectId,
    title: work.title,
    slug: work.slug,
    description: work.description ?? null,
    number: work.number,
    qualifiedId: work.qualifiedId,
    dependsOnFeatureId: work.dependsOn,
    status: work.status,
    implementedOn: work.implementedAt,
    implementingOn: work.implementingAt ?? null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
  };
}

/** A task row; see {@link epicOf}. */
export function taskOf(work: WorkEntityDto): TaskDto {
  return {
    id: work.id,
    featureId: work.parent ?? '',
    repositoryId: work.repositoryId ?? '',
    projectId: work.projectId,
    title: work.title,
    slug: work.slug,
    description: work.description ?? null,
    number: work.number,
    qualifiedId: work.qualifiedId,
    dependsOnTaskId: work.dependsOn,
    status: work.status,
    implementedAt: work.implementedAt,
    implementingAt: work.implementingAt ?? null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
  };
}

/**
 * A campaign's desk row: the listing's row plus what its progress says — whether it was ever
 * started, whether that start is live, and how many members it gathers. The retired
 * `GET /projects/{id}/campaigns` summary carried those three; `/work` answers them per campaign.
 */
export function campaignSummaryOf(
  work: WorkEntityDto,
  progress: CampaignProgressDto | null,
): CampaignSummaryDto {
  const start = progress?.campaign.start ?? null;
  return {
    id: work.id,
    number: work.number,
    qualifiedId: work.qualifiedId,
    projectId: work.projectId,
    title: work.title,
    status: work.status ?? 'REPORTED',
    blocked: work.blocked ?? false,
    started: start !== null,
    active: start?.active ?? false,
    members: progress?.members.length ?? 0,
  };
}
