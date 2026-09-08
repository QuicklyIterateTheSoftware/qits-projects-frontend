import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks, QitsButton } from '@qits/ui-components';
import type { EpicAgentDispatchDto } from '../api/dto';
import { actionKey, type EpicAction } from './epics-model';

/** The application in qits-workspaces' own vocabulary — what the platform navigation names it. */
const WORKSPACES_APP = 'qits-workspaces';

/**
 * The moves available on one epic, and the one question each destructive move asks first.
 *
 * <p><b>The confirmation is the button, not a dialog.</b> Superseding and abandoning throw a plan
 * away, so neither should happen on a stray click — but `window.confirm` blocks the page, cannot be
 * styled to look like anything else here, and is awkward to assert. A button that says
 * "Confirm supersede?" until it is pressed again asks the same question in the place the reader is
 * already looking, and it un-asks itself the moment another action is pressed.
 *
 * <p><b>Refine is asked once and never confirmed</b>, because it takes nothing away: the flow behind
 * it is find-or-create, so pressing it twice lands in the same workspace. It is drawn by the same loop
 * as the transitions and told apart only by its `confirmLabel` being null, which is exactly the rule
 * the other non-destructive move already follows. Start implementation is the same shape for the same
 * reason — a second press adopts the workspace already on `epic/<slug>`.
 *
 * <p><b>The workspace link is {@link ./ticket-actions#TicketActions}' link, rule for rule</b>, because
 * the two presses land in the same place and a reader should not have to learn it twice. It is a
 * full-document anchor and never a `routerLink`, since the workspace lives in another Angular
 * application and a router command would compile and navigate nowhere. An address this platform
 * cannot spell draws **no anchor at all** — `QitsAppLinks.href` answers `undefined` for an
 * application served nowhere and for a navigation tree that has not arrived — while the sentence
 * beside it still says what happened, so a press never appears to have done nothing. And
 * `SKIPPED_RUNNING` is a **success**: an agent was already working on the branch, so the door
 * started no second one, and the workspace is the thing worth opening either way.
 *
 * <p>Presentational: it holds which button is waiting for a second press and nothing else. The
 * request, the busy state, the failure and the memory of what a press answered all belong to the
 * panel that owns the read — the same division the ticket pair makes.
 */
@Component({
  selector: 'app-epic-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <div class="actions">
      @for (action of actions(); track key(action)) {
        <qits-button
          variant="ghost"
          size="sm"
          [disabled]="disabled()"
          [busy]="running() === key(action)"
          (pressed)="press(action)"
        >
          {{ pending() === key(action) ? action.confirmLabel : action.label }}
        </qits-button>
      }

      @if (dispatch()) {
        @if (workspaceHref(); as href) {
          <a class="workspace" [href]="href">Open workspace</a>
        }
        <span class="note">{{ note() }}</span>
      }
    </div>

    @if (error(); as message) {
      <p class="failed" role="alert">Could not move this epic — {{ message }}.</p>
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
export class EpicActions {
  private readonly appLinks = inject(QitsAppLinks);

  /** What this epic's phase allows — empty for a terminal one, which draws no buttons at all. */
  readonly actions = input.required<readonly EpicAction[]>();

  /** Every button is dead while any epic's action is in flight; only one can be made at a time. */
  readonly disabled = input(false);

  /** Which of these buttons is the one waiting on the server, by {@link actionKey}, or null. */
  readonly running = input<string | null>(null);

  /** Why the last attempt on this epic failed — the server's own sentence, near the card it is about. */
  readonly error = input<string | null>(null);

  /**
   * A move the reader has now asked for twice, where twice was required.
   *
   * The whole action rather than its target: the owner has to tell a transition from a refine and
   * from a start, and a target alone cannot say which — neither of the other two has one.
   */
  readonly chosen = output<EpicAction>();

  /**
   * What the last successful "Start implementation" answered, or null for an epic nothing has been
   * dispatched onto *in this page's lifetime* — a reload forgets, because the service stores no
   * queryable record of a dispatch and pressing again is the way back.
   */
  readonly dispatch = input<EpicAgentDispatchDto | null>(null);

  protected readonly pending = signal<string | null>(null);

  protected readonly key = actionKey;

  protected press(action: EpicAction): void {
    const key = actionKey(action);
    if (action.confirmLabel && this.pending() !== key) {
      this.pending.set(key);
      return;
    }
    this.pending.set(null);
    this.chosen.emit(action);
  }

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
    return this.appLinks.href(
      WORKSPACES_APP,
      `repositories/${encodeURIComponent(dispatch.repositoryId)}/` +
        `workspaces/${dispatch.workspaceRowId}?tab=chat`,
    );
  });

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
