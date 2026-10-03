import type { QitsBadgeTone, QitsButtonVariant } from '@qits/ui-components';
import type { ArchetypeRegistry, ArchetypeSpecDto } from '../api/archetypes-api';
import type {
  CommentDto,
  EntityStatus,
  EpicDto,
  FeatureDto,
  TaskDto,
  TicketDto,
  TicketType,
  WorkspaceReferenceDto,
} from '../api/dto';

/**
 * **One entity, two archetypes** — the plan a project is changed by and the small work beside it, as
 * a single client model.
 *
 * <p>This file replaces `epics-model.ts` and `tickets-model.ts`, which were two parallel models of
 * the same thing: a titled, slugged, project-scoped row with a status, a description, a set of live
 * workspaces and a lifecycle somebody presses buttons on. Keeping two of those meant every rule that
 * is genuinely shared — the badge shape, the anchor grammar, the newest-first ordering, what a busy
 * button is keyed on — was written twice and free to drift, and every screen that wanted to say
 * something about "the work on this project" had to say it about epics and then again about tickets.
 *
 * <p><b>The archetype is a field on the entity, not a file the entity lives in.</b> That is the one
 * decision everything else here follows from. A `switch (entity.archetype)` inside a model function
 * is a rule with one home and a test around it; an `*ngIf="isTicket"` scattered through templates is
 * the same rule with no home at all, and it rots the first time an archetype gains a third value.
 *
 * <p><b>Two archetypes and no more, because the two are genuinely different shapes.</b> An epic is
 * read as a *tree* — features, and tasks under them — and a ticket is read as a *row* with a kind and
 * an impetus. The union's arms carry exactly that difference and the fields above them carry
 * everything both have. Lifting the common fields rather than holding two wire DTOs side by side is
 * what makes a card, a row and an action button able to take an `Entity` without asking which kind it
 * got.
 *
 * <p><b>There is no unified read on the wire, deliberately.</b> The service migrated the data to one
 * table and left the REST contract byte-identical, so `GET …/epics` and `GET …/tickets` are still the
 * two reads and still answer `EpicDto` and `TicketDto`. The archetype is therefore stamped **here**,
 * at the boundary, by {@link epicEntity} and {@link ticketEntity} — which is the only place in this
 * client that knows which endpoint a row came from, and the reason nothing downstream has to.
 *
 * <p>No Angular in this file, for the reason both of its ancestors gave: every answer is derived from
 * the wire shapes alone, and each is the kind of rule that stays plausible while being wrong — a
 * branch name one segment off sends somebody to a ref that does not exist, a section a row silently
 * falls out of is a row simply gone from the page.
 */

/** Which kind of thing an entity is. The discriminant, and the only filter any desk needs. */
export type Archetype = 'EPIC' | 'TICKET';

/** One feature and the tasks under it. A feature with no tasks is a leaf, not an error. */
export interface FeatureNode {
  readonly feature: FeatureDto;
  readonly tasks: readonly TaskDto[];
}

/**
 * What every entity has, whichever archetype it takes.
 *
 * <p>`number` and `qualifiedId` are the pair the unified entity gained: a per-project counter, and
 * the human-readable spelling of it — `qits-1337` — that the service renders from the project's own
 * key. **`qualifiedId` is nullable**, and null exactly when the owning project row could not be
 * resolved, which is a fact to draw nothing for rather than a fact to draw `null-` for.
 */
interface EntityFields {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  /** The per-project counter. Always present; it is what `qualifiedId` is composed from. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null when the project could not be resolved. Never draw a null. */
  readonly qualifiedId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Every workspace cut for this entity, live and resolved, derived by the service on every read —
   * so the entity keeps a link to where its work happened after the work is over. Only the `ACTIVE`
   * ones bear on whether a dispatching button is offered; see {@link WorkspaceReferenceDto.status}.
   */
  readonly workspaces: readonly WorkspaceReferenceDto[];
  /**
   * Whether the phase behind the current status cannot proceed — see {@link ../api/dto#TicketDto}.
   *
   * <p>Required here where the wire's is optional, because the boundary is where a missing field
   * stops being a question: {@link epicEntity} and {@link ticketEntity} resolve absent to false once,
   * and nothing downstream has to remember that `undefined` means "not blocked". Lifted onto every
   * lifecycle archetype rather than left on the ticket alone: an epic and a campaign block the same
   * way a ticket does, through the same door.
   */
  readonly blocked: boolean;
}

/**
 * An epic: the backbone of a change, read as a tree.
 *
 * `features` is part of the entity rather than something fetched beside it, because an epic without
 * its features cannot answer the two questions this model is asked most — how far along it is, and
 * whether it is done. Both are derived from the children and from nothing else.
 */
export interface EpicEntity extends EntityFields {
  readonly archetype: 'EPIC';
  readonly status: EntityStatus;
  /** The draft that replaced this one: set on a superseded (so `DROPPED`) epic, null on every other. */
  readonly supersededByEpicId: string | null;
  readonly features: readonly FeatureNode[];
}

/** A ticket: one small, self-contained piece of work, read as a row. */
export interface TicketEntity extends EntityFields {
  readonly archetype: 'TICKET';
  readonly status: EntityStatus;
  readonly type: TicketType;
  /** Why it exists, in the reporter's own words. See {@link IMPETUS_RULE}. */
  readonly impetus: string | null;
  /** Free text — whoever is looking at it. Null when nobody has said. */
  readonly assignee: string | null;
  /** Stamped from the session, never sent. Null for a row with no principal behind it. */
  readonly createdBy: string | null;
}

/** One entity of either archetype. Discriminated, so narrowing is the compiler's job and not a cast. */
export type Entity = EpicEntity | TicketEntity;

/**
 * An epic row and its features, as an entity.
 *
 * <p>The features default to none so that a caller holding only the row — the refining page's
 * subject, a transition's answer — can still make an entity out of it. An epic with no features reads
 * as open rather than as done, which is exactly what {@link epicStatus} says about one, so the
 * default is honest rather than convenient.
 */
export function epicEntity(epic: EpicDto, features: readonly FeatureNode[] = []): EpicEntity {
  return {
    archetype: 'EPIC',
    id: epic.id,
    projectId: epic.projectId,
    title: epic.title,
    slug: epic.slug,
    description: epic.description,
    number: epic.number,
    qualifiedId: epic.qualifiedId,
    createdAt: epic.createdAt,
    updatedAt: epic.updatedAt,
    workspaces: epic.workspaces,
    blocked: epic.blocked ?? false,
    status: epic.status,
    supersededByEpicId: epic.supersededByEpicId,
    features,
  };
}

/** A ticket row, as an entity. */
export function ticketEntity(ticket: TicketDto): TicketEntity {
  return {
    archetype: 'TICKET',
    id: ticket.id,
    projectId: ticket.projectId,
    title: ticket.title,
    slug: ticket.slug,
    description: ticket.description,
    number: ticket.number,
    qualifiedId: ticket.qualifiedId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    workspaces: ticket.workspaces,
    status: ticket.status,
    type: ticket.type,
    blocked: ticket.blocked ?? false,
    impetus: ticket.impetus,
    assignee: ticket.assignee,
    createdBy: ticket.createdBy,
  };
}

/** Whether this entity is an epic, as a type guard so a caller keeps the narrowing. */
export function isEpic(entity: Entity): entity is EpicEntity {
  return entity.archetype === 'EPIC';
}

/** Whether this entity is a ticket. The twin of {@link isEpic}. */
export function isTicket(entity: Entity): entity is TicketEntity {
  return entity.archetype === 'TICKET';
}

/**
 * The entities of one archetype, in the order they arrived.
 *
 * <p><b>This is the archetype filter, and it is here rather than in a template on purpose.</b> A
 * desk draws one archetype out of the project's entities, so the comparison happens once per screen —
 * spelled as `entity.archetype === 'TICKET'` in four templates it would be four copies of a rule with
 * no test around any of them, and the one that was not updated would be the one drawn.
 *
 * <p>The overload pair is what makes a filtered list keep its arm's type: `ofArchetype(rows, 'EPIC')`
 * answers `EpicEntity[]`, so the caller can read `features` off it without a cast.
 */
export function ofArchetype(entities: readonly Entity[], archetype: 'EPIC'): readonly EpicEntity[];
export function ofArchetype(
  entities: readonly Entity[],
  archetype: 'TICKET',
): readonly TicketEntity[];
export function ofArchetype(entities: readonly Entity[], archetype: Archetype): readonly Entity[] {
  return entities.filter((entity) => entity.archetype === archetype);
}

/**
 * The branch naming convention: `epic/<epic>`, `feature/<epic>/<feature>`,
 * `task/<epic>/<feature>/<task>`.
 *
 * The slugs are composed, never read off a field, for the reason the clone url is: the name is a
 * rule, and a stored copy of a rule is free to drift from it. Each level repeats its ancestors'
 * slugs so that a branch says where it belongs without anything having to look it up.
 */
export function epicBranch(epicSlug: string): string {
  return `epic/${epicSlug}`;
}

/** The branch for one feature of an epic. */
export function featureBranch(epicSlug: string, featureSlug: string): string {
  return `feature/${epicSlug}/${featureSlug}`;
}

/** The branch for one task of a feature. */
export function taskBranch(epicSlug: string, featureSlug: string, taskSlug: string): string {
  return `task/${epicSlug}/${featureSlug}/${taskSlug}`;
}

/**
 * The branch an epic or a ticket is refined on: `refining/<slug>`, cut by the service on the
 * project's wrapper when the room is opened.
 *
 * <p>`refining/` is a fresh top-level prefix, so it cannot collide with `epic/`, `feature/`, `task/`
 * or `ticket/` at any depth. The room is **found by the entity it names** (`entityId` on the row), not
 * by this branch; the name is composed here only so the room page can say where a room *would* be
 * before one exists.
 */
export function refiningBranch(epicSlug: string): string {
  return `refining/${epicSlug}`;
}

/** What a line's badge says, and how loudly. One shape for both archetypes and every level below. */
export interface StatusBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

const IMPLEMENTED: StatusBadge = { label: 'implemented', tone: 'success' };
const IN_PROGRESS: StatusBadge = { label: 'in progress', tone: 'info' };
const IMPLEMENTING: StatusBadge = { label: 'implementing', tone: 'info' };
const OPEN: StatusBadge = { label: 'open', tone: 'neutral' };

/**
 * A task's badge: its own lifecycle word once the service serves one (qits-763), the two markers
 * otherwise.
 *
 * <p><b>The status is preferred, and read through {@link statusBadge} like an epic's or a ticket's</b>
 * — so a task at `VERIFYING` or `DONE` reads as that word rather than being flattened to
 * "implemented". <b>The markers are the fallback</b>, for a service that has not grown a status for
 * TASK yet and so answers `status: null`: implemented once `implementedAt` is set, implementing once
 * `implementingAt` is set and `implementedAt` is not, open until either is set. The two can never both
 * apply to a live row — a server new enough to set a task's status sets it in the same transaction as
 * the marker (qits-763) — so this is a compatibility seam, not a choice made every time.
 */
export function taskStatus(
  task: Pick<TaskDto, 'status' | 'implementedAt' | 'implementingAt'>,
): StatusBadge {
  if (task.status) {
    return statusBadge(task.status);
  }
  if (task.implementedAt) {
    return IMPLEMENTED;
  }
  return task.implementingAt ? IMPLEMENTING : OPEN;
}

/**
 * A feature's badge: {@link taskStatus}'s twin, over `implementedOn`/`implementingOn` — the wire's
 * other spelling of the same marker pair — rather than `implementedAt`/`implementingAt`.
 */
export function featureStatus(
  feature: Pick<FeatureDto, 'status' | 'implementedOn' | 'implementingOn'>,
): StatusBadge {
  if (feature.status) {
    return statusBadge(feature.status);
  }
  if (feature.implementedOn) {
    return IMPLEMENTED;
  }
  return feature.implementingOn ? IMPLEMENTING : OPEN;
}

/**
 * An epic's tree, read off its features: all of them implemented is implemented, some is in
 * progress, none is open.
 *
 * <p>This is the *tree's* answer and never the epic's status — the status is the lifecycle word the
 * service stores, and {@link statusBadge} draws it. The two are shown side by side where both matter:
 * a REFINED epic half of whose features have landed is exactly the one worth reading twice.
 */
export function epicStatus(entity: EpicEntity): StatusBadge {
  const implemented = entity.features.filter((child) => child.feature.implementedOn).length;
  if (entity.features.length > 0 && implemented === entity.features.length) {
    return IMPLEMENTED;
  }
  return implemented > 0 ? IN_PROGRESS : OPEN;
}

/**
 * How much of an epic's tree has landed, counted over its tasks — the markers the implement phase
 * sets one by one as each lands. A feature with no tasks counts as one unit of its own, marked by its
 * own `implementedOn`, so an epic planned only down to features still reads honestly.
 */
export interface EpicProgress {
  readonly implemented: number;
  readonly total: number;
}

export function epicProgress(entity: EpicEntity): EpicProgress {
  let implemented = 0;
  let total = 0;
  for (const node of entity.features) {
    if (node.tasks.length === 0) {
      total += 1;
      implemented += node.feature.implementedOn ? 1 : 0;
      continue;
    }
    total += node.tasks.length;
    implemented += node.tasks.filter((task) => task.implementedAt).length;
  }
  return { implemented, total };
}

/**
 * How loudly each lifecycle word is drawn. **One palette, shared with the session names**: this table
 * and `EntityStatusSquare` in qits-coding-agents (`AgentRemoteControl`) draw the same statuses the
 * same way, except `VERIFIED` — the session name marks it with a check mark rather than a square,
 * while this badge stays `warning`, a deliberate divergence (qits-758). Apart from that one status, a
 * change to one is made to both.
 *
 * <p>A lookup and not the vocabulary: which words exist, and their order, is the served registry's
 * answer ({@link statusVocabulary}). A word missing here is drawn neutral with its own name as the
 * label, so a sixth word the service adds tomorrow reads correctly before anybody touches this table.
 *
 * <p>`REPORTED` is grey — a standing request nobody has picked up; `REFINED` is `highlight` (purple);
 * `IMPLEMENTING` is `info` (blue), the same tone as the tree's own in-progress badge — both say work
 * is actively under way; `IMPLEMENTED` also reads `info`, since it is the state `IMPLEMENTING` leads
 * straight into rather than a different kind of thing; `VERIFYING` is `info` too, for the same reason
 * — it is work under way, this time the platform's own verify dispatch rather than an agent's;
 * `VERIFIED` is `warning` (yellow) because it waits on a person to close it; `DONE` is `success`
 * (green); and `DROPPED` is neutral — work nobody is going to do is neither a failure nor an
 * achievement. Red is reserved: it never names a status here, only {@link BLOCKED_BADGE}.
 */
const STATUS_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  REPORTED: 'neutral',
  REFINED: 'highlight',
  IMPLEMENTING: 'info',
  IMPLEMENTED: 'info',
  VERIFYING: 'info',
  VERIFIED: 'warning',
  DONE: 'success',
  DROPPED: 'neutral',
};

/**
 * The badge for any lifecycle word, of any archetype — **generic by construction**: the label is the
 * word itself, lower-cased, and the tone comes from {@link STATUS_TONES} with neutral for the rest.
 */
export function statusBadge(status: EntityStatus | null): StatusBadge {
  if (!status) {
    return { label: 'no status', tone: 'neutral' };
  }
  return { label: statusLabel(status), tone: STATUS_TONES[status] ?? 'neutral' };
}

/** `IMPLEMENTED` → `implemented`, `SOME_WORD` → `some word`. The one rule a status is spelled by. */
export function statusLabel(status: EntityStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/**
 * The badge a blocked ticket carries **beside** its status, never instead of it: blocked says the
 * phase cannot proceed, which is a different fact from how far the ticket has got. `danger` because
 * red is otherwise unused among entity statuses — it names only this fact, nothing else.
 */
export const BLOCKED_BADGE: StatusBadge = { label: 'blocked', tone: 'danger' };

/**
 * Every lifecycle word the service serves, in the order the work walks them — the union of each
 * archetype's served `lifecycle`, first appearance winning.
 *
 * <p>This is **the** status list on this client, and it is read, never written: the desk's sections
 * and the order they run in are derived from it. qits-392 deleted four epic words in one release; a
 * client that had its own list would have drawn them for as long as nobody noticed. On a server older
 * than the `lifecycle` field the words still come from `legalStatuses`, in that (alphabetical) order.
 */
export function statusVocabulary(registry: ArchetypeRegistry): readonly EntityStatus[] {
  const words: EntityStatus[] = [];
  for (const spec of registry.archetypes ?? []) {
    for (const word of walkOf(spec)) {
      if (!words.includes(word)) {
        words.push(word);
      }
    }
  }
  return words;
}

/**
 * The words one archetype may hold, or none for an archetype with no lifecycle — campaign's shorter
 * set, or a feature/task on a server that has not grown one yet (qits-763); every other archetype,
 * including a feature and a task on a current server, answers the eight-word walk.
 */
export function statusesOf(
  registry: ArchetypeRegistry,
  archetype: string,
): readonly EntityStatus[] {
  return specOf(registry, archetype)?.legalStatuses ?? [];
}

/**
 * One archetype's words **in walk order** — the served `lifecycle`, or `legalStatuses` on a server
 * that does not serve one yet. Empty for an archetype with no lifecycle.
 */
export function lifecycleOf(
  registry: ArchetypeRegistry,
  archetype: string,
): readonly EntityStatus[] {
  const spec = specOf(registry, archetype);
  return spec ? walkOf(spec) : [];
}

function specOf(registry: ArchetypeRegistry, archetype: string): ArchetypeSpecDto | undefined {
  return registry.archetypes?.find((spec) => spec.archetype === archetype);
}

function walkOf(spec: ArchetypeSpecDto): readonly EntityStatus[] {
  return spec.lifecycle && spec.lifecycle.length > 0 ? spec.lifecycle : spec.legalStatuses;
}

/**
 * What the grouping and the ordering read off a row — its status and when it was opened — so a desk
 * of epics, tickets and campaigns (qits-419) groups with the one rule.
 */
export interface StatusRow {
  readonly status: EntityStatus | null;
  readonly createdAt: string;
}

/**
 * The statuses the desk opens **collapsed** — the two endings, which are the record rather than the
 * work. Presentation only: it decides whether a section starts open, never what is in it, and a word
 * not named here opens expanded, which is the safe direction for a word nobody has seen.
 */
const ARCHIVE_STATUSES: ReadonlySet<string> = new Set(['DONE', 'DROPPED']);

/** One section of the desk: one status word and the entities holding it, newest first. */
export interface StatusGroup<T extends StatusRow = Entity> {
  readonly status: EntityStatus | null;
  readonly badge: StatusBadge;
  readonly entities: readonly T[];
  /** Whether the section opens collapsed — see {@link ARCHIVE_STATUSES}. */
  readonly archive: boolean;
}

/**
 * The project's entities, split by status in the **registry's** order, empty sections dropped.
 *
 * <p>One section per word rather than a hand-picked split into "outstanding" and "closed": a desk
 * that mixes archetypes has one lifecycle to read, so the pipeline is the natural spine and a reader
 * sees where work piles up. A status the vocabulary does not know is not lost — it gets its own
 * section at the end, labelled with its own word.
 */
export function groupByStatus<T extends StatusRow>(
  entities: readonly T[],
  vocabulary: readonly EntityStatus[],
): readonly StatusGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const entity of entities) {
    const key = entity.status ?? '';
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(entity);
    } else {
      buckets.set(key, [entity]);
    }
  }
  const order = [...vocabulary, ...[...buckets.keys()].filter((key) => !vocabulary.includes(key))];
  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      status: key || null,
      badge: statusBadge(key || null),
      entities: newestFirst(buckets.get(key) ?? []),
      archive: ARCHIVE_STATUSES.has(key),
    }));
}

/**
 * Newest first, ties keeping the incoming order reversed. Generic over the entity, because the rule
 * is about `createdAt` and every archetype has one.
 */
export function newestFirst<T extends StatusRow>(entities: readonly T[]): readonly T[] {
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort(
      (left, right) => createdMs(right.entity) - createdMs(left.entity) || right.index - left.index,
    )
    .map((entry) => entry.entity);
}

/** The creation instant in milliseconds, or the epoch for a stamp that will not parse. */
function createdMs(entity: StatusRow): number {
  const at = Date.parse(entity.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

/** One step an entity can take along its lifecycle, and how the button says it. */
export interface LifecycleMove {
  readonly target: EntityStatus;
  /** The served kind — `FORWARD`, `BACK`, `DROP`, `REOPEN`, or a word this client has not met. */
  readonly kind: string;
  readonly label: string;
  /** How loudly the button is drawn: the step forward is the one the hand should land on. */
  readonly variant: QitsButtonVariant;
}

/**
 * The steps an entity of `archetype` holding `status` may take — **read off the served registry's
 * `transitions`, in the order the service serves them**, and nothing else.
 *
 * <p>The client keeps no table of its own: a status whose array is empty is final (`DONE`) and gets no
 * buttons, and a registry that does not serve `transitions` at all (an older server, mid-rollout) gets
 * none either — a guessed move is a move the server may refuse, or worse, one it would have hidden.
 *
 * <p>The label and weight come from the kind: `FORWARD` is "Mark <word>" and primary, `BACK` is a
 * de-emphasised "Back to <word>", `DROP` is "Drop", `REOPEN` "Reopen", and `SKIP` — `REFINED` to
 * `IMPLEMENTED` directly with no `IMPLEMENTING` in between, or `IMPLEMENTED` to `VERIFIED` directly
 * with no `VERIFYING` in between — is "Skip to <word>". A kind this client has not met is drawn
 * plainly as "Move to <word>".
 */
export function lifecycleMoves(
  registry: ArchetypeRegistry | null,
  archetype: string,
  status: EntityStatus | null,
): readonly LifecycleMove[] {
  if (!registry || !status) {
    return [];
  }
  const served = specOf(registry, archetype)?.transitions?.[status] ?? [];
  return served
    .filter((step) => step.to !== status)
    .map((step) => ({ target: step.to, kind: step.kind, ...drawn(step.kind, step.to) }));
}

/** Whether `status` is final for `archetype`: served, and with no move out of it. */
export function isFinalStatus(
  registry: ArchetypeRegistry | null,
  archetype: string,
  status: EntityStatus | null,
): boolean {
  const transitions = registry && status ? specOf(registry, archetype)?.transitions : undefined;
  const served = transitions && status ? transitions[status] : undefined;
  return served !== undefined && served.length === 0;
}

function drawn(kind: string, target: EntityStatus): Pick<LifecycleMove, 'label' | 'variant'> {
  switch (kind) {
    case 'FORWARD':
      return { label: `Mark ${statusLabel(target)}`, variant: 'primary' };
    case 'BACK':
      return { label: `Back to ${statusLabel(target)}`, variant: 'ghost' };
    case 'DROP':
      return { label: 'Drop', variant: 'ghost' };
    case 'REOPEN':
      return { label: 'Reopen', variant: 'secondary' };
    case 'SKIP':
      return { label: `Skip to ${statusLabel(target)}`, variant: 'ghost' };
    default:
      return { label: `Move to ${statusLabel(target)}`, variant: 'ghost' };
  }
}

/**
 * A bug is `danger` and an improvement is `info`, which is the distinction doing the most work on
 * the tickets desk.
 *
 * The two are read together — a reader scanning the outstanding section is deciding what to pick up
 * — so they have to be told apart at a glance rather than by reading. Red against blue does that;
 * two neighbouring greys would leave the type badge as decoration.
 *
 * `MAINTENANCE` is neither: it is machine-filed, and the platform closes it itself, so it carries
 * none of the urgency the other two are drawn to signal. Neutral, the same tone {@link statusBadge}
 * falls back to for a word it does not recognise, marks it as the odd one out rather than folding it
 * into either.
 */
const BUG: StatusBadge = { label: 'bug', tone: 'danger' };
const IMPROVEMENT: StatusBadge = { label: 'improvement', tone: 'info' };
const MAINTENANCE: StatusBadge = { label: 'maintenance', tone: 'neutral' };

const TICKET_TYPE_BADGES: Readonly<Record<string, StatusBadge>> = {
  BUG,
  IMPROVEMENT,
  MAINTENANCE,
};

/**
 * What a ticket is about. A type this table does not carry — none exist today — is drawn the same
 * way {@link statusBadge} draws an unknown status: neutral, under its own name, rather than folded
 * silently into improvement.
 */
export function ticketTypeBadge(type: TicketType): StatusBadge {
  return TICKET_TYPE_BADGES[type] ?? { label: statusLabel(type), tone: 'neutral' };
}

/**
 * The impetus rule, as a form says it — **a constant rather than template text** because the two
 * shapes it quotes are written with braces, and a `{` in an Angular template opens an ICU message.
 * Escaping them inline would spell the sentence as three interpolations and make the one piece of
 * prose a reporter actually reads the least readable line in the file.
 *
 * <p>It lives here rather than beside the create form because **two** forms quote it: intake writes
 * an impetus and triage fixes a badly written one, and a second copy of the rule would be a second
 * opinion about what an impetus is.
 */
export const IMPETUS_RULE =
  'What brought this about, in your own words: “{some error} occurs {in some context}”, or ' +
  '“{an existing part} should be {something to introduce or improve}”. One sentence, almost ' +
  'always — rarely a paragraph, very rarely two. Steps to reproduce a bug can go here too and do ' +
  'not count against that.';

/**
 * The entity of one archetype a slug names, or null when this collection holds none.
 *
 * <p>Only the redirects from the old slug addresses use it (`/<project>/tickets/<slug>` and
 * `/<project>/epics/<slug>/refining`): the address is the qualified number now. The archetype is a
 * parameter because a slug is only unique within one of them.
 */
export function entityBySlug(
  entities: readonly Entity[],
  archetype: Archetype,
  slug: string,
): Entity | null {
  return entities.find((entity) => entity.archetype === archetype && entity.slug === slug) ?? null;
}

/**
 * Whether a comment has been rewritten since it was posted.
 *
 * There is no `edited` flag on the wire and no revision history, so the two timestamps are the whole
 * of the evidence: `updatedAt` past `createdAt` is the hint, and equal-or-before is a comment as it
 * was written. Compared as parsed instants rather than as strings, because the service is free to
 * change how it formats one and string order would then be arbitrary; a stamp that will not parse
 * reads as unedited, which is the quiet answer rather than the wrong one.
 */
export function isEdited(comment: Pick<CommentDto, 'createdAt' | 'updatedAt'>): boolean {
  const created = Date.parse(comment.createdAt);
  const updated = Date.parse(comment.updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) {
    return false;
  }
  return updated > created;
}
