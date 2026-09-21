import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import type { WorkspaceReferenceDto } from '../api/dto';

/** The application in qits-workspaces' own vocabulary — what the platform navigation names it. */
export const WORKSPACES_APP = 'qits-workspaces';

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
 * The address of one workspace in qits-workspaces: `repositories/{repositoryId}/workspaces/{rowId}`.
 *
 * <p><b>Unscoped on purpose.</b> That application addresses a workspace by the repository row id
 * alone, so spelling this project's scope in front of it would compose a URL nothing serves.
 *
 * <p><b>`?tab=chat` is for a live workspace and only a live one.</b> A workspace still being worked
 * in renders tabs, and the conversation is what a reader following one of these links came for. A
 * resolved workspace is a different branch of that same route — a record of what happened, with no
 * tabs on it at all — so the parameter there names a tab nothing draws, which is a URL that says
 * something untrue about the page it opens. Every caller goes through this function rather than
 * composing the path, because two copies of that rule is one copy that quietly keeps the parameter.
 *
 * <p>Answers `undefined` — never a guessed URL — when the platform serves qits-workspaces nowhere,
 * or when the navigation tree has not arrived. The caller draws its sentence instead of an anchor.
 */
export function workspaceAddress(
  links: QitsAppLinks,
  repositoryId: string,
  workspaceRowId: number,
  live = true,
): string | undefined {
  const path = `repositories/${encodeURIComponent(repositoryId)}/workspaces/${workspaceRowId}`;
  return links.href(WORKSPACES_APP, live ? `${path}?tab=chat` : path);
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
 * address carries `?tab=chat`, what the anchor says out loud, and what the sentence says when there
 * is no anchor — and it has to come out identically on the entity rows and on the ticket's detail
 * page. A second copy is the one that would keep `?tab=chat` on a resolved workspace after somebody
 * fixed it here, and nothing would fail until a reader landed on a page with no such tab.
 *
 * <p><b>The label names what opening it gets you</b>, because the two links go to genuinely
 * different pages: a live one opens an agent's chat, a resolved one opens the record of a workspace
 * that is no longer there. "Open the branch" for both would make the second read as a promise the
 * page cannot keep.
 *
 * <p><b>The fallback sentence is not a fallback for a bug.</b> `QitsAppLinks.href` answers
 * `undefined` for an application this platform serves nowhere and for a navigation tree that has not
 * arrived yet, and both are ordinary. Saying which branch the work is — or was — on is still worth
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

  /** Each reference resolved once: its address, its label and the sentence standing in for both. */
  protected readonly drawn = computed<readonly DrawnWorkspace[]>(() =>
    this.workspaces().map((workspace) => {
      const live = isLiveWorkspace(workspace);
      return {
        key: workspace.workspaceRowId,
        href: workspaceAddress(
          this.appLinks,
          workspace.repositoryId,
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
