import type { QitsBadgeTone } from '@qits/ui-components';
import type { EpicDto, FeatureDto, TaskDto } from '../api/dto';

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
