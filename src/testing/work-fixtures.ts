import type { EpicDto, FeatureDto, TaskDto, TicketDto } from '../app/api/dto';
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
  needs: [],
  unmetNeeds: 0,
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
    ...(epic.outcome !== undefined ? { outcome: epic.outcome } : {}),
    acceptanceCriteria: epic.acceptanceCriteria ?? null,
    needs: epic.needs ?? [],
    unmetNeeds: epic.unmetNeeds ?? 0,
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
    supersededBy: ticket.supersededBy ?? null,
    ...(ticket.outcome !== undefined ? { outcome: ticket.outcome } : {}),
    acceptanceCriteria: ticket.acceptanceCriteria ?? null,
    needs: ticket.needs ?? [],
    unmetNeeds: ticket.unmetNeeds ?? 0,
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
    needs: feature.needs ?? [],
    unmetNeeds: feature.unmetNeeds ?? 0,
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
    needs: task.needs ?? [],
    unmetNeeds: task.unmetNeeds ?? 0,
    implementedAt: task.implementedAt ?? null,
    implementingAt: task.implementingAt ?? null,
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
}

/**
 * The answer to a `/work` read of the fixture project, or undefined for a URL that is not one —
 * the listing (`GET /projects/{projectId}/work`), every root's workspaces
 * (`GET /projects/{projectId}/work/workspaces`, qits-1815), one entity, its workspaces and its
 * children. A spec's own router asks this first and answers the rest itself.
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
  if (url === `/projects/api/projects/${projectId}/work`) {
    const rows: WorkEntityDto[] = [];
    for (const { epic, features } of epics) {
      // The listing is the one place an epic's excerpt rides (qits-1821); `workOfEpic` alone is the
      // whole read's shape, which has none.
      rows.push({ ...workOfEpic(epic), excerpt: epic.excerpt ?? null });
      (features ?? []).forEach(({ feature, tasks }, at) => {
        rows.push(workOfFeature(feature, at));
        (tasks ?? []).forEach((task, position) => rows.push(workOfTask(task, position)));
      });
    }
    rows.push(
      ...tickets.map((ticket) => ({ ...workOfTicket(ticket), excerpt: ticket.excerpt ?? null })),
    );
    // The listing is a summary: no description, no acceptance criteria.
    return {
      entities: rows.map((row) => ({
        ...row,
        description: undefined,
        acceptanceCriteria: undefined,
      })),
    };
  }
  if (url === `/projects/api/projects/${projectId}/work/workspaces`) {
    // One entry per ticket or epic that has workspaces, in tree order; none for a row without.
    const roots = [...epics.map((entry) => entry.epic), ...tickets];
    return {
      workspaces: roots
        .filter((root) => (root.workspaces ?? []).length > 0)
        .map((root) => ({
          workId: root.id ?? '',
          qualifiedId: root.qualifiedId ?? null,
          workspaces: root.workspaces ?? [],
        })),
    };
  }
  const match = /^\/projects\/api\/work\/([^/]+)(?:\/(workspaces|children))?$/.exec(url);
  if (!match) return undefined;
  const ref = decodeURIComponent(match[1]);
  const is = (row: { id?: string; qualifiedId?: string | null }) =>
    workRef({ id: row.id ?? '', qualifiedId: row.qualifiedId }) === ref || row.id === ref;
  const epic = epics.find((entry) => is(entry.epic));
  const ticket = tickets.find(is);
  const feature = epics.flatMap((entry) => entry.features ?? []).find((f) => is(f.feature));
  switch (match[2]) {
    case undefined:
      if (epic) return workOfEpic(epic.epic);
      if (ticket) return workOfTicket(ticket);
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
  readonly tags?: readonly string[];
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
  | 'tags'
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
    // Every answer carries tags since qits-634, `[]` when none.
    tags: row.tags ?? [],
  };
}
