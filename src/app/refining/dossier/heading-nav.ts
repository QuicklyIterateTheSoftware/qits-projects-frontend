/**
 * The second level of the dossier's navigation, derived from the rendered page.
 *
 * **One walk, one source of truth.** After the panel renders a page, this walks the rendered
 * container once for `h1, h2, h3` in document order, assigns each an id, and returns them. The nav
 * is built from that array and from nothing else — parsing the markdown a second time to build a
 * table of contents is how a nav ends up disagreeing with the document it describes.
 *
 * **It spans the whole container, not one render call.** Ids are deduplicated across the page, which
 * can only be done once everything is in the DOM together.
 *
 * The cost of deriving rather than storing anchors: an id changes when its heading's text changes,
 * so an old fragment can name nothing. That is accepted, and the panel's rule is that an unknown
 * fragment lands at the top of the right page — never an error.
 */

/** One heading of the page on screen. */
export interface Heading {
  /** The id written onto the element, and what a fragment names. */
  readonly id: string;
  readonly text: string;
  /** 1, 2 or 3. Deeper headings are not listed — a nav is not an outline of everything. */
  readonly level: number;
}

/**
 * Walk `container` once, stamping ids onto the headings and answering them in document order.
 *
 * Called after every render, so it is also what keeps the nav current while somebody types: the
 * next flush re-renders, this re-walks, and the nav follows with no explicit invalidation.
 */
export function headingsOf(container: HTMLElement): readonly Heading[] {
  const taken = new Map<string, number>();
  const headings: Heading[] = [];
  for (const element of Array.from(container.querySelectorAll('h1, h2, h3'))) {
    const text = (element.textContent ?? '').trim();
    const id = unique(slugify(text), taken);
    element.id = id;
    headings.push({ id, text, level: Number(element.tagName.slice(1)) });
  }
  return headings;
}

/** The same shape a slug has everywhere else here: lowercase, runs of other characters to dashes. */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '');
  return slug || 'heading';
}

/** `-2`, `-3`, … for a repeated heading, so two identically-worded sections stay addressable. */
function unique(base: string, taken: Map<string, number>): string {
  const seen = taken.get(base) ?? 0;
  taken.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}
