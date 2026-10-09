import type {
  CampaignProgressDto,
  CampaignSummaryDto,
  EpicDto,
  FeatureDto,
  TaskDto,
  TicketDto,
} from '../app/api/dto';
import { workRef, type WorkEntityDto } from '../app/api/work';

/**
 * Hand-built fixtures for the plain specs, served the way the `/work` surface answers them (epic
 * qits-965).
 *
 * The client model is built from the per-archetype records (`EpicDto`, `TicketDto`, …) that
 * `api/work.ts` assembles from the merged entity, so the specs keep writing those and this file
 * turns them back into the wire's answers: the inverse of `epicOf`, `ticketOf`, `featureOf`,
 * `taskOf`, and a router for the reads `EntitiesApi.list` makes. The pact specs, not these, pin
 * the wire against qits-projects' golden masters.
 */

type Partial<T> = { readonly [K in keyof T]?: T[K] };

const BASE: WorkEntityDto = {
  id: '',
  archetype: 'EPIC',
  projectId: '',
  number: 0,
  qualifiedId: null,
  title: '',
  slug: '',
  slugScope: null,
  description: null,
  status: null,
  ticketType: null,
  impetus: null,
  assignee: null,
  createdBy: null,
  supersededBy: null,
  repositoryId: null,
  implementedAt: null,
  implementingAt: null,
  dependsOn: null,
  parent: null,
  position: null,
  createdAt: '',
  updatedAt: '',
  acceptanceCriteria: null,
};

/** An epic as `GET /work/{q}` answers it. */
export function workOfEpic(epic: Partial<EpicDto>): WorkEntityDto {
  return {
    ...BASE,
    ...common(epic),
    archetype: 'EPIC',
    status: epic.status ?? null,
    blocked: epic.blocked ?? false,
    blockSource: epic.blockSource,
    blockReason: epic.blockReason,
    blockedBy: epic.blockedBy,
    assignee: epic.assignee ?? null,
    supersededBy: epic.supersededByEpicId ?? null,
    acceptanceCriteria: epic.acceptanceCriteria ?? null,
  };
}

/** A ticket as `GET /work/{q}` answers it. */
export function workOfTicket(ticket: Partial<TicketDto>): WorkEntityDto {
  return {
    ...BASE,
    ...common(ticket),
    archetype: 'TICKET',
    status: ticket.status ?? null,
    blocked: ticket.blocked ?? false,
    blockSource: ticket.blockSource,
    blockReason: ticket.blockReason,
    blockedBy: ticket.blockedBy,
    ticketType: ticket.type ?? null,
    impetus: ticket.impetus ?? null,
    assignee: ticket.assignee ?? null,
    createdBy: ticket.createdBy ?? null,
    acceptanceCriteria: ticket.acceptanceCriteria ?? null,
  };
}

/** A feature as `GET /work/{q}/children` answers it. */
export function workOfFeature(feature: Partial<FeatureDto>, position = 0): WorkEntityDto {
  return {
    ...BASE,
    ...common(feature),
    archetype: 'FEATURE',
    status: feature.status ?? null,
    parent: feature.epicId ?? null,
    position,
    dependsOn: feature.dependsOnFeatureId ?? null,
    implementedAt: feature.implementedOn ?? null,
    implementingAt: feature.implementingOn ?? null,
  };
}

/** A task as `GET /work/{q}/children` answers it. */
export function workOfTask(task: Partial<TaskDto>, position = 0): WorkEntityDto {
  return {
    ...BASE,
    ...common(task),
    archetype: 'TASK',
    status: task.status ?? null,
    parent: task.featureId ?? null,
    position,
    repositoryId: task.repositoryId ?? null,
    dependsOn: task.dependsOnTaskId ?? null,
    implementedAt: task.implementedAt ?? null,
    implementingAt: task.implementingAt ?? null,
  };
}

/** A campaign's row in the listing. */
export function workOfCampaign(campaign: Partial<CampaignSummaryDto>): WorkEntityDto {
  return {
    ...BASE,
    ...common(campaign as Partial<EpicDto>),
    archetype: 'CAMPAIGN',
    status: campaign.status ?? null,
    blocked: campaign.blocked ?? false,
    blockSource: campaign.blockSource,
    blockReason: campaign.blockReason,
    blockedBy: campaign.blockedBy,
  };
}

/** The progress a campaign summary's `started`/`active`/`members` are read off. */
export function progressOfSummary(campaign: Partial<CampaignSummaryDto>): CampaignProgressDto {
  const started = campaign.started ?? false;
  return {
    campaign: {
      id: campaign.id ?? '',
      qualifiedId: campaign.qualifiedId ?? null,
      title: campaign.title ?? '',
      status: campaign.status ?? 'REPORTED',
      blocked: campaign.blocked ?? false,
      blockSource: campaign.blockSource,
      blockReason: campaign.blockReason,
      blockedBy: campaign.blockedBy,
      start: started
        ? {
            firstStartedAt: null,
            startedAt: null,
            startedBy: null,
            active: campaign.active ?? false,
          }
        : null,
    },
    evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
    members: Array.from({ length: campaign.members ?? 0 }, (_, position) => ({
      membershipId: `${campaign.id}-m${position}`,
      position,
      entity: {
        id: `${campaign.id}-e${position}`,
        archetype: 'TICKET',
        qualifiedId: null,
        title: '',
        status: 'REPORTED',
        blocked: false,
      },
      state: 'WAITING',
      waitsFor: [],
      joinedRunning: false,
      groups: [],
      dispatchedAt: null,
      dispatch: { workspaceId: null, branch: null, agentLaunch: null },
      dispatchRefusal: null,
      dispatchRefusedAt: null,
      dispatchError: null,
    })),
  };
}

/** One epic of a fixture project, with its features and their tasks. */
export interface EpicFixture {
  readonly epic: Partial<EpicDto>;
  readonly features?: readonly {
    readonly feature: Partial<FeatureDto>;
    readonly tasks?: readonly Partial<TaskDto>[];
  }[];
}

/** A fixture project's work, per archetype. */
export interface WorkFixture {
  readonly epics?: readonly (EpicFixture | Partial<EpicDto>)[];
  readonly tickets?: readonly Partial<TicketDto>[];
  readonly campaigns?: readonly Partial<CampaignSummaryDto>[];
}

/**
 * The answer to a `/work` read of the fixture project, or undefined for a URL that is not one —
 * the listing (`GET /projects/{projectId}/work`), one entity, its workspaces, its children, and a
 * campaign's progress. A spec's own router asks this first and answers the rest itself.
 */
export function workAnswer(
  projectId: string,
  fixture: WorkFixture,
  url: string,
  method = 'GET',
): object | undefined {
  if (method !== 'GET') return undefined;
  const epics = (fixture.epics ?? []).map((entry) =>
    'epic' in entry ? (entry as EpicFixture) : { epic: entry as Partial<EpicDto> },
  );
  const tickets = fixture.tickets ?? [];
  const campaigns = fixture.campaigns ?? [];
  if (url === `/projects/api/projects/${projectId}/work`) {
    const rows: WorkEntityDto[] = [];
    for (const { epic, features } of epics) {
      rows.push(workOfEpic(epic));
      (features ?? []).forEach(({ feature, tasks }, at) => {
        rows.push(workOfFeature(feature, at));
        (tasks ?? []).forEach((task, position) => rows.push(workOfTask(task, position)));
      });
    }
    rows.push(...tickets.map(workOfTicket), ...campaigns.map(workOfCampaign));
    // The listing is a summary: no description, no acceptance criteria.
    return {
      entities: rows.map((row) => ({
        ...row,
        description: undefined,
        acceptanceCriteria: undefined,
      })),
    };
  }
  const match = /^\/projects\/api\/work\/([^/]+)(?:\/(workspaces|children|progress))?$/.exec(url);
  if (!match) return undefined;
  const ref = decodeURIComponent(match[1]);
  const is = (row: { id?: string; qualifiedId?: string | null }) =>
    workRef({ id: row.id ?? '', qualifiedId: row.qualifiedId }) === ref || row.id === ref;
  const epic = epics.find((entry) => is(entry.epic));
  const ticket = tickets.find(is);
  const campaign = campaigns.find(is);
  const feature = epics.flatMap((entry) => entry.features ?? []).find((f) => is(f.feature));
  switch (match[2]) {
    case undefined:
      if (epic) return workOfEpic(epic.epic);
      if (ticket) return workOfTicket(ticket);
      if (campaign) return workOfCampaign(campaign);
      return undefined;
    case 'workspaces':
      if (epic) return { workspaces: epic.epic.workspaces ?? [] };
      if (ticket) return { workspaces: ticket.workspaces ?? [] };
      return undefined;
    case 'children':
      if (epic) {
        return {
          children: (epic.features ?? []).map(({ feature: f }, at) => workOfFeature(f, at)),
        };
      }
      if (feature) return { children: (feature.tasks ?? []).map((t, at) => workOfTask(t, at)) };
      return undefined;
    case 'progress':
      return campaign ? { progress: progressOfSummary(campaign) } : undefined;
  }
  return undefined;
}

function common(row: {
  readonly id?: string;
  readonly projectId?: string;
  readonly number?: number;
  readonly qualifiedId?: string | null;
  readonly title?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}): Pick<
  WorkEntityDto,
  | 'id'
  | 'projectId'
  | 'number'
  | 'qualifiedId'
  | 'title'
  | 'slug'
  | 'description'
  | 'createdAt'
  | 'updatedAt'
> {
  return {
    id: row.id ?? '',
    projectId: row.projectId ?? '',
    number: row.number ?? 0,
    qualifiedId: row.qualifiedId ?? null,
    title: row.title ?? '',
    slug: row.slug ?? '',
    description: row.description ?? null,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}
