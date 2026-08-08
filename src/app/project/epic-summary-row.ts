import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge } from '@qits/ui-components';
import { epicAnchor, epicBadge, type EpicNode } from './epics-model';

/**
 * An epic nobody is working on any more, in one row.
 *
 * <p><b>A row rather than a card, because the tree stopped being the point.</b> A superseded or
 * abandoned epic is kept as the record of what was decided, and what a reader wants from it is its
 * title and why it is here — not which of its features happened to be implemented before it was
 * dropped. The full tree is still in the data; nothing about drawing it here would be read.
 *
 * <p>Superseding names its replacement and links to it, because "superseded" without a successor is
 * half a sentence. The link is an in-page anchor to the successor's own card, which is on this same
 * screen — the draft that replaced it is in the refining section above.
 */
@Component({
  selector: 'app-epic-summary-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge],
  template: `
    <span class="title">{{ node().epic.title }}</span>
    <qits-badge [label]="badge().label" [tone]="badge().tone" />

    @if (successor(); as target) {
      <a class="successor" [href]="'#' + target.anchor">superseded by {{ target.title }}</a>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.4rem 0;
      border-top: 1px solid #e5e7eb;
      font-size: 0.85rem;
    }
    :host:first-of-type {
      border-top: 0;
    }
    .title {
      color: #374151;
    }
    .successor {
      color: #1d4ed8;
    }
  `,
})
export class EpicSummaryRow {
  readonly node = input.required<EpicNode>();

  /**
   * The successor's title, or null when there is none to name.
   *
   * Passed in rather than looked up, because only the panel holding every epic can resolve an id to
   * a title. A `supersededByEpicId` this list does not contain draws no link at all — a dead anchor
   * would scroll nowhere and say the successor is on screen when it is not.
   */
  readonly successorTitle = input<string | null>(null);

  protected readonly badge = computed(() => epicBadge(this.node()));

  protected readonly successor = computed(() => {
    const id = this.node().epic.supersededByEpicId;
    const title = this.successorTitle();
    return id && title ? { anchor: epicAnchor(id), title } : null;
  });
}
