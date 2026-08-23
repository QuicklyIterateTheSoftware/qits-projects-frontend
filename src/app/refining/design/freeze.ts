import { freezeDocument, type FrozenDocument } from './document-freeze';

/**
 * Freezing the Web view tab's frame into something a design row can hold.
 *
 * The algorithm itself is {@link ./document-freeze#freezeDocument}, copied from
 * qits-integrations-angular. This file is the wrapper around it, and everything here is about the
 * three things that copy cannot know: where the frame is, what the page is called, and what the
 * picker left behind on it.
 */

/** One captured page, in the shape {@link ../../api/designs-api#NewDesign} wants. */
export interface WebViewFreeze {
  /** A whole renderable document: a head with a `<base>`, and the frozen body. */
  readonly html: string;
  /** The application route it came from, with the framed app's own prefix stripped. */
  readonly route: string;
  /** What to call it — the framed document's title, else `/<route>`; never blank. */
  readonly title: string;
  /** Whether the freeze hit its byte budget and dropped subtrees. */
  readonly truncated: boolean;
}

/**
 * Freeze what the Web view tab is framing.
 *
 * Answers null rather than throwing whenever there is nothing to freeze: no frame, a frame on
 * another origin (every read of which throws), or a freeze that declined or itself raised. A caller
 * says so on screen; a failed capture must never be an exception out of a button press.
 *
 * **The picker's marks are lifted first and put back after.** A picked element carries an inline
 * `outline` that this page wrote, and a freeze inlines every computed style — so the mark would be
 * baked into the stored design and stay on it forever. The restore is in a `finally`, because a
 * freeze that threw must still leave the framed app as it found it.
 *
 * **The head is written here, and the `<base>` in it is load-bearing.** The frozen body keeps the
 * app's own relative `src` and `url()` references; without a base they would resolve against
 * `srcdoc`'s opaque URL and every image would break. Pointed at the frame's own location, they
 * resolve back through the edge exactly as they did when the page was live.
 *
 * @param proxyBase the prefix the framed app is served under, stripped from the route the same way
 *   the toolbar's live-path readout strips it.
 * @param freeze the algorithm, injectable so a spec can hand over a fake — it needs a real layout
 *   engine, and jsdom has none.
 */
export function freezeWebView(
  frame: HTMLIFrameElement | null,
  proxyBase: string,
  freeze: typeof freezeDocument = freezeDocument,
): WebViewFreeze | null {
  const framed = frameDocument(frame);
  const location = frameLocation(frame);
  if (!framed || !location) {
    return null;
  }
  const marks = liftMarks(framed);
  let frozen: FrozenDocument | undefined;
  try {
    frozen = freeze(framed);
  } catch {
    // A freeze that threw is a freeze that failed. The caller says so in a sentence; a button press
    // must not raise.
    frozen = undefined;
  } finally {
    restoreMarks(marks);
  }
  if (!frozen) {
    return null;
  }
  const here = `${location.pathname}${location.search}${location.hash}`;
  const route = here.startsWith(proxyBase) ? here.slice(proxyBase.length) : here;
  // The server refuses a blank title, and a page at the root has neither a title nor a route.
  const title = framed.title.trim() || `/${route}`;
  const head =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<base href="${escapeHtml(location.href)}"><title>${escapeHtml(title)}</title></head>`;
  return {
    html: `${head}${stripDoctype(frozen.html)}</html>`,
    route,
    title,
    truncated: frozen.truncated,
  };
}

/** The framed document, or null when the frame is missing or on another origin. */
function frameDocument(frame: HTMLIFrameElement | null): Document | null {
  if (!frame) {
    return null;
  }
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/** Where the frame is, read live from the framed window. Null on another origin, as above. */
function frameLocation(frame: HTMLIFrameElement | null): Location | null {
  if (!frame) {
    return null;
  }
  try {
    return frame.contentWindow?.location ?? null;
  } catch {
    return null;
  }
}

/** One element's inline `outline`, remembered so the freeze does not see it. */
interface LiftedMark {
  readonly element: HTMLElement;
  readonly value: string;
  readonly priority: string;
}

function liftMarks(framed: Document): readonly LiftedMark[] {
  const lifted: LiftedMark[] = [];
  framed.querySelectorAll<HTMLElement>('[data-qits-picked]').forEach((element) => {
    // Not `instanceof HTMLElement`: the frame is another realm, so its elements fail that check
    // against this window's classes — the same cross-frame trap the picker documents.
    if (!element.style) {
      return;
    }
    lifted.push({
      element,
      value: element.style.getPropertyValue('outline'),
      priority: element.style.getPropertyPriority('outline'),
    });
    element.style.removeProperty('outline');
  });
  return lifted;
}

function restoreMarks(lifted: readonly LiftedMark[]): void {
  for (const mark of lifted) {
    if (mark.value) {
      mark.element.style.setProperty('outline', mark.value, mark.priority);
    }
  }
}

/** The lib emits its own `<!doctype html>` before the body; this file writes a whole head instead. */
function stripDoctype(html: string): string {
  return html.replace(/^<!doctype html>/i, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
