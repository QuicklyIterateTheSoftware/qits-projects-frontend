import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import type { TicketDto } from '../api/dto';
import { NONE, relativeSince } from '../ui/format';
import { MarkdownView } from '../ui/markdown-view';
import { ticketRoute, ticketStatusBadge, ticketTypeBadge } from './tickets-model';

/**
 * One open ticket, as a card: what it is, who has it, when it arrived, and what it says.
 *
 * <p><b>The title is a link, so it is in the card's body rather than its heading.</b>
 * `qits-card`'s `heading` is a string it prints itself — there is no way to project markup into it —
 * so a card built the epics' way would draw the title twice or draw it dead. Putting the header row
 * inside the body is the smaller compromise: the badges still sit opposite the title, and the title
 * is the thing a reader clicks.
 *
 * <p><b>Two badges, and the type is the one doing the work.</b> Every card in the Open section
 * carries the same status word, so on that section the status badge is near-constant and the type is
 * what a reader actually scans by — which is why the two are toned to be told apart at a glance
 * rather than to be read in order.
 *
 * <p><b>The dash is a fact, not blank space.</b> A ticket nobody has taken draws {@link NONE} in the
 * assignee's place; leaving the slot out would make an unassigned ticket look like a card that had
 * been drawn wrong.
 *
 * <p>The description is markdown, like every description on this service — the same renderer the
 * epic cards use, for the same reason: a plan or a bug report written with headings and code spans
 * and printed verbatim is read out as punctuation.
 */
@Component({
  selector: 'app-ticket-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownView, QitsBadge, QitsCard, RouterLink],
  template: `
    <qits-card>
      <div class="head">
        <a class="title" [routerLink]="route()">{{ ticket().title }}</a>
        <span class="badges">
          <qits-badge [label]="type().label" [tone]="type().tone" />
          <qits-badge [label]="status().label" [tone]="status().tone" />
        </span>
      </div>

      <p class="meta">
        <span class="assignee">{{ assignee() }}</span>
        <span class="dot" aria-hidden="true">·</span>
        <span class="age">{{ age() }}</span>
      </p>

      @if (ticket().description; as text) {
        <app-markdown class="description" [text]="text" />
      }
    </qits-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #1d4ed8;
      overflow-wrap: anywhere;
    }
    .badges {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .meta {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
      flex-wrap: wrap;
      margin: 0.25rem 0 0;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .description {
      margin-top: 0.5rem;
      font-size: 0.9rem;
      color: #374151;
    }
  `,
})
export class TicketCard {
  readonly ticket = input.required<TicketDto>();

  /**
   * The project's slug, for the link out. Optional and falling back to nothing useful only when the
   * caller has none — the overview always has it, because the address it is drawn at carries it.
   */
  readonly projectSlug = input<string>('');

  protected readonly route = computed(() => ticketRoute(this.projectSlug(), this.ticket().slug));

  protected readonly type = computed(() => ticketTypeBadge(this.ticket().type));

  protected readonly status = computed(() => ticketStatusBadge(this.ticket().status));

  /** Free text, or the dash — see the class note on why the slot is never simply left out. */
  protected readonly assignee = computed(() => this.ticket().assignee || NONE);

  protected readonly age = computed(() => relativeSince(this.ticket().createdAt));
}
