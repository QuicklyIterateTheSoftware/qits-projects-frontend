import {
  DOCUMENT,
  DestroyRef,
  Directive,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
} from '@angular/core';
import { QitsBearerFetch } from '@qits/angular';
import { DESIGN_FRAME_CLASS } from './markdown';

/**
 * Rendered markdown, bound as `[innerHTML]` is, plus the figures the platform will only hand over to
 * a bearer (epic qits-543, qits-1348).
 *
 * <p><b>The binding is `[innerHTML]` exactly</b> — a host binding, so Angular's sanitizer runs over
 * the HTML as it does on the element itself, with no bypass (see `markdown-view.ts` for why that
 * second pass is kept).
 *
 * <p><b>Then, after every render, it fills in what {@link renderMarkdown} left without a source.</b>
 * A dossier figure (`WorkDossierAssetController` `/{assetId}/content`) and a prompt attachment
 * (`RefinementPromptAttachmentController` `/{attachmentId}/content`) are role-guarded, and neither
 * an `<img>` nor an `<iframe>` can send `Authorization`. So the renderer writes their URL in `cite`,
 * which loads nothing, and this fetches each one with `@qits/angular`'s {@link QitsBearerFetch}:
 * - `img[cite]` gets an object URL as its `src`;
 * - a DESIGN figure's placeholder (`.design-frame[cite]`) gets an `<iframe sandbox>` —
 *   no `allow-scripts`, no `allow-same-origin` — whose `srcdoc` is the fetched HTML. The design tab
 *   renders its frozen page through `srcdoc` the same way. The frame is made here, through the DOM,
 *   because Angular's sanitizer strips an `iframe` from `[innerHTML]`.
 *
 * Each URL is fetched once per host, whatever re-renders; the object URLs are revoked when the host
 * goes. Without the bearer sign-in (a spec that provides none) the URL is used as the `src`.
 */
@Directive({
  selector: '[appBearerHtml]',
  host: { '[innerHTML]': 'appBearerHtml()' },
})
export class BearerHtml {
  /** The rendered HTML, as `[innerHTML]` would take it. */
  readonly appBearerHtml = input.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly bearer = inject(QitsBearerFetch, { optional: true });

  private readonly images = new Map<string, Promise<string>>();
  private readonly pages = new Map<string, Promise<string>>();
  private destroyed = false;

  constructor() {
    afterRenderEffect(() => {
      this.appBearerHtml();
      this.fill();
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const objectUrl of this.images.values()) {
        objectUrl.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
      }
      this.images.clear();
    });
  }

  private fill(): void {
    const root = this.host.nativeElement;
    for (const image of Array.from(
      root.querySelectorAll<HTMLImageElement>('img[cite]:not([src])'),
    )) {
      this.fillImage(image, image.getAttribute('cite') ?? '');
    }
    for (const figure of Array.from(
      root.querySelectorAll<HTMLElement>(`.${DESIGN_FRAME_CLASS}[cite]`),
    )) {
      if (!figure.querySelector('iframe'))
        this.fillFrame(figure, figure.getAttribute('cite') ?? '');
    }
  }

  private fillImage(image: HTMLImageElement, url: string): void {
    if (!url) return;
    if (!this.bearer) {
      image.src = url;
      return;
    }
    let objectUrl = this.images.get(url);
    if (!objectUrl) {
      objectUrl = this.bearer.fetchObjectUrl(url);
      this.images.set(url, objectUrl);
      // A failed read is forgotten, so the next render asks again.
      objectUrl.catch(() => this.images.delete(url));
    }
    objectUrl.then(
      (src) => {
        if (!this.destroyed) image.src = src;
      },
      () => undefined,
    );
  }

  private fillFrame(figure: HTMLElement, url: string): void {
    if (!url) return;
    const frame = this.document.createElement('iframe');
    // Empty: no scripts, no same origin. Set before any content can reach the frame.
    frame.setAttribute('sandbox', '');
    frame.setAttribute('loading', 'lazy');
    frame.title = figure.getAttribute('aria-label') ?? '';
    figure.append(frame);
    if (!this.bearer) {
      frame.src = url;
      return;
    }
    const bearer = this.bearer;
    let page = this.pages.get(url);
    if (!page) {
      page = bearer.fetch(url).then((response) => {
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        return response.text();
      });
      this.pages.set(url, page);
      page.catch(() => this.pages.delete(url));
    }
    page.then(
      (html) => {
        if (!this.destroyed) frame.srcdoc = html;
      },
      () => undefined,
    );
  }
}
