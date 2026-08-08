import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { NONE } from '../ui/format';
import {
  epicBranch,
  epicStatus,
  featureBranch,
  featureStatus,
  taskBranch,
  taskStatus,
  type EpicNode,
  type StatusBadge,
} from './epics-model';

/** What an epic branch is cut from, and therefore what its commits are counted against. */
const TRUNK = 'main';

/** One line of the card: its words, how it stands, its branch, and what a compare would show. */
interface Row {
  readonly key: string;
  /** The left cell's classes, which is also where a task's indent lives. */
  readonly left: string;
  /** The right cell's classes. */
  readonly right: string;
  readonly text: string;
  /** Null on the summary line, whose badge sits in the card header instead. */
  readonly badge: StatusBadge | null;
  readonly branch: string;
  readonly compare: string;
}

function compareText(branch: string, parent: string): string {
  return `Commits on ${branch} compared to ${parent}. The comparison view is not built yet.`;
}

/**
 * The card's lines, in the order the plan reads: the epic, then each feature with its tasks under
 * it.
 *
 * Flat rather than nested because the two columns have to line up across every level — a branch
 * name that starts at a different x on each row is a column the eye cannot scan. Depth is the
 * left cell's indent, and nothing else.
 */
function rowsOf(node: EpicNode): readonly Row[] {
  const epicSlug = node.epic.slug;
  const rows: Row[] = [
    {
      key: node.epic.id,
      left: 'cell left summary',
      right: 'cell right summary',
      text: node.epic.description ?? NONE,
      badge: null,
      branch: epicBranch(epicSlug),
      compare: compareText(epicBranch(epicSlug), TRUNK),
    },
  ];

  for (const child of node.features) {
    const featureSlug = child.feature.slug;
    const branch = featureBranch(epicSlug, featureSlug);
    rows.push({
      key: child.feature.id,
      left: 'cell left',
      right: 'cell right',
      text: child.feature.title,
      badge: featureStatus(child.feature),
      branch,
      compare: compareText(branch, epicBranch(epicSlug)),
    });

    for (const task of child.tasks) {
      const taskRef = taskBranch(epicSlug, featureSlug, task.slug);
      rows.push({
        key: task.id,
        left: 'cell left indent',
        right: 'cell right',
        text: task.title,
        badge: taskStatus(task),
        branch: taskRef,
        compare: compareText(taskRef, branch),
      });
    }
  }

  return rows;
}

/**
 * One epic, its features, and their tasks — always open, and read-only.
 *
 * <p><b>Always expanded, with no collapse.</b> An epic is read to see where a change stands, and
 * that answer is the rows: a card that opened closed would hide the only thing it is for behind a
 * click, and remembering which of them a reader had opened is state this page has no reason to own.
 *
 * <p><b>The compare is a sentence, not a dead link.</b> Every row names the branch its work belongs
 * on, and the obvious next question is what is on that branch — but there is no comparison view in
 * this build, so an anchor here would be a promise it cannot keep, and a dead link is worse than no
 * link. The placeholder says the view does not exist and its hover text says what it would show.
 */
@Component({
  selector: 'app-epic-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsCard],
  template: `
    <qits-card [heading]="node().epic.title">
      <span qitsCardActions>
        <qits-badge [label]="status().label" [tone]="status().tone" />
      </span>

      <div class="rows">
        @for (row of rows(); track row.key) {
          <span [class]="row.left">
            <span class="text">{{ row.text }}</span>
            @if (row.badge; as badge) {
              <qits-badge [label]="badge.label" [tone]="badge.tone" />
            }
          </span>
          <span [class]="row.right">
            <span class="branch">{{ row.branch }}</span>
            <span class="compare" [title]="row.compare">comparison unavailable</span>
          </span>
        }
      </div>
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .rows {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, auto);
      align-items: baseline;
      column-gap: 1rem;
      font-size: 0.85rem;
    }
    .cell {
      padding: 0.35rem 0;
      border-top: 1px solid #e5e7eb;
      overflow-wrap: anywhere;
    }
    .summary {
      padding-top: 0;
      border-top: 0;
      color: #6b7280;
    }
    .left {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      color: #374151;
    }
    /* Depth is an indent and nothing else, so the branch column stays scannable. */
    .indent {
      padding-left: 1.25rem;
    }
    .right {
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .text {
      color: #111827;
    }
    .summary .text {
      color: #6b7280;
    }
    .branch {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #374151;
    }
    .compare {
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class EpicCard {
  readonly node = input.required<EpicNode>();

  /** The epic's own badge, read off its features — it has no completion field of its own. */
  protected readonly status = computed(() => epicStatus(this.node()));

  protected readonly rows = computed(() => rowsOf(this.node()));
}
