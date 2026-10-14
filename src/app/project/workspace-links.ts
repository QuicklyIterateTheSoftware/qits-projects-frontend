import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import type { WorkspaceReferenceDto } from '../api/dto';

/**
 * Whether a workspace is still being worked in — **the one question the status is ever asked**.
 *
 * <p>Absent means `ACTIVE`, so this is written as "not resolved" rather than as `=== 'ACTIVE'`: the
 * field arrived after the reference did and an older service, a fixture, or a shape this build has
 * not caught up with all answer nothing at all. An equality test would read every one of those as
 * resolved, which is the strictly worse way to be wrong — a live workspace drawn as finished, and a
 * dispatching button offered on a ticket an agent is already on.
 */
export function isLiveWorkspace(workspace: WorkspaceReferenceDto): boolean {
  return !workspace.status || workspace.status === 'ACTIVE';
}

/**
 * The landing app's origin — the environment's own, where qits-landing-app serves the workspace
 * pages (epic qits-1230) — with no trailing slash, or `undefined` while the navigation has not said.
 */
function landingOrigin(links: QitsAppLinks): string | undefined {
  const origin = links.environmentOrigin();
  return origin ? origin.replace(/\/+$/, '') : undefined;
}

/**
 * A work item's agent in the landing app: `/projects/{slug}/work/detail/{qualifiedId}/agent`, and
 * one of its tabs below that when `tab` is given.
 *
 * <p>Answers `undefined` — never a guessed URL — while the navigation has not named the
 * environment's origin. The caller draws its sentence instead of an anchor.
 */
export function agentAddress(
  links: QitsAppLinks,
  projectSlug: string,
  qualifiedId: string,
  tab?: 'chat' | 'files' | 'terminal',
): string | undefined {
  const origin = landingOrigin(links);
  if (!origin) return undefined;
  const path = `/projects/${encodeURIComponent(projectSlug)}/work/detail/${encodeURIComponent(qualifiedId)}/agent`;
  return `${origin}${tab ? `${path}/${tab}` : path}`;
}

/**
 * One workspace slot in the landing app: `/projects/{slug}/workspaces/{slotRowId}` — the workspace
 * row id, which is what the landing app calls a slot. `undefined` on {@link agentAddress}'s terms.
 */
export function slotAddress(
  links: QitsAppLinks,
  projectSlug: string,
  slotRowId: number,
): string | undefined {
  const origin = landingOrigin(links);
  return origin
    ? `${origin}/projects/${encodeURIComponent(projectSlug)}/workspaces/${slotRowId}`
    : undefined;
}

/**
 * Where one of an item's workspaces opens, in the landing app.
 *
 * <p><b>A live workspace opens the item's agent, on its chat</b>: the conversation is what a reader
 * following one of these links came for, and the agent page is where the landing app keeps it.
 *
 * <p><b>A resolved workspace opens its slot</b>, without a tab: the item's agent page answers with
 * the item's newest agent, which a resolved workspace no longer is, so the reference is about that
 * one workspace and nothing else. So is a live one whose item has no qualified id to address it by.
 * Every caller goes through this function rather than composing the path, because two copies of
 * that rule is one copy that quietly drifts.
 */
export function workspaceAddress(
  links: QitsAppLinks,
  projectSlug: string,
  qualifiedId: string | null | undefined,
  slotRowId: number,
  live = true,
): string | undefined {
  return live && qualifiedId
    ? agentAddress(links, projectSlug, qualifiedId, 'chat')
    : slotAddress(links, projectSlug, slotRowId);
}

/** `INTEGRATED` → `integrated`. A word this build has not seen is lowercased and said as it is. */
function resolvedWord(status: string | undefined): string {
  return (status ?? 'resolved').toLowerCase();
}

/** One workspace, as the template draws it: an anchor where there is an address, a sentence where not. */
interface DrawnWorkspace {
  readonly key: number;
  readonly href: string | undefined;
  readonly label: string;
  readonly note: string;
}

/**
 * **The workspaces an entity names, as links** — every one of them, live and resolved.
 *
 * <p><b>It exists because the same list is now drawn on two screens.</b> A workspace reference used
 * to mean one thing — somebody is working on this, here is the way in — and one row drew it. Now it
 * means two: a live workspace to open the conversation in, and a resolved one kept so the ticket
 * still answers where its work happened. That distinction is three decisions deep — whether the
 * address is the item's agent chat or the workspace's slot, what the anchor says out loud, and what
 * the sentence says when there is no anchor — and it has to come out identically on the entity rows
 * and on the ticket's detail page. A second copy is the one that would keep sending a resolved
 * workspace to the agent chat after somebody fixed it here, and nothing would fail until a reader
 * landed on an agent that is not the one the link named.
 *
 * <p><b>The label names what opening it gets you</b>, because the two links go to genuinely
 * different pages in the landing app: a live one opens the item's agent on its chat, a resolved one
 * opens the slot of a workspace that is no longer there. "Open the branch" for both would make the second read as a promise the
 * page cannot keep.
 *
 * <p><b>The fallback sentence is not a fallback for a bug.</b> `QitsAppLinks.environmentOrigin`
 * answers `undefined` for a navigation tree that has not arrived yet, or one that names no origin,
 * and both are ordinary. Saying which branch the work is — or was — on is still worth
 * more than a blank, so the reference is stated in prose rather than dropped.
 *
 * <p>`display: contents`, so the host box is not a box: the anchors have to sit in whatever row or
 * flex line the caller put them in, and a wrapper element here would break the entity row's layout
 * for no reason. The `.note` styling is repeated from the caller for the same reason it has to be —
 * view encapsulation scopes the caller's rule to the caller's own template, so a span drawn here
 * would otherwise come out unstyled.
 *
 * <p>Presentational and stateless: it holds nothing, reads nothing and emits nothing. Whose
 * workspaces these are, and how they were read, belong to the screen that owns them.
 */
@Component({
  selector: 'app-workspace-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (workspace of drawn(); track workspace.key) {
      @if (workspace.href; as href) {
        <a class="workspace" [href]="href">{{ workspace.label }}</a>
      } @else {
        <span class="note">{{ workspace.note }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .note {
      color: #6b7280;
      font-size: 0.85rem;
    }
  `,
})
export class WorkspaceLinks {
  private readonly appLinks = inject(QitsAppLinks);

  /**
   * The references off the entity's own read — live and resolved, in the order the service gave
   * them. Several is an ordinary answer and draws several links rather than picking one.
   */
  readonly workspaces = input.required<readonly WorkspaceReferenceDto[]>();

  /** The project's slug, as the landing app's addresses spell it. */
  readonly projectSlug = input.required<string>();

  /** The item these workspaces were cut for — `qits-41` — whose agent a live one opens. */
  readonly qualifiedId = input<string | null>(null);

  /** Each reference resolved once: its address, its label and the sentence standing in for both. */
  protected readonly drawn = computed<readonly DrawnWorkspace[]>(() =>
    this.workspaces().map((workspace) => {
      const live = isLiveWorkspace(workspace);
      return {
        key: workspace.workspaceRowId,
        href: workspaceAddress(
          this.appLinks,
          this.projectSlug(),
          this.qualifiedId(),
          workspace.workspaceRowId,
          live,
        ),
        label: live
          ? `Open ${workspace.branch}`
          : `Open ${workspace.branch} (${resolvedWord(workspace.status)})`,
        note: live
          ? `a workspace is on ${workspace.branch}`
          : `${resolvedWord(workspace.status)}: a workspace was on ${workspace.branch}`,
      };
    }),
  );
}
