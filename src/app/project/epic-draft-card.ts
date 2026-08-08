import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { epicBadge, type EpicNode } from './epics-model';

/** What a draft with nothing written in it says, rather than leaving the space blank. */
const NO_DESCRIPTION = 'This draft has no description yet.';
const NO_FEATURES = 'No features drafted yet.';

/**
 * An epic still being written: the same card shell, drawn as a draft.
 *
 * <p><b>No branch names and no status badges on the rows.</b> Nothing here has been implemented,
 * and nothing has a branch — the scope is not frozen, so a slug can still change and any branch
 * name composed from it would be a ref that never existed. Showing "open" against every line would
 * be equally empty: in this phase *everything* is open, so the badge would carry no information and
 * would only make the draft look like work in progress.
 *
 * <p>The description leads instead, because a draft is read to judge the idea, not to track it. The
 * outline under it is the shape so far, and a feature with no tasks is a feature nobody has broken
 * down yet rather than an error.
 *
 * <p>The dashed frame is the whole visual difference, and it is on this host rather than inside the
 * card, so `qits-card` stays untouched.
 */
@Component({
  selector: 'app-epic-draft-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, QitsCard],
  template: `
    <qits-card [heading]="node().epic.title">
      <span qitsCardActions>
        <qits-badge [label]="badge().label" [tone]="badge().tone" />
      </span>

      <p class="description" [class.absent]="!node().epic.description">{{ description() }}</p>

      @if (node().features.length === 0) {
        <p class="absent">{{ noFeatures }}</p>
      } @else {
        <ul class="outline">
          @for (child of node().features; track child.feature.id) {
            <li class="feature">
              <span class="title">{{ child.feature.title }}</span>
              @if (child.feature.description; as note) {
                <span class="note">{{ note }}</span>
              }

              @if (child.tasks.length > 0) {
                <ul class="tasks">
                  @for (task of child.tasks; track task.id) {
                    <li class="task">
                      <span class="title">{{ task.title }}</span>
                      @if (task.description; as note) {
                        <span class="note">{{ note }}</span>
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
      padding: 3px;
      border: 1px dashed #c4b5fd;
      border-radius: 13px;
      background: #faf5ff;
    }
    .description {
      margin: 0 0 0.6rem;
      font-size: 0.95rem;
      line-height: 1.45;
      color: #374151;
    }
    .absent {
      margin: 0;
      color: #6b7280;
      font-style: italic;
      font-size: 0.9rem;
    }
    .outline,
    .tasks {
      margin: 0;
      padding-left: 1.1rem;
    }
    .tasks {
      margin-top: 0.2rem;
    }
    .feature,
    .task {
      margin-top: 0.3rem;
      font-size: 0.85rem;
    }
    .feature {
      color: #111827;
    }
    .task {
      color: #374151;
    }
    .title {
      display: block;
    }
    .note {
      display: block;
      color: #6b7280;
    }
  `,
})
export class EpicDraftCard {
  readonly node = input.required<EpicNode>();

  protected readonly noFeatures = NO_FEATURES;

  /** Always the lifecycle here — a draft has nothing implemented to derive a badge from. */
  protected readonly badge = computed(() => epicBadge(this.node()));

  protected readonly description = computed(() => this.node().epic.description ?? NO_DESCRIPTION);
}
