import type { QitsBadgeTone } from '@qits/ui-components';
import type { EpicDto, EpicStatus, FeatureDto, TaskDto } from '../api/dto';

/**
 * The plan a project is changed by, as a tree, and the two things a reader asks of it: what the
 * branch for a line is called, and how the line stands.
 *
 * No Angular here on purpose. Both questions are answered from the wire shapes alone, and both are
 * the kind of rule that stays plausible while being wrong — a branch name that is one segment off
 * sends somebody to a ref that does not exist.
 */

/** One feature and the tasks under it. A feature with no tasks is a leaf, not an error. */
export interface FeatureNode {
  readonly feature: FeatureDto;
  readonly tasks: readonly TaskDto[];
}

/** One epic and the features under it. */
export interface EpicNode {
  readonly epic: EpicDto;
  readonly features: readonly FeatureNode[];
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

/** What a line's badge says, and how loudly. */
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
 * <p><b>Known limitation: an epic with no features never reads as implemented.</b> An epic carries
 * no completion field of its own, so its features are the only evidence there is, and an epic with
 * none of them offers none. Open is the honest answer for that case — claiming an epic nobody has
 * broken down is finished would be inventing a fact from an absence.
 */
export function epicStatus(node: EpicNode): StatusBadge {
  const implemented = node.features.filter((child) => child.feature.implementedOn).length;
  if (node.features.length > 0 && implemented === node.features.length) {
    return IMPLEMENTED;
  }
  return implemented > 0 ? IN_PROGRESS : OPEN;
}

const REFINING: StatusBadge = { label: 'refining', tone: 'info' };
const SUPERSEDED: StatusBadge = { label: 'superseded', tone: 'neutral' };
const ABANDONED: StatusBadge = { label: 'abandoned', tone: 'danger' };

/**
 * The badge on an epic's own header: its lifecycle, except in implementation.
 *
 * An `IMPLEMENTATION` epic keeps the derived badge, because that is the phase where the question is
 * how far along it is and the features are the only ones who can answer. In every other phase the
 * lifecycle *is* the answer — an abandoned epic's feature count says nothing worth reading.
 */
export function epicBadge(node: EpicNode): StatusBadge {
  switch (node.epic.status) {
    case 'REFINING':
      return REFINING;
    case 'SUPERSEDED':
      return SUPERSEDED;
    case 'ABANDONED':
      return ABANDONED;
    default:
      return epicStatus(node);
  }
}

/**
 * Whether an epic is finished, **read off its features rather than off a field**.
 *
 * Done is not a stored status: an implementation epic with at least one feature and every one of
 * them implemented is done, and nothing has to be pressed for it to become true. That is the same
 * derivation `epicStatus` makes, so the two can never disagree.
 */
export function isDone(node: EpicNode): boolean {
  return node.epic.status === 'IMPLEMENTATION' && epicStatus(node) === IMPLEMENTED;
}

/** The five sections of the overview, in the order a reader works down them. */
export interface EpicGroups {
  readonly refining: readonly EpicNode[];
  readonly implementation: readonly EpicNode[];
  readonly done: readonly EpicNode[];
  readonly superseded: readonly EpicNode[];
  readonly abandoned: readonly EpicNode[];
}

/**
 * The epics split by where they stand, keeping the service's order inside each group.
 *
 * Grouped here rather than fetched per status: the overview already reads every epic to build the
 * tree, and `done` cannot be asked for at all — it is a shape of the tree, not a value on the row.
 * One read that is grouped is also one moment; five reads would let two sections disagree about
 * the same epic.
 */
export function groupEpics(nodes: readonly EpicNode[]): EpicGroups {
  const refining: EpicNode[] = [];
  const implementation: EpicNode[] = [];
  const done: EpicNode[] = [];
  const superseded: EpicNode[] = [];
  const abandoned: EpicNode[] = [];

  for (const node of nodes) {
    switch (node.epic.status) {
      case 'REFINING':
        refining.push(node);
        break;
      case 'SUPERSEDED':
        superseded.push(node);
        break;
      case 'ABANDONED':
        abandoned.push(node);
        break;
      default:
        (isDone(node) ? done : implementation).push(node);
    }
  }

  return { refining, implementation, done, superseded, abandoned };
}

/**
 * A move that takes the epic to another point in its life.
 *
 * `confirmLabel` is null for a move worth making by accident. Freezing a draft is one of those — it is
 * the ordinary next step and the epic is still there afterwards — while superseding and abandoning
 * throw away a plan, so each asks in the button itself rather than in a browser dialog the page cannot
 * style or test.
 */
export interface EpicTransitionAction {
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
export interface EpicRefineAction {
  readonly kind: 'refine';
  readonly label: string;
  readonly confirmLabel: null;
}

/** One move a reader can make on an epic — a lifecycle transition, or opening its refining workspace. */
export type EpicAction = EpicTransitionAction | EpicRefineAction;

const REFINE: EpicRefineAction = { kind: 'refine', label: 'Refine', confirmLabel: null };
const START: EpicTransitionAction = {
  kind: 'transition',
  target: 'IMPLEMENTATION',
  label: 'Start implementation',
  confirmLabel: null,
};
const SUPERSEDE: EpicTransitionAction = {
  kind: 'transition',
  target: 'SUPERSEDED',
  label: 'Supersede',
  confirmLabel: 'Confirm supersede?',
};
const ABANDON: EpicTransitionAction = {
  kind: 'transition',
  target: 'ABANDONED',
  label: 'Abandon',
  confirmLabel: 'Confirm abandon?',
};

/**
 * What can be done to an epic in a given phase — the service's legal transitions, mirrored, plus the
 * one action that is not a transition.
 *
 * Mirrored rather than guessed at from the buttons: the server validates every move and answers a 409
 * for the rest, so this list is only about not offering a press that cannot work. The two terminal
 * states offer nothing, which is what makes their rows a summary rather than a card.
 *
 * <p><b>Refine comes first on a draft, ahead of freezing it.</b> The order is the order of the work:
 * refining is what a `REFINING` epic is *for*, and freezing the scope is what you do when the refining
 * is finished. Putting the ordinary next step at the front and the ending second would make the
 * destructive-adjacent press the closest one to hand.
 */
export function actionsFor(status: EpicStatus): readonly EpicAction[] {
  switch (status) {
    case 'REFINING':
      return [REFINE, START, ABANDON];
    case 'IMPLEMENTATION':
      return [SUPERSEDE, ABANDON];
    default:
      return [];
  }
}

/**
 * What identifies one action among the row — for `track`, and for saying which button is busy.
 *
 * A transition is identified by where it goes, which is unique within a phase; refine is identified by
 * being refine. The status values and the literal `'refine'` cannot collide, because `EpicStatus` is
 * closed and screaming-case.
 */
export function actionKey(action: EpicAction): string {
  return action.kind === 'refine' ? 'refine' : action.target;
}

/** Every epic's title by id, so a superseded row can name the draft that replaced it. */
export function epicTitles(nodes: readonly EpicNode[]): ReadonlyMap<string, string> {
  return new Map(nodes.map((node) => [node.epic.id, node.epic.title]));
}

/** The element id an epic's card carries, and therefore what an in-page link points at. */
export function epicAnchor(epicId: string): string {
  return `epic-${epicId}`;
}
