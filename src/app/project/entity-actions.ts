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
import type {
  EpicAgentDispatchDto,
  TicketAgentDispatchDto,
  WorkspaceReferenceDto,
} from '../api/dto';
import { actionKey, actionsFor, type Entity, type EntityAction } from './entities-model';
import { WorkspaceLinks, isLiveWorkspace, workspaceAddress } from './workspace-links';

/**
 * A dispatch answer, of either archetype's shape.
 *
 * The service keeps `EpicAgentDispatchDto` and `TicketAgentDispatchDto` as separate records — a
 * record called `Ticket…` inside an epic's answer would say the wrong thing about where it came from
 * — and this client mirrors that. The five fields are identical and this row reads all five the same
 * way, so the union is here rather than a third record being invented to flatten them.
 */
type DispatchAnswer = EpicAgentDispatchDto | TicketAgentDispatchDto;

/**
 * **The moves available on one entity**, and the one question each destructive move asks first —
 * what `epic-actions` and `ticket-actions` were.
 *
 * <p><b>One component, because the two were already the same component.</b> Line for line they drew
 * the same workspace links, the same dispatch note, the same "an agent is already working on…"
 * sentence and the same failure line; what differed was that the epics' row looped over a list of
 * actions while the ticket's hard-coded its single button. Deleting that difference is what
 * {@link actionsFor} made possible: a ticket's one press is now an action in a list of one, and this
 * row does not know or care which archetype it is drawing.
 *
 * <p><b>The confirmation is the button, not a dialog.</b> Superseding and abandoning throw a plan
 * away, so neither should happen on a stray click — but `window.confirm` blocks the page, cannot be
 * styled to look like anything else here, and is awkward to assert. A button that says
 * "Confirm supersede?" until it is pressed again asks the same question in the place the reader is
 * already looking, and it un-asks itself the moment another action is pressed.
 *
 * <p><b>Refine, Start implementation and Assign agent are asked once and never confirmed</b>, because
 * none of them takes anything away: each door is find-or-create, so a second press lands in the
 * workspace the first one made. They are drawn by the same loop as the transitions and told apart
 * only by their `confirmLabel` being null.
 *
 * <p><b>An entity somebody is already working on offers the way in, not the button.</b> `workspaces`
 * comes off the entity itself, derived by the service per read, so unlike the memory of a press below
 * it survives a reload and is the same in every tab. **The list is not a list of live workspaces** —
 * it holds every workspace ever cut for the entity, each saying whether it is still being worked in
 * — so it is drawn whole and counted filtered; see {@link EntityActions.taken}. **Only the two
 * dispatching presses close** — `start` and `assign` — never the transitions beside them: a
 * workspace being open is not a reason somebody cannot mark an epic implemented or abandon it.
 * Several workspaces is a real answer and draws several links rather than picking one.
 *
 * <p><b>The link is a full-document anchor, never a `routerLink`.</b> The workspace lives in another
 * Angular application, so a router command would compile and navigate nowhere. An address this
 * platform cannot spell draws **no anchor at all** — `QitsAppLinks.href` answers `undefined` for an
 * application served nowhere and for a navigation tree that has not arrived — while the sentence
 * beside it still says what happened, so a press never appears to have done nothing. The entity's
 * own workspaces are drawn by {@link WorkspaceLinks}, which the ticket's detail page shares; the
 * anchor below is this row's alone, because a dispatch answer is not a workspace reference. And
 * `SKIPPED_RUNNING` is a **success**: an agent was already working on the branch, so the door started
 * no second one, and the workspace is the thing worth opening either way.
 *
 * <p><b>The failure sentence names what the press was for, and the archetype is what decides
 * that.</b> An epic's row can move the epic; a ticket's row can only put an agent on it. One
 * generic "Could not do that" would be the one line on screen that told a reader nothing.
 *
 * <p>Presentational: it holds which button is waiting for a second press and nothing else. The
 * request, the busy state, the failure and the memory of what a press answered all belong to the
 * desk that owns the read.
 */
@Component({
  selector: 'app-entity-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, WorkspaceLinks],
  template: `
    <div class="actions">
      @for (action of moves(); track key(action)) {
        <qits-button
          variant="ghost"
          size="sm"
          [disabled]="disabled() || closed(action)"
          [busy]="running() === key(action)"
          (pressed)="press(action)"
        >
          {{ pending() === key(action) ? action.confirmLabel : action.label }}
        </qits-button>
      }

      <app-workspace-links [workspaces]="workspaces()" />

      @if (!taken() && dispatch()) {
        @if (workspaceHref(); as href) {
          <a class="workspace" [href]="href">Open workspace</a>
        }
        <span class="note">{{ note() }}</span>
      }
    </div>

    @if (error(); as message) {
      <p class="failed" role="alert">{{ failurePrefix() }} — {{ message }}.</p>
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
export class EntityActions {
  private readonly appLinks = inject(QitsAppLinks);

  /**
   * The entity this row is about — which is where the buttons come from, and the workspaces, and
   * which sentence a failure is spelled with.
   */
  readonly entity = input.required<Entity>();

  /** Every button is dead while any entity's action is in flight; only one can be made at a time. */
  readonly disabled = input(false);

  /** Which of these buttons is the one waiting on the server, by {@link actionKey}, or null. */
  readonly running = input<string | null>(null);

  /** Why the last attempt on this entity failed — the server's own sentence, near the card. */
  readonly error = input<string | null>(null);

  /**
   * A move the reader has now asked for twice, where twice was required.
   *
   * The whole action rather than its target: the owner has to tell a transition from a refine, a
   * start and an assign, and a target alone cannot say which — the other three have none.
   */
  readonly chosen = output<EntityAction>();

  /**
   * What the last successful dispatching press answered, or null for an entity nothing has been
   * dispatched onto *in this page's lifetime* — a reload forgets, because the service stores no
   * queryable record of a dispatch and pressing again is the way back.
   */
  readonly dispatch = input<DispatchAnswer | null>(null);

  /**
   * The moves to draw, where the caller wants fewer than the entity's phase allows.
   *
   * <p>Null — the default — means "whatever {@link actionsFor} says", which is what every desk
   * passes: the archetype's own rule, applied once, in the model. The one caller that overrides is
   * the refining room, which drops **Refine** because that press would go where the reader already
   * is. That is a fact about the *screen* and not about the epic, so it belongs to the screen rather
   * than to the rule — and it is an omission from the list rather than a flag on this component,
   * because a component that knew which rooms it was in would be the place every future exception
   * went.
   */
  readonly actions = input<readonly EntityAction[] | null>(null);

  /** What is actually drawn: the caller's list where there is one, the archetype's rule otherwise. */
  protected readonly moves = computed(() => this.actions() ?? actionsFor(this.entity()));

  /**
   * Every workspace the entity names, off its own read — the record that survives a reload, where
   * {@link dispatch} is only this page's memory of a press. Live and resolved both, drawn whole.
   */
  protected readonly workspaces = computed<readonly WorkspaceReferenceDto[]>(
    () => this.entity().workspaces,
  );

  /**
   * Whether somebody is **currently** working on this one — the live ones only, never the count.
   *
   * <p><b>The filter is the whole point and must not be simplified away.</b> `workspaces` now holds
   * every workspace ever cut for the entity, including the integrated and abandoned ones the ticket
   * keeps so it can still say where its work happened. Reading that list's length instead would mean
   * "Assign agent" and "Start implementation" were dead on every entity that has *ever* had an agent
   * on it — permanently, with no way back, and worst on exactly the tickets that have already been
   * round once and want a second pass. Nothing about a finished workspace is a reason not to start a
   * new one; a running one is.
   *
   * <p>A missing status counts as live, which is why this asks {@link isLiveWorkspace} rather than
   * comparing to `ACTIVE` — see there for why that is the safe direction to be wrong in.
   */
  protected readonly taken = computed(() => this.workspaces().some(isLiveWorkspace));

  /** Only the dispatching presses close when a workspace is already on it; the moves stay available. */
  protected closed(action: EntityAction): boolean {
    return (action.kind === 'start' || action.kind === 'assign') && this.taken();
  }

  /** What the failure line says this row was trying to do. See the class note. */
  protected readonly failurePrefix = computed(() =>
    this.entity().archetype === 'EPIC' ? 'Could not move this epic' : 'Could not assign an agent',
  );

  protected readonly pending = signal<string | null>(null);

  protected readonly key = actionKey;

  protected press(action: EntityAction): void {
    const key = actionKey(action);
    if (action.confirmLabel && this.pending() !== key) {
      this.pending.set(key);
      return;
    }
    this.pending.set(null);
    this.chosen.emit(action);
  }

  /**
   * Where the press just sent an agent, opened on its chat — composed by {@link workspaceAddress},
   * which is the one place on this client that spells a workspace's address.
   *
   * <p><b>Always the live form, and not a judgement call.</b> This is a dispatch the reader made
   * moments ago: the door either started an agent or found one already running on the branch, so the
   * workspace it answers is by construction being worked in, and the chat is what the press was for.
   * Unlike the references beside it there is no status to ask about — a dispatch answer is not a
   * workspace reference and never becomes one.
   */
  protected readonly workspaceHref = computed(() => {
    const dispatch = this.dispatch();
    if (!dispatch) {
      return undefined;
    }
    return workspaceAddress(this.appLinks, dispatch.repositoryId, dispatch.workspaceRowId);
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
