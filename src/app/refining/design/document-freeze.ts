/**
 * The **third sibling of one algorithm**, copied rather than imported.
 *
 * The other two are qits-integrations-angular's `document-freeze.ts` (this file's source) and the
 * qits webui's element-scoped `style-freeze.ts`. This SPA depends on neither package, and taking a
 * dependency on a whole integrations library for one function would cost more than the copy does.
 * **A change to the algorithm belongs in all three** — none of them is the canonical one.
 *
 * There is no spec beside this file, and that is deliberate: the algorithm reads
 * `getComputedStyle` against a real layout engine and measures UA defaults inside a live iframe,
 * neither of which jsdom answers meaningfully. The lib's browser spec is what proves it; what this
 * SPA adds on top — {@link ./freeze#freezeWebView} — is specced there against a fake freeze.
 */

/** The byte budget a freeze truncates at, defined here because this copy has no capture-config. */
export const DEFAULT_MAX_DOM_BYTES = 2_000_000;

/**
 * Freezes a DOM subtree into a self-contained HTML string: a deep clone where every element
 * carries the styles it effectively had (author rules, inheritance, inline styles) as inline
 * `style` attributes — so the snapshot renders alike without the page's stylesheets. To keep the
 * output readable, only properties whose computed value differs from the tag's bare UA default
 * are inlined; the defaults are measured on pristine elements inside a stylesheet-free hidden
 * iframe (measuring them in the page would pick up the very author rules being frozen, and diff
 * them away).
 *
 * The document-scoped sibling of the qits webui's element-scoped style-freeze.ts (the element
 * picker) — same algorithm, plus what a snapshot needs: the baseline iframe lives in the captured
 * document itself (there is no parent document here), scroll positions and form state are
 * reflected into attributes (a frozen DOM otherwise renders at scroll zero with empty inputs),
 * canvases become data-URL images, and a byte budget truncates depth-first (a capped snapshot
 * beats a failed POST).
 */
export interface FrozenDocument {
  html: string;
  /** True when the byte budget dropped subtrees. */
  truncated: boolean;
  /** UTF-8 size of {@link html}. */
  bytes: number;
}

/**
 * Freezes the whole page — but only its `<body>`. The `<head>` (stylesheets, scripts, meta) is
 * dropped: styles are already inlined onto every node, and scripts are inert dead weight in a
 * snapshot. The output is a renderable minimal document (`<!doctype html>` + the frozen body).
 */
export function freezeDocument(
  doc: Document,
  options?: { maxBytes?: number },
): FrozenDocument | undefined {
  if (!doc.body) {
    return undefined;
  }
  const frozen = freezeSubtree(doc, doc.body, options);
  return frozen && finalize('<!doctype html>' + frozen.outerHTML, frozen.truncated);
}

/**
 * Freezes a single element's subtree (the capture's picked component) — the same algorithm as
 * {@link freezeDocument}, emitting the bare frozen fragment (no document wrapper).
 */
export function freezeElement(
  element: Element,
  options?: { maxBytes?: number },
): FrozenDocument | undefined {
  const frozen = freezeSubtree(element.ownerDocument, element, options);
  return frozen && finalize(frozen.outerHTML, frozen.truncated);
}

function finalize(html: string, truncated: boolean): FrozenDocument {
  return { html, truncated, bytes: new TextEncoder().encode(html).length };
}

/** Clones and style-freezes `root` (within `doc`), returning the frozen clone + truncation flag. */
function freezeSubtree(
  doc: Document,
  root: Element,
  options?: { maxBytes?: number },
): { outerHTML: string; truncated: boolean } | undefined {
  const view = doc.defaultView;
  if (!view || !doc.body) {
    return undefined;
  }
  const baseline = doc.createElement('iframe');
  // Off-screen instead of display:none — inside a display:none iframe computed styles are empty.
  baseline.style.position = 'fixed';
  baseline.style.left = '-10000px';
  baseline.style.width = '10px';
  baseline.style.height = '10px';
  baseline.setAttribute('aria-hidden', 'true');
  // The baseline lives inside the document being captured — mark it so the walk drops it.
  baseline.setAttribute('data-qits-pick-overlay', '');
  doc.body.appendChild(baseline);
  try {
    const baselineDoc = baseline.contentDocument;
    if (!baselineDoc?.body) {
      return undefined;
    }
    const clone = root.cloneNode(true) as Element;
    const ctx: FreezeContext = {
      view,
      baselineDoc,
      defaults: new Map(),
      budget: options?.maxBytes ?? DEFAULT_MAX_DOM_BYTES,
      spent: 0,
      truncated: false,
    };
    freezeInto(root, clone, ctx);
    return { outerHTML: clone.outerHTML, truncated: ctx.truncated };
  } catch {
    return undefined; // best-effort: a failed freeze must never break the app
  } finally {
    baseline.remove();
  }
}

interface FreezeContext {
  view: Window;
  baselineDoc: Document;
  /** Per-tag snapshot of the UA-default computed style. */
  defaults: Map<string, Map<string, string>>;
  budget: number;
  /** Approximate serialized size accumulated so far (attributes + text as the walk visits them). */
  spent: number;
  truncated: boolean;
}

function freezeInto(orig: Element, clone: Element, ctx: FreezeContext): void {
  // Not-the-page's-content: the capture button and picker overlays (both marked), inert scripts.
  if (orig.hasAttribute('data-qits-pick-overlay') || orig.tagName === 'SCRIPT') {
    clone.remove();
    return;
  }
  if (ctx.spent >= ctx.budget) {
    ctx.truncated = true;
    clone.remove();
    return;
  }
  const computed = ctx.view.getComputedStyle(orig);
  const defaults = defaultsFor(orig.tagName, ctx);
  const decls: string[] = [];
  for (let i = 0; i < computed.length; i++) {
    const prop = computed.item(i);
    const value = computed.getPropertyValue(prop);
    if (defaults.get(prop) !== value) {
      decls.push(prop + ': ' + value);
    }
  }
  if (decls.length > 0) {
    clone.setAttribute('style', decls.join('; '));
  }
  reflectScroll(orig, clone);
  reflectFormState(orig, clone);
  if (orig.tagName === 'CANVAS') {
    replaceWithSnapshotImage(orig as HTMLCanvasElement, clone);
    return; // the clone was swapped for an <img>; a canvas has no children worth walking
  }
  ctx.spent += approximateCost(clone);
  const origChildren = Array.from(orig.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < origChildren.length; i++) {
    freezeInto(origChildren[i], cloneChildren[i], ctx);
  }
}

/** A frozen DOM renders at scroll zero — record where the user actually was. */
function reflectScroll(orig: Element, clone: Element): void {
  if (orig.scrollTop > 0) {
    clone.setAttribute('data-qits-scroll-top', String(orig.scrollTop));
  }
  if (orig.scrollLeft > 0) {
    clone.setAttribute('data-qits-scroll-left', String(orig.scrollLeft));
  }
}

/**
 * Live form state lives in properties, not attributes — reflect it so serialization keeps it.
 * Tag names, not instanceof: the captured document may come from another realm (an iframe),
 * whose elements are not instances of this realm's constructors.
 */
function reflectFormState(orig: Element, clone: Element): void {
  if (orig.tagName === 'INPUT') {
    const input = orig as HTMLInputElement;
    clone.setAttribute('value', input.value);
    if (input.checked) {
      clone.setAttribute('checked', '');
    } else {
      clone.removeAttribute('checked');
    }
  } else if (orig.tagName === 'TEXTAREA') {
    clone.textContent = (orig as HTMLTextAreaElement).value;
  } else if (orig.tagName === 'OPTION') {
    if ((orig as HTMLOptionElement).selected) {
      clone.setAttribute('selected', '');
    } else {
      clone.removeAttribute('selected');
    }
  }
}

/** A canvas serializes empty — swap the clone for a data-URL image (tainted canvases stay bare). */
function replaceWithSnapshotImage(orig: HTMLCanvasElement, clone: Element): void {
  try {
    const image = clone.ownerDocument.createElement('img');
    image.setAttribute('src', orig.toDataURL());
    const style = clone.getAttribute('style');
    if (style !== null) {
      image.setAttribute('style', style);
    }
    clone.replaceWith(image);
  } catch {
    // toDataURL throws on cross-origin-tainted canvases; the bare clone stands.
  }
}

/** Rough serialized size of one element (tag + attributes + its direct text), for the budget. */
function approximateCost(clone: Element): number {
  let cost = clone.tagName.length * 2 + 5;
  for (const attr of Array.from(clone.attributes)) {
    cost += attr.name.length + attr.value.length + 4;
  }
  for (const child of Array.from(clone.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      cost += (child.textContent ?? '').length;
    }
  }
  return cost;
}

function defaultsFor(tagName: string, ctx: FreezeContext): Map<string, string> {
  const cached = ctx.defaults.get(tagName);
  if (cached) {
    return cached;
  }
  const probe = ctx.baselineDoc.createElement(tagName);
  ctx.baselineDoc.body.appendChild(probe);
  const style = ctx.baselineDoc.defaultView!.getComputedStyle(probe);
  // Snapshot: the declaration object is live and empties once the probe is removed.
  const snapshot = new Map<string, string>();
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    snapshot.set(prop, style.getPropertyValue(prop));
  }
  probe.remove();
  ctx.defaults.set(tagName, snapshot);
  return snapshot;
}
