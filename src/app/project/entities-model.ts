import type { QitsBadgeTone } from '@qits/ui-components';
import type {
  EpicDto,
  EpicStatus,
  FeatureDto,
  TaskDto,
  TicketCommentDto,
  TicketDto,
  TicketStatus,
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
  /** The live workspaces working on this entity, derived by the service on every read. */
  readonly workspaces: readonly WorkspaceReferenceDto[];
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
  readonly status: EpicStatus;
  /** The draft that replaced this one. Set only on a `SUPERSEDED` epic; null on every other. */
  readonly supersededByEpicId: string | null;
  readonly features: readonly FeatureNode[];
}

/** A ticket: one small, self-contained piece of work, read as a row. */
export interface TicketEntity extends EntityFields {
  readonly archetype: 'TICKET';
  readonly status: TicketStatus;
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
export function ofArchetype(
  entities: readonly Entity[],
  archetype: Archetype,
): readonly Entity[] {
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
 * The branch a **refining** epic is worked out on: `refining/<epic>`.
 *
 * <p>`refining/` is a fresh top-level prefix, so it cannot collide with `epic/`, `feature/` or
 * `task/` at any depth — and that separation is what the name is for. The other three are branches of
 * the *plan*, cut once the scope is frozen; this one is where the plan is written, and it exists while
 * the slug can still change. Keeping them in different namespaces means a refining branch is never
 * mistaken for the epic's own.
 *
 * <p>Composed like the others rather than stored, for the same reason: the name is a rule, and a
 * stored copy of a rule is free to drift from it. **Nothing records which workspace refines which
 * epic** — the refining workspace of an epic *is* the ACTIVE workspace on this branch in the project's
 * wrapper repository, looked up by branch match every time. No column, no drift, and a discarded
 * workspace simply stops being found.
 *
 * <p>The branch lives on the **wrapper** repository, not on a component, because refining is about the
 * whole plan: it reads and writes epics, features and tasks that span every component the project has.
 */
export function refiningBranch(epicSlug: string): string {
  return `refining/${epicSlug}`;
}

/**
 * The epic a branch refines, or null if it refines none.
 *
 * <p>The inverse of {@link refiningBranch}, and it lives beside it so the two forms of one rule cannot
 * drift apart. The reader is the refining page's activity bar: the bar knows a *workspace*, the page is
 * addressed by an *epic*, and this is the only thing that bridges them — nothing stores the pairing.
 *
 * <p>The prefix has to be there and something has to follow it. A branch called exactly `refining/`
 * would otherwise map to the empty slug, which is a URL that resolves to no epic at all.
 */
export function refiningEpicSlug(branch: string | null): string | null {
  const slug = branch?.startsWith('refining/') ? branch.slice('refining/'.length) : '';
  return slug ? slug : null;
}

/** What a line's badge says, and how loudly. One shape for both archetypes and every level below. */
export interface StatusBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

const IMPLEMENTED: StatusBadge = { label: 'implemented', tone: 'success' };
const IN_PROGRESS: StatusBadge = { label: 'in progress', tone: 'info' };
const OPEN: StatusBadge = { label: 'open', tone: 'neutral' };

/** A task is implemented once it has an `implementedAt`, and open until then. */
export function taskStatus(task: Pick<TaskDto, 'implementedAt'>): StatusBadge {
  return task.implementedAt ? IMPLEMENTED : OPEN;
}

/** A feature is implemented once it has an `implementedOn` — the wire's other spelling. */
export function featureStatus(feature: Pick<FeatureDto, 'implementedOn'>): StatusBadge {
  return feature.implementedOn ? IMPLEMENTED : OPEN;
}

/**
 * An epic, read off its features: all of them implemented is implemented, some is in progress,
 * none is open.
 *
 * <p>An epic with no features never reads as implemented <em>here</em> — its features are the only
 * evidence this derivation has, and an epic with none of them offers none. The declared
 * `IMPLEMENTED` status is the service's answer for that epic, and `isDone`/`entityBadge` read it
 * first.
 */
export function epicStatus(entity: EpicEntity): StatusBadge {
  const implemented = entity.features.filter((child) => child.feature.implementedOn).length;
  if (entity.features.length > 0 && implemented === entity.features.length) {
    return IMPLEMENTED;
  }
  return implemented > 0 ? IN_PROGRESS : OPEN;
}

const REFINING: StatusBadge = { label: 'refining', tone: 'info' };
const SUPERSEDED: StatusBadge = { label: 'superseded', tone: 'neutral' };
const ABANDONED: StatusBadge = { label: 'abandoned', tone: 'danger' };

/**
 * A badge per ticket status, and the tones say **how finished**, not how urgent.
 *
 * <p>The three in flight are the accent the palette has and the grey beside it. `REPORTED` is
 * `warning` for the reason the old single open badge was: it is a standing request nobody has
 * picked up, and drawing it in the same grey as a ticket already being worked would make the top of
 * the pipeline read as background. `REFINED` and `IMPLEMENTED` are `neutral` — something is
 * underway and nothing is being claimed about it, which is exactly what the plan's own `neutral`
 * means one archetype over.
 *
 * <p>`VERIFIED` is `info` and not `success`, and that is the distinction worth having. Verified
 * means the platform no longer shows the problem; done means a person agreed to close it. Toning
 * both green would hide the one row on the desk that is waiting for a human sentence.
 *
 * <p>`DONE` is `success`, the same word an implemented epic uses.
 *
 * <p>The five tones are not five distinct colours, because {@link QitsBadgeTone} has five values for
 * the whole application and two of them (`danger`, `info`) are already spoken for by the type badge
 * beside this one. Labels carry the distinction; the tone carries the phase.
 */
const STATUS_BADGES: Readonly<Record<TicketStatus, StatusBadge>> = {
  REPORTED: { label: 'reported', tone: 'warning' },
  REFINED: { label: 'refined', tone: 'neutral' },
  IMPLEMENTED: { label: 'implemented', tone: 'neutral' },
  VERIFIED: { label: 'verified', tone: 'info' },
  DONE: { label: 'done', tone: 'success' },
};

/** What the ticket has achieved — see {@link ../api/dto#TicketStatus} for why that is the reading. */
export function ticketStatusBadge(status: TicketStatus): StatusBadge {
  return STATUS_BADGES[status] ?? STATUS_BADGES.REPORTED;
}

/**
 * The badge on an entity's own header — **one function over both archetypes**, which is the thing two
 * models could not have.
 *
 * <p>A ticket's badge is its status, always: the lifecycle is the whole answer and there is nothing
 * underneath a ticket to derive anything from.
 *
 * <p>An epic's is its lifecycle too, **except in implementation**. That is the phase where the
 * question is how far along it is and the features are the only ones who can answer. In every other
 * phase the lifecycle *is* the answer — an abandoned epic's feature count says nothing worth reading.
 */
export function entityBadge(entity: Entity): StatusBadge {
  if (entity.archetype === 'TICKET') {
    return ticketStatusBadge(entity.status);
  }
  switch (entity.status) {
    case 'REFINING':
      return REFINING;
    case 'IMPLEMENTED':
      return IMPLEMENTED;
    case 'SUPERSEDED':
      return SUPERSEDED;
    case 'ABANDONED':
      return ABANDONED;
    default:
      return epicStatus(entity);
  }
}

/**
 * Whether an entity is finished, in the sense its own archetype means by it.
 *
 * <p>A ticket is done when a person closed it, which is the `DONE` status and nothing else. There is
 * nothing to derive: no children, and `VERIFIED` is deliberately not done — the platform agreeing the
 * problem is gone is not the same as somebody agreeing to close it.
 *
 * <p>An epic is done by the stored `IMPLEMENTED` status **or** by the feature derivation. The
 * derivation came first and stays: an implementation epic with at least one feature and every one of
 * them implemented is done without anything being pressed. `IMPLEMENTED` is the declared spelling the
 * service added for the epic the derivation cannot reach — one implemented straight from its
 * description, with no features to read. The transition that sets it stamps every unmarked feature in
 * the same breath, so the two spellings cannot disagree about one epic.
 */
export function isDone(entity: Entity): boolean {
  if (entity.archetype === 'TICKET') {
    return entity.status === 'DONE';
  }
  if (entity.status === 'IMPLEMENTED') {
    return true;
  }
  return entity.status === 'IMPLEMENTATION' && epicStatus(entity) === IMPLEMENTED;
}

/** The five sections of the epics desk, in the order a reader works down them. */
export interface EpicGroups {
  readonly refining: readonly EpicEntity[];
  readonly implementation: readonly EpicEntity[];
  readonly done: readonly EpicEntity[];
  readonly superseded: readonly EpicEntity[];
  readonly abandoned: readonly EpicEntity[];
}

/**
 * The project's epics, split by where they stand, keeping the service's order inside each group.
 *
 * <p><b>It takes the project's whole collection and filters it, which is what makes the epics desk a
 * *view* rather than a second model.</b> Anything that is not an epic is not this desk's business and
 * is dropped here, once, instead of being kept out by a second fetch.
 *
 * <p>Grouped rather than fetched per status: the desk already reads every epic to build the tree, and
 * `done` cannot be asked for at all — it is a shape of the tree, not a value on the row. One read that
 * is grouped is also one moment; five reads would let two sections disagree about the same epic.
 */
export function groupEpics(entities: readonly Entity[]): EpicGroups {
  const refining: EpicEntity[] = [];
  const implementation: EpicEntity[] = [];
  const done: EpicEntity[] = [];
  const superseded: EpicEntity[] = [];
  const abandoned: EpicEntity[] = [];

  for (const entity of ofArchetype(entities, 'EPIC')) {
    switch (entity.status) {
      case 'REFINING':
        refining.push(entity);
        break;
      case 'IMPLEMENTED':
        done.push(entity);
        break;
      case 'SUPERSEDED':
        superseded.push(entity);
        break;
      case 'ABANDONED':
        abandoned.push(entity);
        break;
      default:
        (isDone(entity) ? done : implementation).push(entity);
    }
  }

  return { refining, implementation, done, superseded, abandoned };
}

/**
 * The lifecycle in order, which is the only place that order is written down.
 *
 * Everything else about a ticket is derived from it: the badge, the adjacency a transition control
 * offers, and the order the outstanding section reads down. A second copy of this sequence would be a
 * second opinion about what comes after what, and the one that was not updated would be the one drawn.
 */
export const TICKET_LIFECYCLE: readonly TicketStatus[] = [
  'REPORTED',
  'REFINED',
  'IMPLEMENTED',
  'VERIFIED',
  'DONE',
];

/** The two sections of the tickets desk, in the order a reader works down them. */
export interface TicketGroups {
  readonly outstanding: readonly TicketEntity[];
  readonly done: readonly TicketEntity[];
}

/**
 * The project's tickets, split into **what is still moving and what is closed**: outstanding is
 * anything but `DONE`.
 *
 * <p><b>It filters the same collection {@link groupEpics} filters</b>, from the other end — which is
 * the whole shape of the two desks now. Neither of them owns a list; each owns a view.
 *
 * <p><b>Two lists for five statuses, deliberately.</b> A section per status would put five headings
 * on a desk that usually has one or two rows under each, and would make a ticket's progress a jump
 * between boxes rather than a move down a list. The split that matters to a reader is whether
 * anything is still owed, which is exactly `DONE` or not.
 *
 * <p><b>Outstanding is ordered by the lifecycle, not alphabetically and not by date</b> — reported
 * at the top, then refined, then implemented, then verified — so the section reads as a pipeline and
 * a reader sees where the work is piling up. Within one status it is **newest first**, which is the
 * old rule kept: the row that just arrived is the one being talked about.
 *
 * <p><b>Done is newest first throughout</b>, because it is an archive and what somebody looks up in
 * an archive is usually the most recent thing in it. A status that the lifecycle does not know
 * sorts after the ones it does rather than vanishing: an unrecognised row belongs at the bottom of
 * the desk, not off it.
 */
export function groupTickets(entities: readonly Entity[]): TicketGroups {
  const outstanding: TicketEntity[] = [];
  const done: TicketEntity[] = [];
  for (const entity of ofArchetype(entities, 'TICKET')) {
    (entity.status === 'DONE' ? done : outstanding).push(entity);
  }
  return { outstanding: byLifecycle(newestFirst(outstanding)), done: newestFirst(done) };
}

/** The lifecycle's own order, ties keeping whatever order they arrived in. See {@link groupTickets}. */
function byLifecycle(tickets: readonly TicketEntity[]): readonly TicketEntity[] {
  return tickets
    .map((ticket, index) => ({ ticket, index }))
    .sort((left, right) => phase(left.ticket) - phase(right.ticket) || left.index - right.index)
    .map((entry) => entry.ticket);
}

/** Where a ticket sits on the lifecycle, with an unknown status sorted past every known one. */
function phase(ticket: TicketEntity): number {
  const at = TICKET_LIFECYCLE.indexOf(ticket.status);
  return at < 0 ? TICKET_LIFECYCLE.length : at;
}

/**
 * Newest first, ties keeping the incoming order reversed.
 *
 * <p>Generic over the entity rather than over the ticket, because the rule is about `createdAt` and
 * both archetypes have one. See {@link groupTickets} for why the client imposes an order at all.
 */
export function newestFirst<T extends Entity>(entities: readonly T[]): readonly T[] {
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort(
      (left, right) => createdMs(right.entity) - createdMs(left.entity) || right.index - left.index,
    )
    .map((entry) => entry.entity);
}

/** The creation instant in milliseconds, or the epoch for a stamp that will not parse. */
function createdMs(entity: Entity): number {
  const at = Date.parse(entity.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

/**
 * A move that takes an epic to another point in its life.
 *
 * `confirmLabel` is null for a move worth making by accident. Freezing a draft is one of those — it is
 * the ordinary next step and the epic is still there afterwards — while superseding and abandoning
 * throw away a plan, so each asks in the button itself rather than in a browser dialog the page cannot
 * style or test.
 */
export interface TransitionAction {
  readonly kind: 'transition';
  readonly target: EpicStatus;
  readonly label: string;
  readonly confirmLabel: string | null;
}

/**
 * Open the refining workspace: start (or re-enter) a real qits-workspaces workspace on the wrapper's
 * `refining/<slug>` branch and go to it.
 *
 * <p><b>It is not a status transition, and the discriminant is what keeps it from pretending to be
 * one.</b> The epic does not move: it is `REFINING` before the press and `REFINING` after it. Reaching
 * this through {@link EpicStatus} would mean inventing a fifth status the service has never heard of,
 * and every reader of the epic's status would then have to know that one of its values is not a status.
 *
 * <p>No confirmation, because nothing is thrown away: the flow is find-or-create, so a second press
 * lands in the workspace the first one made.
 */
export interface RefineAction {
  readonly kind: 'refine';
  readonly label: string;
  readonly confirmLabel: null;
}

/**
 * Freeze the scope and put an implementing agent on it: move the epic to `IMPLEMENTATION` **and**
 * stand a real qits-workspaces workspace with a coding agent up on the wrapper's `epic/<slug>`
 * branch, in one press.
 *
 * <p><b>A third kind rather than a flag on the transition, for {@link RefineAction}'s reason turned
 * the other way round.</b> Refine is not a transition because the epic does not move; this one *is* a
 * transition and is still not one, because moving the epic is only half of what the press does. There
 * is a single door behind it — `POST /epics/{id}/dispatch-agent` — which transitions and dispatches in
 * one call and in that order, because the tool the agent is told to mark tasks with is only open to an
 * epic already in implementation. Routing this through `transitionEpic` would do the first half and
 * silently drop the second: a frozen epic with nobody on it.
 *
 * <p>It carries no `target`, for the same reason refine carries none: the status it lands on is the
 * door's decision and not a parameter the browser supplies. A re-press on an epic already in
 * implementation moves nothing and adopts the workspace already on the branch.
 *
 * <p><b>No confirmation.</b> Freezing a scope is the ordinary next step on a draft, and nothing is
 * thrown away — the refinement survives the freeze, and a second press lands in the workspace the
 * first one made rather than starting a second agent. What the press *does* commit to is the scope,
 * and the answer to that is the ordering in {@link actionsFor} rather than a second click: refining
 * comes first, and the press that ends it is not the one nearest the reader's hand.
 */
export interface StartAction {
  readonly kind: 'start';
  readonly label: string;
  readonly confirmLabel: null;
}

/**
 * Put a workspace and a coding agent on a ticket.
 *
 * <p><b>A ticket's one move, and it is its own kind rather than a {@link StartAction} reused.</b> The
 * two presses look alike from a button's side and go to different doors — `tickets/{id}/dispatch-agent`
 * against `epics/{id}/dispatch-agent` — and only one of them also transitions the row. Spelling them
 * with one discriminant would mean the panel that handles a press has to re-read the archetype to know
 * which door it meant, which is exactly the string compare this model exists to hold.
 *
 * <p>No confirmation: the door is find-or-create, so a second press re-enters the same workspace. That
 * is Refine's argument, word for word.
 */
export interface AssignAction {
  readonly kind: 'assign';
  readonly label: string;
  readonly confirmLabel: null;
}

/** One move a reader can make on an entity, of whichever archetype. */
export type EntityAction = TransitionAction | RefineAction | StartAction | AssignAction;

const REFINE: RefineAction = { kind: 'refine', label: 'Refine', confirmLabel: null };
const START: StartAction = {
  kind: 'start',
  label: 'Start implementation',
  confirmLabel: null,
};
const ASSIGN: AssignAction = { kind: 'assign', label: 'Assign agent', confirmLabel: null };
const SUPERSEDE: TransitionAction = {
  kind: 'transition',
  target: 'SUPERSEDED',
  label: 'Supersede',
  confirmLabel: 'Confirm supersede?',
};
const MARK_IMPLEMENTED: TransitionAction = {
  kind: 'transition',
  target: 'IMPLEMENTED',
  label: 'Mark implemented',
  // One-way, and it stamps every still-open feature and task — worth a second press.
  confirmLabel: 'Confirm implemented?',
};
const ABANDON: TransitionAction = {
  kind: 'transition',
  target: 'ABANDONED',
  label: 'Abandon',
  confirmLabel: 'Confirm abandon?',
};

/**
 * What can be done to an entity where it now stands — **the archetype's own moves, chosen here rather
 * than by whichever component happened to be drawing it.**
 *
 * <p>An epic gets the service's legal transitions, mirrored, plus the two actions on a draft that are
 * not transitions. Mirrored rather than guessed at from the buttons: the server validates every move
 * and answers a 409 for the rest, so this list is only about not offering a press that cannot work.
 * The two terminal states offer nothing, which is what makes their rows a summary rather than a card.
 *
 * <p><b>Refine comes first on a draft, ahead of freezing it.</b> The order is the order of the work:
 * refining is what a `REFINING` epic is *for*, and freezing the scope is what you do when the refining
 * is finished. Putting the ordinary next step at the front and the ending second would make the
 * destructive-adjacent press the closest one to hand.
 *
 * <p>A ticket gets the one press it has, and a closed ticket gets none: offering to put an agent on
 * something a person has already closed would be offering to reopen it sideways. The ticket's
 * lifecycle moves are not here — they live on its detail page, where there is room to say what each
 * one claims ({@link ticketTransitions}).
 */
export function actionsFor(entity: Entity): readonly EntityAction[] {
  if (entity.archetype === 'TICKET') {
    return entity.status === 'DONE' ? [] : [ASSIGN];
  }
  switch (entity.status) {
    case 'REFINING':
      return [REFINE, START, ABANDON];
    case 'IMPLEMENTATION':
      return [MARK_IMPLEMENTED, SUPERSEDE, ABANDON];
    case 'IMPLEMENTED':
      return [SUPERSEDE];
    default:
      return [];
  }
}

/**
 * What identifies one action among the row — for `track`, and for saying which button is busy.
 *
 * A transition is identified by where it goes, which is unique within a phase; the three that are not
 * transitions are identified by their own discriminant, so the key is `refine`, `start` or `assign`.
 *
 * <p><b>Total and collision-free over all four kinds, and both halves are structural rather than
 * lucky.</b> Total: the union is discriminated, so the one branch that is not a transition covers the
 * other three together and TypeScript narrows the remaining one to something with a `target` — a fifth
 * kind would have to widen `action.kind` and would land in that same branch as its own literal, never
 * as `undefined`. Collision-free: the non-transition keys are the discriminants themselves, which are
 * lower-case, while every transition key is an `EpicStatus`, a closed screaming-case set — so no value
 * of one can ever spell a value of the other.
 */
export function actionKey(action: EntityAction): string {
  return action.kind === 'transition' ? action.target : action.kind;
}

/**
 * One move a ticket can make along its own lifecycle, and the claim pressing it makes.
 *
 * <p>Separate from {@link EntityAction} because it is a different *control*: the detail page draws
 * these as a row of lifecycle steps with a direction, where the action row draws the one thing that
 * puts an agent on the row. Folding them together would give a card a "Back to reported" button it has
 * no room to explain.
 */
export interface TicketTransition {
  readonly target: TicketStatus;
  readonly label: string;
  /** Forward is the pipeline's direction; backward is a correction. */
  readonly forward: boolean;
}

/**
 * What each move is called, **named after the claim it makes** rather than after the state it lands
 * in.
 *
 * Forward, a press asserts that a phase finished: "Mark refined" says the ticket now says what to
 * do. `DONE` is "Close", because that is the word a person uses for it and "mark done" would be the
 * one label on this row that described a column rather than an act. Backward, a press retracts a
 * claim — "Back to refined" says the implementation is not there after all — and the one move out of
 * `DONE` is "Reopen", which is what reopening has always been called.
 */
const FORWARD_LABELS: Readonly<Record<TicketStatus, string>> = {
  REPORTED: 'Mark reported',
  REFINED: 'Mark refined',
  IMPLEMENTED: 'Mark implemented',
  VERIFIED: 'Mark verified',
  DONE: 'Close',
};

const BACKWARD_LABELS: Readonly<Record<TicketStatus, string>> = {
  REPORTED: 'Back to reported',
  REFINED: 'Back to refined',
  IMPLEMENTED: 'Back to implemented',
  VERIFIED: 'Reopen',
  DONE: 'Back to done',
};

/**
 * The moves a ticket may make: its **neighbours on the lifecycle and nothing else**, forward first.
 *
 * <p><b>Adjacent-only in either direction, and the current status is not among them.</b> The service
 * refuses both a two-step move and a move to the status already held, so a control that offered
 * either would be offering a 409 — and the reason it is computed here rather than in the page is
 * that this is the rule the whole screen is drawn from, and a rule inside a template is one nothing
 * can test without a browser around it.
 *
 * <p>Forward first because the pipeline's direction is what a reader is usually pressing, and the
 * backward move is a correction they go looking for. The ends have one neighbour each, which is how
 * "nothing is terminal" draws: `DONE` still offers Reopen.
 */
export function ticketTransitions(status: TicketStatus): readonly TicketTransition[] {
  const at = TICKET_LIFECYCLE.indexOf(status);
  if (at < 0) {
    return [];
  }
  const moves: TicketTransition[] = [];
  const ahead = TICKET_LIFECYCLE[at + 1];
  const behind = TICKET_LIFECYCLE[at - 1];
  if (ahead) {
    moves.push({ target: ahead, label: FORWARD_LABELS[ahead], forward: true });
  }
  if (behind) {
    moves.push({ target: behind, label: BACKWARD_LABELS[behind], forward: false });
  }
  return moves;
}

/**
 * A bug is `danger` and an improvement is `info`, which is the distinction doing the most work on
 * the tickets desk.
 *
 * The two are read together — a reader scanning the outstanding section is deciding what to pick up
 * — so they have to be told apart at a glance rather than by reading. Red against blue does that;
 * two neighbouring greys would leave the type badge as decoration.
 */
const BUG: StatusBadge = { label: 'bug', tone: 'danger' };
const IMPROVEMENT: StatusBadge = { label: 'improvement', tone: 'info' };

/** What a ticket is about. */
export function ticketTypeBadge(type: TicketType): StatusBadge {
  return type === 'BUG' ? BUG : IMPROVEMENT;
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
 * The element id an entity's card carries, and therefore what an in-page link points at.
 *
 * <p>The archetype is in the id and not only the row's own id, because the two desks are separate
 * screens that may one day be one: `epic-e1` and `ticket-e1` are different anchors even where a
 * migration gave the two rows the same key. It takes the id rather than the entity so that a link can
 * be composed for a row this list does not hold — which is exactly what a superseded epic's successor
 * link is.
 */
export function entityAnchor(archetype: Archetype, id: string): string {
  return `${archetype === 'EPIC' ? 'epic' : 'ticket'}-${id}`;
}

/** Every entity's title by id, so a superseded row can name the draft that replaced it. */
export function entityTitles(entities: readonly Entity[]): ReadonlyMap<string, string> {
  return new Map(entities.map((entity) => [entity.id, entity.title]));
}

/**
 * Where one ticket lives: `/<project>/tickets/<slug>`, as a router command array.
 *
 * <p>Composed here, and spelled with the **slug** on both segments, because that is this platform's
 * address grammar everywhere — the project's first segment is its slug and so is the ticket's. The
 * id would work for neither: nothing resolves a ticket id in the URL, and a project id in the first
 * segment is corrected away the moment it renders.
 *
 * <p>A rule rather than a stored field, for the reason the branch names are: a second copy of an
 * address is free to drift from the route table that serves it.
 *
 * <p><b>There is no `epicRoute` beside it, and the asymmetry is the product's rather than this
 * file's.</b> An epic has no detail page — it is read on its card, and the only address that names one
 * is its refining room. Inventing a route here so the two archetypes looked alike would spell a URL
 * nothing serves.
 */
export function ticketRoute(projectSlug: string, ticketSlug: string): readonly string[] {
  return ['/', projectSlug, 'tickets', ticketSlug];
}

/** The tickets desk's own address, which is where a deleted ticket's page sends the reader back to. */
export function ticketsRoute(projectSlug: string): readonly string[] {
  return ['/', projectSlug, 'tickets'];
}

/**
 * The entity of one archetype a slug names, or null when this collection holds none.
 *
 * <p><b>The archetype is a parameter rather than a search across everything</b>, because a slug is
 * only unique within one of them: nothing stops an epic and a ticket on the same project from being
 * called `cancelled-badge`, and a resolver that took the first match would open whichever the server
 * happened to list first.
 *
 * <p>Null is an ordinary answer and not an error: a detail page resolves its address against the
 * project's collection, so a slug nobody has is exactly the not-found this returns. Matched on the
 * slug alone and never on the id — the segment is the slug by construction, and accepting an id here
 * would quietly bless an address the route table does not promise to keep working.
 */
export function entityBySlug(
  entities: readonly Entity[],
  archetype: 'EPIC',
  slug: string,
): EpicEntity | null;
export function entityBySlug(
  entities: readonly Entity[],
  archetype: 'TICKET',
  slug: string,
): TicketEntity | null;
export function entityBySlug(
  entities: readonly Entity[],
  archetype: Archetype,
  slug: string,
): Entity | null {
  return (
    entities.find((entity) => entity.archetype === archetype && entity.slug === slug) ?? null
  );
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
export function isEdited(comment: Pick<TicketCommentDto, 'createdAt' | 'updatedAt'>): boolean {
  const created = Date.parse(comment.createdAt);
  const updated = Date.parse(comment.updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) {
    return false;
  }
  return updated > created;
}
