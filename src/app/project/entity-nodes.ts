import type { EntityStatus, FeatureDto, TaskDto } from '../api/dto';
import type { Entity, EpicEntity, TicketEntity } from './entities-model';

/**
 * **Every node of a project's body of work, flattened** — epics, their features, their tasks, and
 * tickets — so that one number resolves to one node whatever archetype it is.
 *
 * <p>The entity detail route addresses a node by its per-project number (`/qits/work/qits-1337`),
 * and **there is no read door by number**: the service answers epics and tickets as two project
 * lists and features and tasks under their parents. So the page reads the project's collection (the
 * same read the desk makes) and looks the number up here. That costs nothing extra where it matters —
 * a feature's page needs its epic and its siblings anyway, and an epic's page needs its tree — and it
 * is the only way a feature or a task can be reached at all, since neither has a project-level list.
 *
 * <p>No Angular in this file: every answer is a pure function of the wire shapes, and each is the
 * kind of rule that stays plausible while being wrong — a number resolving to the wrong node, a child
 * silently missing from its parent.
 */

/** One node, whatever its archetype. The four shapes' shared fields lifted, the rest kept beside. */
export interface EntityNode {
  readonly id: string;
  /** `EPIC`, `TICKET`, `FEATURE` or `TASK` — a string, as the registry spells archetypes. */
  readonly archetype: string;
  readonly projectId: string;
  readonly number: number;
  readonly qualifiedId: string | null;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  /** The lifecycle word, or null for an archetype with no lifecycle (feature, task). */
  readonly status: EntityStatus | null;
  /** The node above this one: a feature's epic, a task's feature. Null for a root. */
  readonly parentId: string | null;
  /** The implemented marker — `implementedOn` on a feature, `implementedAt` on a task. */
  readonly implementedAt: string | null;
  /** A task's repository. Null on every other archetype. */
  readonly repositoryId: string | null;
  /** The sibling this one waits on, or null. */
  readonly dependsOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The root entity when this node is one (epic, ticket); null for a feature or a task. */
  readonly entity: Entity | null;
  /** The epic this node belongs to — itself for an epic, null for a ticket. */
  readonly epic: EpicEntity | null;
  readonly feature: FeatureDto | null;
  readonly task: TaskDto | null;
}

/**
 * The whole collection as nodes, parents before their children.
 *
 * <p>A ticket has no children; an epic's features and tasks follow it in the tree's own order, which
 * is the order the service lists them in and the order a children list draws them.
 */
export function flattenEntities(entities: readonly Entity[]): readonly EntityNode[] {
  const nodes: EntityNode[] = [];
  for (const entity of entities) {
    if (entity.archetype === 'TICKET') {
      nodes.push(rootNode(entity, null));
      continue;
    }
    nodes.push(rootNode(entity, entity));
    for (const { feature, tasks } of entity.features) {
      nodes.push({
        id: feature.id,
        archetype: 'FEATURE',
        projectId: feature.projectId,
        number: feature.number,
        qualifiedId: feature.qualifiedId,
        title: feature.title,
        slug: feature.slug,
        description: feature.description,
        status: null,
        parentId: feature.epicId,
        implementedAt: feature.implementedOn,
        repositoryId: null,
        dependsOn: feature.dependsOnFeatureId,
        createdAt: feature.createdAt,
        updatedAt: feature.updatedAt,
        entity: null,
        epic: entity,
        feature,
        task: null,
      });
      for (const task of tasks) {
        nodes.push({
          id: task.id,
          archetype: 'TASK',
          projectId: task.projectId,
          number: task.number,
          qualifiedId: task.qualifiedId,
          title: task.title,
          slug: task.slug,
          description: task.description,
          status: null,
          parentId: task.featureId,
          implementedAt: task.implementedAt,
          repositoryId: task.repositoryId,
          dependsOn: task.dependsOnTaskId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          entity: null,
          epic: entity,
          feature,
          task,
        });
      }
    }
  }
  return nodes;
}

function rootNode(entity: Entity, epic: EpicEntity | null): EntityNode {
  return {
    id: entity.id,
    archetype: entity.archetype,
    projectId: entity.projectId,
    number: entity.number,
    qualifiedId: entity.qualifiedId,
    title: entity.title,
    slug: entity.slug,
    description: entity.description,
    status: entity.status,
    parentId: null,
    implementedAt: null,
    repositoryId: null,
    dependsOn: null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    entity,
    epic,
    feature: null,
    task: null,
  };
}

/**
 * The per-project number an address segment names, or null for one that names none.
 *
 * <p>The canonical segment is the qualified form, `qits-1337`, and the bare `1337` is accepted too —
 * a person pasting the number alone should not land on a 404. The number is the **trailing digits
 * after the last hyphen**, because the prefix is the project's slug and a slug may itself contain
 * hyphens (`my-project-12`). The prefix is not checked against the project: the route already names
 * the project in its first segment, and the number is unique within it.
 */
export function parseEntityNumber(segment: string): number | null {
  const match = /^(?:.*-)?(\d+)$/.exec(segment.trim());
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The node a number names in this collection, or null. Numbers are unique per project. */
export function nodeByNumber(nodes: readonly EntityNode[], number: number): EntityNode | null {
  return nodes.find((node) => node.number === number) ?? null;
}

/** The node an id names in this collection, or null. */
export function nodeById(nodes: readonly EntityNode[], id: string | null): EntityNode | null {
  return id ? (nodes.find((node) => node.id === id) ?? null) : null;
}

/** The nodes directly beneath one node, in the tree's order. */
export function childrenOf(nodes: readonly EntityNode[], id: string): readonly EntityNode[] {
  return nodes.filter((node) => node.parentId === id);
}

/** A ticket, narrowed — the template cannot narrow a union itself. */
export function ticketOf(node: EntityNode | null): TicketEntity | null {
  return node?.entity?.archetype === 'TICKET' ? node.entity : null;
}

/**
 * What an address spells a node with: its qualified form, or the bare number when the service could
 * not compose one (a null `qualifiedId` means the project row was not resolved — never draw
 * `null-12`). {@link parseEntityNumber} reads both back.
 */
export function entityAddress(node: Pick<EntityNode, 'qualifiedId' | 'number'>): string {
  return node.qualifiedId ?? String(node.number);
}

/**
 * The one desk: `/<project>/work`, as a router command array. The archetype filter is a query
 * parameter — {@link archetypeFilterParam} — because it is a view of the one place, not a second place.
 */
export function workRoute(projectSlug: string): readonly string[] {
  return ['/', projectSlug, 'work'];
}

/** The query parameter the desk's archetype filter rides in. */
export const ARCHETYPE_PARAM = 'archetype';

/** `EPIC` → `epic`: the filter's spelling in a URL. */
export function archetypeFilterParam(archetype: string): string {
  return archetype.toLowerCase();
}

/** `epic` → `EPIC`, or null for an absent or empty value. The inverse of {@link archetypeFilterParam}. */
export function archetypeFromParam(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

/**
 * One node's page: `/<project>/work/<qualified id>`.
 *
 * <p>The literal `work` segment is load-bearing: `/<project>/<group>/<repository>` and
 * `/<project>/project-setup` are live addresses, so a node can never be `/<project>/<number>`.
 */
export function entityRoute(
  projectSlug: string,
  node: Pick<EntityNode, 'qualifiedId' | 'number'>,
): readonly string[] {
  return [...workRoute(projectSlug), entityAddress(node)];
}

/** One node's refinement room: its page's address plus `refinement`. */
export function refinementRoute(
  projectSlug: string,
  node: Pick<EntityNode, 'qualifiedId' | 'number'>,
): readonly string[] {
  return [...entityRoute(projectSlug, node), 'refinement'];
}

/** A readable name for an archetype word: `FEATURE` → `feature`. */
export function archetypeLabel(archetype: string): string {
  return archetype.toLowerCase().replace(/_/g, ' ');
}

/**
 * The context line the refinement room's prompt helper is given — **what this room is refining**,
 * written per archetype because the two jobs differ (qits-395: nothing on the service composes the
 * refining prompt; the SPA's draft does, and a ticket's room must be told to refine the ticket).
 *
 * <p>An epic's refinement writes its description, its feature/task tree and its dossier. A ticket's
 * writes what is to be done about its impetus into its **description**, with dossier pages where the
 * description cannot hold it — and answers the impetus rather than rewriting it, and stops short of
 * implementing, which is the refine phase's own boundary.
 *
 * <p>Derived, never stored: rename the entity and the next rewrite is told the new name. The entity's
 * id is in it because the room's tools (`list_designs`, `get_design`, `put_design`) take `entityId`.
 */
export function refinePrompt(node: EntityNode): string {
  const name = node.qualifiedId ? `${node.qualifiedId}: ${node.title}` : node.title;
  if (node.archetype === 'TICKET') {
    return [
      `# Refine ticket ${name}`,
      `Refine this ticket (entity id ${node.id}): write what is to be done about its impetus into ` +
        'its description, and put anything the description cannot hold in its dossier. Answer the ' +
        'impetus rather than rewriting it, and do not implement.',
    ].join('\n');
  }
  if (node.archetype === 'EPIC') {
    return [
      `# Refine epic ${name}`,
      `Refine this epic (entity id ${node.id}): its description, its feature/task tree and its ` +
        'dossier.',
    ].join('\n');
  }
  return `# Refine ${archetypeLabel(node.archetype)} ${name}`;
}
