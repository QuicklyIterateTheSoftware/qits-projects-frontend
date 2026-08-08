import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A tab that exists before its panel does.
 *
 * The shell shipped first and on purpose: the route, the workspace resolution, the status strip, the
 * live channel and the tab contract are what every panel mounts into, and they were worth proving —
 * against a real workspace on a real branch — before anything mounted. Each placeholder named the
 * surface that was coming rather than drawing an empty box, so the row was honest about being early
 * instead of looking broken.
 *
 * **All six tabs have their panel now, so nothing draws this today.** It is kept as the fallback a tab
 * added ahead of its panel lands on, because that order is the one this shell was built for.
 *
 * It is a real panel as far as the host is concerned — created on first selection, then kept — which
 * is what made the latch-and-hide contract observable from the day the shell landed.
 */
@Component({
  selector: 'app-panel-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="title">{{ title() }}</p>
    <p class="note">{{ note() }}</p>
  `,
  styles: `
    :host {
      display: block;
      padding: 1.5rem 0;
    }
    .title {
      margin: 0;
      color: #374151;
      font-weight: 600;
    }
    .note {
      margin: 0.25rem 0 0;
      color: #6b7280;
      font-size: 0.9rem;
    }
  `,
})
export class PanelPlaceholder {
  readonly title = input.required<string>();
  readonly note = input.required<string>();
}
