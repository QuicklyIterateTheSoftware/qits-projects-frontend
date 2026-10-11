import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { WorkOutcome } from '../api/dto';
import type { DropResolution } from '../api/work';
import { WORK_OUTCOMES, dropProblems, dropResolution, outcomeOption } from './entities-model';

/**
 * **What a Drop asks before it moves anything** (qits-248): why the item is dropped — one of the six
 * {@link WORK_OUTCOMES}, each with its one-line explanation — and, for the three that name another
 * item (`DUPLICATE`, `RESOLVED_ELSEWHERE`, `SUPERSEDED`), which one, by qualified id.
 *
 * <p>The reference box exists only while the picked outcome needs it, so it is never sent for the
 * other three; {@link dropResolution} is what leaves it out. The press stays disabled while
 * {@link dropProblems} names anything, and the sentence saying what is missing is shown once a
 * person has tried — not on arrival, where it would read as a scolding for a form nobody touched.
 *
 * <p>It moves nothing itself: it emits the drop's resolution, and the page sends the move through
 * its own lifecycle door and shows the service's own sentence when that refuses it (a 400 naming the
 * rule — a reference that names no item, one of another project, or the item itself).
 */
@Component({
  selector: 'app-drop-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <section class="drop-form" aria-label="Drop">
      <fieldset class="outcomes">
        <legend class="label">Why is it dropped?</legend>
        @for (option of outcomes; track option.value) {
          <label class="outcome" [attr.data-outcome]="option.value">
            <input
              type="radio"
              name="drop-outcome"
              [value]="option.value"
              [checked]="option.value === outcome()"
              (change)="pick(option.value)"
            />
            <span class="outcome-label">{{ option.label }}</span>
            <span class="outcome-explanation">{{ option.explanation }}</span>
          </label>
        }
      </fieldset>
      @if (needsReference()) {
        <label class="field">
          <span class="label" id="drop-reference-label">{{ referenceLabel() }}</span>
          <input
            type="text"
            class="text drop-reference"
            autocomplete="off"
            placeholder="qits-378"
            aria-labelledby="drop-reference-label"
            [value]="reference()"
            (input)="reference.set(value($event))"
          />
        </label>
      }
      @if (tried() && problems().length > 0) {
        <p class="drop-problem" role="alert">{{ problems()[0] }}</p>
      }
      <div class="actions">
        <qits-button
          class="send-drop"
          variant="primary"
          [disabled]="busy() || resolution() === null"
          [busy]="busy()"
          (pressed)="send()"
        >
          Drop
        </qits-button>
        <qits-button variant="ghost" [disabled]="busy()" (pressed)="cancelled.emit()">
          Cancel
        </qits-button>
      </div>
    </section>
  `,
  styles: `
    .drop-form {
      margin: 0 0 1rem;
      padding: 0.9rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
    }
    .outcomes {
      margin: 0 0 0.6rem;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .label {
      display: block;
      margin-bottom: 0.2rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #374151;
    }
    .outcome {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem;
      margin: 0 0 0.3rem;
      font-size: 0.9rem;
    }
    .outcome-label {
      font-weight: 600;
      color: #111827;
    }
    .outcome-explanation {
      color: #6b7280;
    }
    .field {
      display: block;
      margin: 0 0 0.6rem;
    }
    .text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: #111827;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .drop-problem {
      margin: 0 0 0.6rem;
      font-size: 0.85rem;
      color: #b91c1c;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class DropForm {
  /** Whether the move is in flight — the page's, since the page sends it. */
  readonly busy = input(false);

  /** The drop's resolution, ready for `POST /work/{q}/status` beside `target: DROPPED`. */
  readonly dropped = output<DropResolution>();
  readonly cancelled = output<void>();

  protected readonly outcomes = WORK_OUTCOMES;

  protected readonly outcome = signal<WorkOutcome | null>(null);
  protected readonly reference = signal('');
  /** Set once a person picked an outcome — from then on what is missing is said. */
  protected readonly tried = signal(false);

  private readonly draft = computed(() => ({
    outcome: this.outcome(),
    reference: this.reference(),
  }));
  protected readonly problems = computed(() => dropProblems(this.draft()));
  protected readonly resolution = computed(() => dropResolution(this.draft()));
  protected readonly needsReference = computed(
    () => outcomeOption(this.outcome())?.needsReference ?? false,
  );
  protected readonly referenceLabel = computed(
    () => `${outcomeOption(this.outcome())?.referenceLabel ?? 'Reference'} (qualified id)`,
  );

  protected pick(outcome: WorkOutcome): void {
    this.outcome.set(outcome);
    this.tried.set(true);
  }

  protected send(): void {
    const resolution = this.resolution();
    if (resolution && !this.busy()) {
      this.dropped.emit(resolution);
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
