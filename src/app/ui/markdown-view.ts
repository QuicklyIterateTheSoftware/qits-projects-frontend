import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { renderMarkdown } from './markdown';

/**
 * A description, drawn as the markdown it is written in.
 *
 * <p><b>`[innerHTML]` with no `bypassSecurityTrustHtml`.</b> {@link renderMarkdown} escapes every
 * character of the source before wrapping any of it in a tag, so the string handed over here carries
 * no author-supplied markup at all — and binding it plainly means **Angular's sanitizer runs over it
 * as well**. That second pass is the point: bypassing it would trade a safety net for nothing, since
 * the tags this renderer emits are all ones the sanitizer already allows.
 *
 * <p><b>Styled with `::ng-deep`, which is not an oversight.</b> Nodes inserted through `innerHTML`
 * never receive the emulated-encapsulation attribute, so an ordinary `h2 { … }` rule in this
 * component would match nothing it is written for. `::ng-deep` under `:host` is the documented way
 * out, and it keeps the reach bounded to this component's own subtree — where a global stylesheet
 * rule for `h2` or `pre` would apply everywhere in the application.
 *
 * <p>The type is sized to sit <i>inside</i> a card rather than to lead a page: headings step down to
 * around the body size and are told apart by weight and colour, not by scale, because a card already
 * has a heading and a description that shouted over it would be worse than the raw text. Code blocks
 * scroll on their own axis instead of widening their container — a card whose width is set by
 * somebody's shell command is a broken card.
 */
@Component({
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="body" [innerHTML]="html()"></div>`,
  styles: `
    :host {
      display: block;
      /* A pasted url or a long identifier must not set the card's width. */
      overflow-wrap: anywhere;
    }
    :host ::ng-deep .body > :first-child {
      margin-top: 0;
    }
    :host ::ng-deep .body > :last-child {
      margin-bottom: 0;
    }
    :host ::ng-deep h1,
    :host ::ng-deep h2,
    :host ::ng-deep h3,
    :host ::ng-deep h4,
    :host ::ng-deep h5,
    :host ::ng-deep h6 {
      margin: 0.7rem 0 0.25rem;
      font-weight: 600;
      color: #111827;
      line-height: 1.3;
    }
    :host ::ng-deep h1 {
      font-size: 1.05em;
    }
    :host ::ng-deep h2 {
      font-size: 1em;
    }
    :host ::ng-deep h3,
    :host ::ng-deep h4,
    :host ::ng-deep h5,
    :host ::ng-deep h6 {
      font-size: 0.95em;
      color: #374151;
    }
    :host ::ng-deep p {
      margin: 0 0 0.5rem;
    }
    :host ::ng-deep ul,
    :host ::ng-deep ol {
      margin: 0 0 0.5rem;
      padding-left: 1.15rem;
    }
    :host ::ng-deep li {
      margin-top: 0.15rem;
    }
    :host ::ng-deep li > ul,
    :host ::ng-deep li > ol {
      margin: 0.15rem 0 0;
    }
    :host ::ng-deep strong {
      font-weight: 600;
      color: #111827;
    }
    :host ::ng-deep code {
      padding: 0.05rem 0.25rem;
      border-radius: 3px;
      background: #f3f4f6;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
      font-size: 0.9em;
    }
    :host ::ng-deep pre {
      margin: 0 0 0.5rem;
      padding: 0.45rem 0.6rem;
      max-width: 100%;
      border-radius: 4px;
      background: #f3f4f6;
      /* The block scrolls; the card does not. */
      overflow-x: auto;
    }
    :host ::ng-deep pre code {
      padding: 0;
      border-radius: 0;
      background: none;
      font-size: 0.85em;
    }
    :host ::ng-deep blockquote {
      margin: 0 0 0.5rem;
      padding-left: 0.6rem;
      border-left: 2px solid #d1d5db;
      color: #6b7280;
    }
    :host ::ng-deep hr {
      margin: 0.6rem 0;
      border: 0;
      border-top: 1px solid #e5e7eb;
    }
    :host ::ng-deep a {
      color: #1d4ed8;
    }
  `,
})
export class MarkdownView {
  /** The markdown source. Empty text draws nothing at all, rather than an empty paragraph. */
  readonly text = input.required<string>();

  protected readonly html = computed(() => renderMarkdown(this.text()));
}
