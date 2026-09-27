import type {
  CampaignMemberDto,
  CampaignSummaryDto,
  ConditionCriterion,
  ConditionGroup,
  CriterionGroupDto,
  CriterionSpec,
  EntityStatus,
  WorkspaceReferenceDto,
} from '../api/dto';
import type { Entity } from './entities-model';

/**
 * **The campaign as a client model** — a root of work on the one desk that gathers other entities
 * and orders their dispatch (epic f6c67e74, qits-419 / qits-420).
 *
 * <p><b>Its own type, beside `Entity` rather than inside it.</b> `entities-model.ts`'s `Archetype`
 * union and its `Entity` arms are epic-and-ticket, and a good deal of this client narrows on them —
 * the reshape panel, the ticket thread, the epic tree. A campaign is none of those shapes: it has no
 * tree, no impetus, and the multi-entity transition refuses it. So the desk's collection is a
 * {@link WorkItem} — an `Entity` *or* a {@link CampaignEntity} — and only the places that draw every
 * root (the desk, a card, a row, the detail page's lookup) have to take the wider type.
 *
 * <p>The rest of this file is the campaign page's rules, as pure functions: what a criterion says as
 * a sentence, which members a member waits for (and whether they sit above or below it), the
 * condition a gesture PUTs, the exact predicate each typed form produces, and what a progress state
 * means. No Angular here, for the same reason as `entities-model.ts`: each is the kind of rule that
 * stays plausible while being wrong.
 */

/** A campaign on the desk. The listing carries no timestamps, slug or description; they are empty. */
export interface CampaignEntity {
  readonly archetype: 'CAMPAIGN';
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly number: number;
  readonly qualifiedId: string | null;
  readonly status: EntityStatus;
  /** Empty: the listing has none, and the desk's newest-first sort reads an empty one as oldest. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Always empty — a campaign's work happens in its members' workspaces, not its own. */
  readonly workspaces: readonly WorkspaceReferenceDto[];
  readonly started: boolean;
  readonly active: boolean;
  /** How many members it gathers. */
  readonly members: number;
}

/** Any root of work the desk lists: an epic, a ticket or a campaign. */
export type WorkItem = Entity | CampaignEntity;

/** A campaign's listing row, as a desk item. */
export function campaignEntity(summary: CampaignSummaryDto): CampaignEntity {
  return {
    archetype: 'CAMPAIGN',
    id: summary.id,
    projectId: summary.projectId,
    title: summary.title,
    slug: '',
    description: null,
    number: summary.number,
    qualifiedId: summary.qualifiedId,
    status: summary.status,
    createdAt: '',
    updatedAt: '',
    workspaces: [],
    started: summary.started,
    active: summary.active,
    members: summary.members,
  };
}

export function isCampaign(item: WorkItem): item is CampaignEntity {
  return item.archetype === 'CAMPAIGN';
}

/** The epics and tickets of a collection — what the reshape form and a member picker are about. */
export function entitiesOf(items: readonly WorkItem[]): readonly Entity[] {
  return items.filter((item): item is Entity => item.archetype !== 'CAMPAIGN');
}

/** "3 members · running", the one line a desk card says about a campaign. */
export function campaignLine(
  campaign: Pick<CampaignEntity, 'members' | 'started' | 'active'>,
): string {
  const count = `${campaign.members} member${campaign.members === 1 ? '' : 's'}`;
  const run = campaign.active ? 'running' : campaign.started ? 'paused' : 'not started';
  return `${count} · ${run}`;
}

// ---- the condition, as sentences -------------------------------------------------------------

/** What a member row needs to know about the other members: its entity and its place. */
export interface MemberRef {
  readonly entityId: string;
  readonly qualifiedId: string | null;
  readonly title: string;
}

export function memberRefs(members: readonly CampaignMemberDto[]): readonly MemberRef[] {
  return members.map((member) => ({
    entityId: member.entity.id,
    qualifiedId: member.entity.qualifiedId,
    title: member.entity.title,
  }));
}

/** A member's name as a line spells it: its qualified id, else its title, else the raw id. */
function nameOf(entityId: string, members: readonly MemberRef[]): string {
  const found = members.find((member) => member.entityId === entityId);
  return found ? (found.qualifiedId ?? found.title) : entityId;
}

/** One criterion, as a sentence — the editor's row. */
export function criterionSentence(criterion: CriterionSpec, members: readonly MemberRef[]): string {
  switch (criterion.kind) {
    case 'ENTITY_STATUS':
      return `${nameOf(criterion.predicate.entityId, members)} reaches ${criterion.predicate.status}`;
    case 'DEPLOYMENT_ACTIVE': {
      const { applicationName, environmentName, minimumVersion } = criterion.predicate;
      const where = environmentName ? ` in ${environmentName}` : '';
      const floor = minimumVersion ? ` at or above ${minimumVersion}` : '';
      return `${applicationName} goes live${where}${floor}`;
    }
    case 'SCM_RELEASE': {
      const { repositoryName, minimumVersion } = criterion.predicate;
      const floor = minimumVersion ? ` at or above ${minimumVersion}` : '';
      return `${repositoryName} releases${floor}`;
    }
    case 'APPROVAL':
      return 'a person approves';
    default:
      return (criterion as { kind: string }).kind;
  }
}

/** One member a row waits for, and where it sits relative to that row. */
export interface WaitTarget {
  readonly entityId: string;
  readonly name: string;
  /** `↑` for a target above the row, `↓` below; empty for one that is not a member any more. */
  readonly marker: '↑' | '↓' | '';
}

/**
 * **Which members a member waits for** — read off its criteria (`ENTITY_STATUS` targets), or off the
 * progress read's `waitsFor` when given, and **never off position**. Order and dependency are two
 * facts: inserting B between A and C leaves C waiting on A, and this line says exactly that. The
 * marker says whether the target sits above (↑) or below (↓) the row.
 */
export function waitTargets(
  member: Pick<CampaignMemberDto, 'entity' | 'groups'>,
  members: readonly Pick<CampaignMemberDto, 'entity'>[],
  waitsFor?: readonly string[],
): readonly WaitTarget[] {
  const ids =
    waitsFor ??
    member.groups.flatMap((group) =>
      group.criteria.flatMap((criterion) =>
        criterion.kind === 'ENTITY_STATUS' ? [criterion.predicate.entityId] : [],
      ),
    );
  const order = members.map((row) => row.entity.id);
  const own = order.indexOf(member.entity.id);
  const refs: MemberRef[] = members.map((row) => ({
    entityId: row.entity.id,
    qualifiedId: row.entity.qualifiedId,
    title: row.entity.title,
  }));
  return [...new Set(ids)].map((entityId) => {
    const at = order.indexOf(entityId);
    const marker = at < 0 || own < 0 ? '' : at < own ? '↑' : '↓';
    return { entityId, name: nameOf(entityId, refs), marker };
  });
}

/** The "waits for" line, or what a member with no condition does instead. */
export function waitsForLine(targets: readonly WaitTarget[], conditioned: boolean): string {
  if (targets.length > 0) {
    return `waits for: ${targets.map((target) => `${target.name} ${target.marker}`.trim()).join(', ')}`;
  }
  return conditioned ? '' : 'runs as soon as the campaign starts';
}

// ---- the condition, as a PUT ---------------------------------------------------------------------

/** One stored criterion restated for the PUT: its id kept, so its latch is kept. */
function restate(criterion: CriterionGroupDto['criteria'][number]): ConditionCriterion {
  return {
    id: criterion.id,
    kind: criterion.kind,
    predicate: criterion.predicate,
  } as ConditionCriterion;
}

/** A member's whole condition as it stands, as the PUT spells it. */
export function conditionOf(groups: readonly CriterionGroupDto[]): readonly ConditionGroup[] {
  return groups.map((group) => ({ criteria: group.criteria.map(restate) }));
}

/**
 * The condition without one criterion. **A group left empty is dropped**, because the service
 * refuses an empty group — it would hold at once, which is nobody's intention for a ✕.
 */
export function withoutCriterion(
  groups: readonly CriterionGroupDto[],
  criterionId: string,
): readonly ConditionGroup[] {
  return conditionOf(groups)
    .map((group) => ({
      criteria: group.criteria.filter((criterion) => criterion.id !== criterionId),
    }))
    .filter((group) => group.criteria.length > 0);
}

/**
 * The condition with one criterion added: "…and wait for" puts it in group `groupIndex` (all of);
 * "or instead…" (`groupIndex` null) opens a new group (any of).
 */
export function withCriterion(
  groups: readonly CriterionGroupDto[],
  added: CriterionSpec,
  groupIndex: number | null,
): readonly ConditionGroup[] {
  const restated = conditionOf(groups);
  if (groupIndex === null || groupIndex < 0 || groupIndex >= restated.length) {
    return [...restated, { criteria: [added] }];
  }
  return restated.map((group, index) =>
    index === groupIndex ? { criteria: [...group.criteria, added] } : group,
  );
}

// ---- the four typed forms ------------------------------------------------------------------------

/** An optional box: trimmed, and an empty one is `null` — every key of a shape is written. */
function optional(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** *Member reaches status*: `{"entityId":…,"status":"VERIFIED"}`. */
export function entityStatusCriterion(entityId: string, status: EntityStatus): CriterionSpec {
  return { kind: 'ENTITY_STATUS', predicate: { entityId, status } };
}

/** *Deployment goes live*: `{"applicationName":…,"environmentName":null|…,"minimumVersion":null|…}`. */
export function deploymentCriterion(
  applicationName: string,
  environmentName?: string | null,
  minimumVersion?: string | null,
): CriterionSpec {
  return {
    kind: 'DEPLOYMENT_ACTIVE',
    predicate: {
      applicationName: applicationName.trim(),
      environmentName: optional(environmentName),
      minimumVersion: optional(minimumVersion),
    },
  };
}

/**
 * *Repository releases*: `{"repositoryName":…,"projectId":null,"minimumVersion":null|…}`. The
 * repository is picked from this project's own, so `projectId` stays null — the name is the
 * coordinate the release event carries.
 */
export function releaseCriterion(
  repositoryName: string,
  minimumVersion?: string | null,
): CriterionSpec {
  return {
    kind: 'SCM_RELEASE',
    predicate: {
      repositoryName: repositoryName.trim(),
      projectId: null,
      minimumVersion: optional(minimumVersion),
    },
  };
}

/** *A person approves*: `{}`. */
export function approvalCriterion(): CriterionSpec {
  return { kind: 'APPROVAL', predicate: {} };
}

/** Whether a member's condition may still be edited: unclaimed, on a campaign still being shaped. */
export function editableMember(
  member: Pick<CampaignMemberDto, 'claimedAt'>,
  campaignStatus: EntityStatus | null,
): boolean {
  return member.claimedAt === null && membershipEditable(campaignStatus);
}

/** Add, move, remove and condition are taken while the campaign is REPORTED or REFINED. */
export function membershipEditable(campaignStatus: EntityStatus | null): boolean {
  return campaignStatus === 'REPORTED' || campaignStatus === 'REFINED';
}
