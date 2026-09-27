import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { TicketType } from '../api/dto';
import { EntitiesApi, type NewTicket } from '../api/entities-api';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { IMPETUS_RULE } from './entities-model';

/** The two kinds, in the order the form offers them: what is broken first, then what could be better. */
const TYPES: readonly { readonly value: TicketType; readonly label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
];

/**
 * Opening a ticket by hand, on the one desk — the form the tickets page used to carry, moved as it
 * was (qits-397).
 *
 * <p><b>Closed until it is asked for</b>: the desk is read far more often than it is written to, and
 * an always-open form would push the work below the fold. <b>The title and the impetus are required,
 * the type has a default</b>, and the description is what refining writes, so its box is expected to
 * stay empty. <b>An empty box is left off the request</b> — the service reads an absent
 * `description` or `assignee` as "nothing was said".
 *
 * <p>A create emits {@link created} and the desk re-reads: the server stamps the slug, the number,
 * the principal and both timestamps, so the answer is not a row this form could have guessed.
 */
@Component({
  selector: 'app-new-ticket-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <qits-button class="toggle" variant="secondary" size="sm" (pressed)="toggle()">
      {{ open() ? 'Cancel' : 'New ticket' }}
    </qits-button>

    @if (open()) {
      <section class="form" aria-label="New ticket">
        <label class="field">
          <span class="label" id="ticket-title-label">Title</span>
          <input
            type="text"
            class="text"
            autocomplete="off"
            placeholder="The badge shows the wrong tone when a run is cancelled"
            aria-labelledby="ticket-title-label"
            [value]="title()"
            (input)="onTitle($event)"
          />
        </label>

        <label class="field">
          <span class="label" id="ticket-type-label">Type</span>
          <select class="select" aria-labelledby="ticket-type-label" (change)="onType($event)">
            @for (option of types; track option.value) {
              <option [value]="option.value" [selected]="option.value === type()">
                {{ option.label }}
              </option>
            }
          </select>
        </label>

        <label class="field">
          <span class="label" id="ticket-impetus-label">Impetus</span>
          <textarea
            class="text area impetus"
            rows="3"
            placeholder="The run badge shows success when a run is cancelled, on the builds page."
            aria-labelledby="ticket-impetus-label"
            aria-describedby="ticket-impetus-hint"
            [value]="impetus()"
            (input)="onImpetus($event)"
          ></textarea>
        </label>
        <p class="hint" id="ticket-impetus-hint">{{ impetusRule }}</p>

        <label class="field">
          <span class="label" id="ticket-description-label">Description</span>
          <textarea
            class="text area description"
            rows="4"
            aria-labelledby="ticket-description-label"
            aria-describedby="ticket-description-hint"
            [value]="description()"
            (input)="onDescription($event)"
          ></textarea>
        </label>
        <p class="hint" id="ticket-description-hint">
          Optional, and normally left empty: this is what refining writes — what to do about the
          impetus. Markdown, if you do write it.
        </p>

        <label class="field">
          <span class="label" id="ticket-assignee-label">Assignee</span>
          <input
            type="text"
            class="text"
            autocomplete="off"
            aria-labelledby="ticket-assignee-label"
            aria-describedby="ticket-assignee-hint"
            [value]="assignee()"
            (input)="onAssignee($event)"
          />
        </label>
        <p class="hint" id="ticket-assignee-hint">
          Optional. A name, not an account — this platform has no directory to point at.
        </p>

        <div class="actions">
          <qits-button
            variant="primary"
            [disabled]="!submittable()"
            [busy]="submit().kind === 'loading'"
            (pressed)="create()"
          >
            Open the ticket
          </qits-button>
        </div>

        @if (submit().kind === 'error') {
          <p class="failed" role="alert">Could not open it — {{ message() }}.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .toggle {
      display: inline-block;
      margin: 0 0 0.75rem;
    }
    .form {
      max-width: 40rem;
      margin: 0 0 1rem;
      padding: 0.9rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
    }
    .field {
      display: block;
      margin: 0 0 0.6rem;
    }
    .label {
      display: block;
      margin-bottom: 0.2rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #374151;
    }
    .text,
    .select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: #111827;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .area {
      resize: vertical;
      font-family: inherit;
    }
    .text:focus,
    .select:focus {
      outline: 2px solid #6b7280;
      outline-offset: 1px;
    }
    .hint {
      margin: -0.4rem 0 0.7rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .failed {
      margin: 0.6rem 0 0;
      color: #b91c1c;
    }
  `,
})
export class NewTicketForm {
  private readonly api = inject(EntitiesApi);

  /** The project the ticket is filed against. */
  readonly projectId = input.required<string>();

  /** A ticket was opened; the desk re-reads. */
  readonly created = output<void>();

  protected readonly types = TYPES;
  protected readonly impetusRule = IMPETUS_RULE;

  protected readonly open = signal(false);
  protected readonly title = signal('');
  protected readonly type = signal<TicketType>('BUG');
  protected readonly impetus = signal('');
  protected readonly description = signal('');
  protected readonly assignee = signal('');
  protected readonly submit = signal<Loadable<unknown>>(IDLE);

  /** A title, an impetus, and a project to file it against. Everything else is optional by design. */
  protected readonly submittable = computed(
    () =>
      this.title().trim().length > 0 &&
      this.impetus().trim().length > 0 &&
      this.projectId().length > 0 &&
      this.submit().kind !== 'loading',
  );

  protected readonly message = computed(() => {
    const state = this.submit();
    return state.kind === 'error' ? state.message : '';
  });

  /** Open the form, or abandon it. Cancelling clears it: a half-typed ticket is not a draft. */
  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (!next) {
      this.reset();
    }
  }

  protected onTitle(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  protected onType(event: Event): void {
    this.type.set((event.target as HTMLSelectElement).value as TicketType);
  }

  protected onImpetus(event: Event): void {
    this.impetus.set((event.target as HTMLTextAreaElement).value);
  }

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onAssignee(event: Event): void {
    this.assignee.set((event.target as HTMLInputElement).value);
  }

  /**
   * File it, then let the desk say what the project holds.
   *
   * The form closes only on success. A failed create leaves every box exactly as it was, because the
   * words are the reader's and the failure is usually transient — clearing them would make one bad
   * round trip cost somebody their bug report.
   */
  protected async create(): Promise<void> {
    if (!this.submittable()) {
      return;
    }
    const description = this.description().trim();
    const assignee = this.assignee().trim();
    const ticket: NewTicket = {
      title: this.title().trim(),
      impetus: this.impetus().trim(),
      type: this.type(),
      ...(description ? { description } : {}),
      ...(assignee ? { assignee } : {}),
    };

    this.submit.set(LOADING);
    try {
      this.submit.set(ready(await this.api.create(this.projectId(), ticket)));
      this.open.set(false);
      this.reset();
      this.created.emit();
    } catch (error) {
      this.submit.set(failed(error));
    }
  }

  private reset(): void {
    this.title.set('');
    this.type.set('BUG');
    this.impetus.set('');
    this.description.set('');
    this.assignee.set('');
    this.submit.set(IDLE);
  }
}
