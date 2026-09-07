import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import type { TicketDto } from '../api/dto';
import { NONE, relativeSince } from '../ui/format';
import { ticketRoute, ticketTypeBadge } from './tickets-model';

/**
 * A ticket nobody has to do anything about, in one row.
 *
 * <p><b>A row rather than a card, because the description stopped being the point.</b> A resolved
 * ticket is kept as the record that the question was asked and answered, and what a reader wants
 * from it is its title and its kind — enough to recognise it and open it. Drawing every resolved
 * bug report in full would bury the Open section under the archive, which is the exact failure
 * `epic-summary-row` exists to avoid one level up.
 *
 * <p><b>No status badge.</b> Every row in this section is resolved, so the word would be printed
 * once per row and carry nothing; the section's own heading says it once. The *type* stays, because
 * that still varies from row to row.
 *
 * <p>The title is still a link: the whole reason a resolved ticket is on screen is that somebody
 * may want to read what was decided, and that is on its page.
 */
@Component({
  selector: 'app-ticket-summary-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, RouterLink],
  template: `
    <a class="title" [routerLink]="route()">{{ ticket().title }}</a>
    <qits-badge [label]="type().label" [tone]="type().tone" />
    <span class="assignee">{{ assignee() }}</span>
    <span class="age">{{ age() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.4rem 0;
      border-top: 1px solid #e5e7eb;
      font-size: 0.85rem;
    }
    :host:first-of-type {
      border-top: 0;
    }
    .title {
      color: #1d4ed8;
      overflow-wrap: anywhere;
    }
    .assignee,
    .age {
      color: #6b7280;
      font-size: 0.8rem;
    }
    /* The age is pushed to the end, so the column scans down the row edges. */
    .age {
      margin-left: auto;
    }
  `,
})
export class TicketSummaryRow {
  readonly ticket = input.required<TicketDto>();

  /** The project's slug, for the link out — see {@link ./ticket-card#TicketCard}. */
  readonly projectSlug = input<string>('');

  protected readonly route = computed(() => ticketRoute(this.projectSlug(), this.ticket().slug));

  protected readonly type = computed(() => ticketTypeBadge(this.ticket().type));

  protected readonly assignee = computed(() => this.ticket().assignee || NONE);

  protected readonly age = computed(() => relativeSince(this.ticket().createdAt));
}
