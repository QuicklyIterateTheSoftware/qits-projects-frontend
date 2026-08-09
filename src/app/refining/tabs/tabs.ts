/**
 * What a tab is, and which tabs there are, copied from qits-spa-workspaces' detail shell.
 *
 * Seven tabs plus one transient. The set is the *workspace's* surface rather than the epic's,
 * because that is what a refining workspace is: a real workspace on a real branch, with the same
 * container, the same files and the same agent behind it. Trimming it to "the ones refining needs"
 * would be guessing before anyone has refined anything, and re-adding a tab later costs a line here.
 *
 * The first six were declared before any of them had a panel, so that the shell was final and the
 * panels could land into a row that did not move under them — a tab appearing later changes every
 * existing `?tab=` link's neighbours. Sketch is the exception that proves the rule: it arrived with
 * its panel, after the shell had shipped, and it is inserted after Files rather than appended
 * because the legacy app's order was Chat, Files, Sketch, Services and a reader who knew that row
 * should find it where it was. Every tab has its panel.
 */

/** How loud a tab's label dot is. */
export type TabDot = 'accent' | 'success' | 'warning';

/** One tab in the row. */
export interface TabDef {
  /** Identity, and the value written to `?tab=` when {@link inUrl} is true. */
  readonly slug: string;
  /** What the button says. */
  readonly label: string;
  /**
   * Whether the tab is nameable in the URL.
   *
   * Only the transient process tab says false. It unmounts when its process ends, so a link to it
   * would land nowhere — and a link is the whole reason the others are in the URL.
   */
  readonly inUrl: boolean;
  /**
   * Whether this tab is pinned ahead of the row, outside the user's ordering.
   *
   * Exactly one tab uses it, and it is a slot rather than a setting: the transient tab appears at the
   * front, takes the selection, and goes away again.
   */
  readonly pinFront?: boolean;
  /** A status dot on the label, with the sentence explaining it. Null draws nothing. */
  readonly dot?: TabDot | null;
  /** What the dot means, on hover and to a screen reader. */
  readonly dotTitle?: string;
}

/** The transient technical-process tab's slug. Not a URL value — see {@link TabDef.inUrl}. */
export const STARTING_SLUG = 'starting';

/**
 * The seven durable tabs, in their default order.
 *
 * Chat leads because refining is a conversation: the reason to open this page at all is to talk the
 * plan through with an agent, and everything after it is what you reach for while doing that.
 *
 * The order is what a fresh page opens with; dragging rewrites it for the session and nothing else.
 * Per-browser persistence was dropped deliberately: it buys per-device ergonomics on a row of seven
 * and costs a stored-order migration every time a tab is added or renamed.
 */
export const DURABLE_TABS: readonly TabDef[] = [
  { slug: 'chat', label: 'Chat', inUrl: true },
  { slug: 'files', label: 'Files', inUrl: true },
  { slug: 'sketch', label: 'Sketch', inUrl: true },
  { slug: 'services', label: 'Services', inUrl: true },
  { slug: 'actions', label: 'Actions', inUrl: true },
  { slug: 'web-view', label: 'Web view', inUrl: true },
  { slug: 'agents', label: 'Agents', inUrl: true },
];

/** The default selection: the first durable tab. A bare URL means "no tab pinned", not "chat". */
export const DEFAULT_TAB = DURABLE_TABS[0].slug;

/** Whether a slug names a durable tab. An unknown slug in the URL is normalised away, not obeyed. */
export function isDurableTab(slug: string | null): boolean {
  return DURABLE_TABS.some((tab) => tab.slug === slug);
}
