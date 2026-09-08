import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import type { TicketType } from '../api/dto';
import { TicketsApi, type NewTicket } from '../api/tickets-api';
import { ProjectParam } from '../nav/project-param';
import { IDLE, LOADING, ready, failed, type Loadable } from '../ui/loadable';
import { RefinementPanel } from './agent/refinement-panel';
import { TicketsOverview } from './tickets-overview';

/** The two kinds, in the order the form offers them: what is broken first, then what could be better. */
const TYPES: readonly { readonly value: TicketType; readonly label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
];

/**
 * The small work beside the plan: a project's tickets, and the form that opens one.
 *
 * <p>The shell is the shape every sub-page here has — a back link carrying the project's name, the
 * page's own word as an `h1`, and the panel that does the reading — and both halves of the header
 * come from the shared project list {@link ProjectParam} has already read to resolve the address's
 * slug, so the page adds no request of its own.
 *
 * <p><b>The agent above the list is the tickets' own front desk.</b> It is the same panel the epics
 * page carries, mounted at the `TICKETS` desk: same container, same three verbs, its own conversation
 * and its own system prompt — one for filing and triaging, where the epics page's is for drafting a
 * plan. It sits above the list for the reason the epics one does, that it is what changes the rows
 * below it, and it costs nothing until somebody opens it. The form beneath it is not made redundant
 * by it: filing a known ticket by hand is four boxes, where asking an agent to is a model process.
 *
 * <p><b>The form is closed until it is asked for, and that is not only about space.</b> This page is
 * read far more often than it is written to: a reader arrives to find a ticket, not to file one. An
 * always-open form would put four empty boxes above the list every time, and would make the list —
 * the thing the page is for — start below the fold.
 *
 * <p><b>Only the title is required, and the type has a default.</b> A ticket that has to be fully
 * described before it can be filed is a ticket that does not get filed; the rest can be added on its
 * own page, which is the same place it would be edited anyway. `BUG` leads because a defect is the
 * report somebody is most likely to be in a hurry with.
 *
 * <p><b>An empty box is left off the request entirely.</b> The service reads an absent
 * `description` or `assignee` as "nothing was said", so sending `""` would store an empty string and
 * make a ticket nobody has assigned look subtly different from one nobody has assigned. See
 * {@link ../api/tickets-api#NewTicket}.
 *
 * <p><b>A create re-reads rather than splicing the new row in.</b> The server stamps the slug, the
 * principal and both timestamps, so the answer is not the row this page would have guessed — and the
 * overview owns the read, the grouping and the ordering. Handing it back its own job keeps one
 * notion of what the project holds.
 */
@Component({
  selector: 'app-tickets-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, RefinementPanel, RouterLink, TicketsOverview],
  template: `
    <p class="back">
      <a [routerLink]="['/', projectSlug()]">← {{ heading() }}</a>
    </p>

    <div class="title-row">
      <h1>Tickets</h1>
      <qits-button variant="secondary" size="sm" (pressed)="toggle()">
        {{ open() ? 'Cancel' : 'New ticket' }}
      </qits-button>
    </div>

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
          <span class="label" id="ticket-description-label">Description</span>
          <textarea
            class="text area"
            rows="4"
            aria-labelledby="ticket-description-label"
            aria-describedby="ticket-description-hint"
            [value]="description()"
            (input)="onDescription($event)"
          ></textarea>
        </label>
        <p class="hint" id="ticket-description-hint">
          Optional, and written in Markdown — headings, lists and code spans all render.
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

    <app-refinement-panel [projectId]="projectId()" desk="TICKETS" />

    <app-tickets-overview [projectId]="projectId()" [projectSlug]="projectSlug()" />
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    .title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
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
export class TicketsPage {
  private readonly api = inject(TicketsApi);
  private readonly param = inject(ProjectParam);

  /**
   * The panel below the form, so a create can hand the re-read back to the component that owns it.
   *
   * A signal input pushed the other way would work too and would be worse: the overview already
   * re-reads on the project's `tickets` hint, so this is the same job it does for every other writer
   * — and asking it directly means there is exactly one code path that turns a write into a list.
   */
  private readonly overview = viewChild(TicketsOverview);

  /** The id every request takes, and the slug every link is spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  protected readonly types = TYPES;

  /** The project's display name, once the shared list has answered. The address until then. */
  protected readonly heading = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value.name : this.param.segment();
  });

  protected readonly open = signal(false);
  protected readonly title = signal('');
  protected readonly type = signal<TicketType>('BUG');
  protected readonly description = signal('');
  protected readonly assignee = signal('');
  protected readonly submit = signal<Loadable<unknown>>(IDLE);

  /** A title and a project to file it against. Everything else is optional by design. */
  protected readonly submittable = computed(
    () =>
      this.title().trim().length > 0 &&
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

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onAssignee(event: Event): void {
    this.assignee.set((event.target as HTMLInputElement).value);
  }

  /**
   * File it, then let the overview say what the project holds.
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
      type: this.type(),
      ...(description ? { description } : {}),
      ...(assignee ? { assignee } : {}),
    };

    this.submit.set(LOADING);
    try {
      this.submit.set(ready(await this.api.create(this.projectId(), ticket)));
      this.open.set(false);
      this.reset();
      await this.overview()?.load();
    } catch (error) {
      this.submit.set(failed(error));
    }
  }

  private reset(): void {
    this.title.set('');
    this.type.set('BUG');
    this.description.set('');
    this.assignee.set('');
    this.submit.set(IDLE);
  }
}
