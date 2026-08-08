import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { EpicStatus } from '../api/dto';
import type { EpicAction } from './epics-model';

/**
 * The moves available on one epic, and the one question each destructive move asks first.
 *
 * <p><b>The confirmation is the button, not a dialog.</b> Superseding and abandoning throw a plan
 * away, so neither should happen on a stray click — but `window.confirm` blocks the page, cannot be
 * styled to look like anything else here, and is awkward to assert. A button that says
 * "Confirm supersede?" until it is pressed again asks the same question in the place the reader is
 * already looking, and it un-asks itself the moment another action is pressed.
 *
 * <p>Presentational: it holds which button is waiting for a second press and nothing else. The
 * request, the busy state and the failure all belong to the panel that owns the read.
 */
@Component({
  selector: 'app-epic-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <div class="actions">
      @for (action of actions(); track action.target) {
        <qits-button
          variant="ghost"
          size="sm"
          [disabled]="disabled()"
          [busy]="running() === action.target"
          (pressed)="press(action)"
        >
          {{ pending() === action.target ? action.confirmLabel : action.label }}
        </qits-button>
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
    .failed {
      margin: 0.35rem 0 0;
      color: #b91c1c;
      font-size: 0.85rem;
    }
  `,
})
export class EpicActions {
  /** What this epic's phase allows — empty for a terminal one, which draws no buttons at all. */
  readonly actions = input.required<readonly EpicAction[]>();

  /** Every button is dead while any epic's transition is in flight; only one can be made at a time. */
  readonly disabled = input(false);

  /** Which of these buttons is the one waiting on the server, or null. */
  readonly running = input<EpicStatus | null>(null);

  /** Why the last attempt on this epic failed — the server's own sentence, near the card it is about. */
  readonly error = input<string | null>(null);

  /** A move the reader has now asked for twice, where twice was required. */
  readonly chosen = output<EpicStatus>();

  protected readonly pending = signal<EpicStatus | null>(null);

  protected press(action: EpicAction): void {
    if (action.confirmLabel && this.pending() !== action.target) {
      this.pending.set(action.target);
      return;
    }
    this.pending.set(null);
    this.chosen.emit(action.target);
  }
}
