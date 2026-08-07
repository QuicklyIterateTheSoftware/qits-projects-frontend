import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A node that loaded and holds nothing, said in a sentence.
 *
 * It exists so that "this platform has no projects" and "this group has no components" are drawn
 * the same way and are never drawn as blank space — an empty panel that renders nothing is
 * indistinguishable from one that failed silently.
 */
@Component({
  selector: 'app-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="empty">{{ message() }}</p>`,
  styles: `
    .empty {
      margin: 0.15rem 0;
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class Empty {
  readonly message = input.required<string>();
}
