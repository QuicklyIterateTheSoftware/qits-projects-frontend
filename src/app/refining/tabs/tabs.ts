/**
 * What a tab is, and which tabs there are, copied from qits-spa-workspaces' detail shell.
 *
 * The epic leads, followed by the tools that make sense while shaping a plan. Implementation-only
 * surfaces such as service processes and arbitrary actions stay on the workspace detail route where
 * work is split off; refinement keeps the document, inspection, agent, container and chat surfaces.
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
 * The eight durable tabs, in their default order.
 *
 * Epic leads because refining produces the epic document. Chat is deliberately dormant on a bare
 * URL: it mounts only when called for, then remains alive under the usual tab-host contract.
 *
 * The order is what a fresh page opens with; dragging rewrites it for the session and nothing else.
 * Per-browser persistence was dropped deliberately: it buys per-device ergonomics on a row of seven
 * and costs a stored-order migration every time a tab is added or renamed.
 */
export const DURABLE_TABS: readonly TabDef[] = [
  { slug: 'epic', label: 'Epic', inUrl: true, pinFront: true },
  { slug: 'files', label: 'Files', inUrl: true },
  { slug: 'sketch', label: 'Sketch', inUrl: true },
  { slug: 'web-view', label: 'Web view', inUrl: true },
  { slug: 'agents', label: 'Agents', inUrl: true },
  { slug: 'container', label: 'Container', inUrl: true },
  { slug: 'chat', label: 'Chat', inUrl: true },
];

/** The default selection: the epic document. A bare URL means "no tool open". */
export const DEFAULT_TAB = DURABLE_TABS[0].slug;

/** Whether a slug names a durable tab. An unknown slug in the URL is normalised away, not obeyed. */
export function isDurableTab(slug: string | null): boolean {
  return DURABLE_TABS.some((tab) => tab.slug === slug);
}
