import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { QitsAppLinks, QitsButton } from '@qits/ui-components';
import type { TicketAgentDispatchDto, WorkspaceReferenceDto } from '../api/dto';

/** The application in qits-workspaces' own vocabulary — what the platform navigation names it. */
const WORKSPACES_APP = 'qits-workspaces';

/**
 * The one move available on an open ticket: put a workspace and a coding agent on it, then show the
 * way in.
 *
 * <p><b>One action and no confirmation.</b> Assigning an agent takes nothing away — the door is
 * find-or-create, so a second press re-enters the same workspace — which is exactly the rule
 * {@link ./epic-actions#EpicActions} applies to Refine and the reason that button asks once too. A
 * confirm step here would be a question with only one honest answer.
 *
 * <p><b>A ticket somebody is already working on offers the way in, not the button.</b> `workspaces`
 * comes off the ticket itself, derived by the service per read, so it survives a reload and is the
 * same in every tab — which the memory of a press below is not. One or more of them and the button
 * is dead and each workspace is a link; none and the button is exactly what it always was. Several
 * is a real answer and draws several links rather than picking one.
 *
 * <p><b>The link is a full-document anchor, not a `routerLink`.</b> The workspace lives in another
 * Angular application, so a router command would compile and navigate nowhere. The address is
 * composed here rather than passed in because it is composed the same way for every ticket and from
 * nothing but the dispatch — the same division {@link ./component-card#ComponentCard} makes for the
 * clone url.
 *
 * <p><b>An address this platform cannot spell draws no anchor</b>, which is the standing rule (see
 * `repository-page.ts`): `QitsAppLinks.href` answers `undefined` both for an application served
 * nowhere and for a navigation tree that has not arrived, and a link to nowhere is worse than none.
 * The sentence beside it still says what happened, so a reader is never left with a press that
 * appeared to do nothing.
 *
 * <p><b>`SKIPPED_RUNNING` is a success.</b> An agent was already working in that workspace, so the
 * door started no second one — the link still shows, because the workspace is the thing worth
 * opening, and the note says which of the two happened.
 *
 * <p>Presentational: it holds no state at all. The request, the busy flag, the failure and the
 * memory of what a press answered all belong to the panel that owns the read.
 */
@Component({
  selector: 'app-ticket-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <div class="actions">
      <qits-button
        variant="ghost"
        size="sm"
        [disabled]="disabled() || taken()"
        [busy]="busy()"
        (pressed)="assign.emit()"
      >
        Assign agent
      </qits-button>

      @for (workspace of workspaces(); track workspace.workspaceRowId) {
        @if (hrefFor(workspace); as href) {
          <a class="workspace" [href]="href">Open {{ workspace.branch }}</a>
        } @else {
          <span class="note">a workspace is on {{ workspace.branch }}</span>
        }
      }

      @if (!taken() && dispatch()) {
        @if (workspaceHref(); as href) {
          <a class="workspace" [href]="href">Open workspace</a>
        }
        <span class="note">{{ note() }}</span>
      }
    </div>

    @if (error(); as message) {
      <p class="failed" role="alert">Could not assign an agent — {{ message }}.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.4rem;
    }
    .note {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .failed {
      margin: 0.35rem 0 0;
      color: #b91c1c;
      font-size: 0.85rem;
    }
  `,
})
export class TicketActions {
  private readonly appLinks = inject(QitsAppLinks);

  /** Every button is dead while any ticket's dispatch is in flight; only one is made at a time. */
  readonly disabled = input(false);

  /** Whether this ticket's own dispatch is the one waiting on the server. */
  readonly busy = input(false);

  /** Why the last press on this ticket failed — the server's own sentence, beside the card. */
  readonly error = input<string | null>(null);

  /**
   * What the last successful press answered, or null for a ticket nothing has been dispatched onto
   * *in this page's lifetime* — a reload forgets, which the panel's note explains.
   */
  readonly dispatch = input<TicketAgentDispatchDto | null>(null);

  /**
   * The live workspaces working on this ticket, off the ticket's own read. Unlike {@link dispatch}
   * this survives a reload and is the same in two tabs, because nothing here remembers it — the
   * service derives it from the workspaces themselves every time it is asked.
   */
  readonly workspaces = input<readonly WorkspaceReferenceDto[]>([]);

  /** Whether somebody is already on this one, which is what closes the button. */
  protected readonly taken = computed(() => this.workspaces().length > 0);

  /** The reader asked for an agent. The owner does the request; this component does not know how. */
  readonly assign = output<void>();

  /**
   * The workspace in qits-workspaces, opened on its chat: `repositories/{id}/workspaces/{rowId}`.
   *
   * <p><b>Unscoped on purpose.</b> That application addresses a workspace by the repository row id
   * alone, so spelling this project's scope in front of it would compose a URL nothing serves.
   */
  protected readonly workspaceHref = computed(() => {
    const dispatch = this.dispatch();
    if (!dispatch) {
      return undefined;
    }
    return this.address(dispatch.repositoryId, dispatch.workspaceRowId);
  });

  /** The same address for a workspace the ticket itself named — one composition, two sources. */
  protected hrefFor(workspace: WorkspaceReferenceDto): string | undefined {
    return this.address(workspace.repositoryId, workspace.workspaceRowId);
  }

  private address(repositoryId: string, workspaceRowId: number): string | undefined {
    return this.appLinks.href(
      WORKSPACES_APP,
      `repositories/${encodeURIComponent(repositoryId)}/workspaces/${workspaceRowId}?tab=chat`,
    );
  }

  /** What became of the press, in one clause — and the whole answer where there is no anchor. */
  protected readonly note = computed(() => {
    const dispatch = this.dispatch();
    if (!dispatch) {
      return '';
    }
    return dispatch.agentLaunch === 'SKIPPED_RUNNING'
      ? `an agent is already working on ${dispatch.branch}`
      : `an agent is starting on ${dispatch.branch}`;
  });
}
