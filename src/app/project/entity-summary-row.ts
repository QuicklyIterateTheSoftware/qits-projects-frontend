import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import { NONE, relativeSince } from '../ui/format';
import {
  entityAnchor,
  entityBadge,
  ticketRoute,
  ticketTypeBadge,
  type Entity,
} from './entities-model';

/**
 * **One entity nobody has to do anything about, in one row** — what `epic-summary-row` and
 * `ticket-summary-row` were.
 *
 * <p><b>A row rather than a card, and the argument is the same for both archetypes.</b> A superseded
 * or abandoned epic is kept as the record of what was decided, and a closed ticket as the record that
 * the question was asked and answered. What a reader wants from either is enough to recognise it and
 * open it — not the whole tree, not the whole bug report. Drawing the archive as fully as the work
 * would bury the work under it, which is the failure this component exists at both levels to avoid.
 *
 * <p><b>The archetype decides what goes beside the title, and nothing else.</b> An epic says how it
 * ended, because "superseded" and "abandoned" are different endings and the row is the only place
 * that distinction survives — and a ticket now says the same thing for the same reason. It used to
 * say its *kind* alone, on the grounds that every row in the archive was `DONE` so the word would be
 * printed once per row and carry nothing. `DROPPED` ended that: the section holds two endings, and
 * which of them a row had — fixed, or decided against — is the first thing somebody looking a ticket
 * up in the archive wants to know. So the row says both, the kind and the status, and the kind stays
 * because bug-against-improvement still varies down the list.
 *
 * <p><b>Only a ticket's title is a link.</b> The reason a done ticket is on screen at all is that
 * somebody may want to read what was decided, and that is on its page. An epic has no detail page to
 * point at; its record is this row.
 *
 * <p>Superseding names its replacement and links to it, because "superseded" without a successor is
 * half a sentence. That link is an in-page anchor to the successor's own card, which is on this same
 * screen — the draft that replaced it is in the refining section above.
 *
 * <p>The identifier is here for the reason it is on the card: the archive is exactly where somebody
 * goes to find the number of the thing they are about to mention. Null draws nothing.
 */
@Component({
  selector: 'app-entity-summary-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge, RouterLink],
  template: `
    @if (entity().qualifiedId; as qualified) {
      <span class="qualified">{{ qualified }}</span>
    }

    @if (ticket(); as row) {
      <a class="title link" [routerLink]="route()">{{ row.title }}</a>
      <qits-badge [label]="type().label" [tone]="type().tone" />
      <qits-badge [label]="badge().label" [tone]="badge().tone" />
      <span class="assignee">{{ assignee() }}</span>
      <span class="age">{{ age() }}</span>
    } @else {
      <span class="title">{{ entity().title }}</span>
      <qits-badge [label]="badge().label" [tone]="badge().tone" />

      @if (successor(); as target) {
        <a class="successor" [href]="'#' + target.anchor">superseded by {{ target.title }}</a>
      }
    }
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
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      color: #6b7280;
      user-select: all;
    }
    .title {
      color: #374151;
      overflow-wrap: anywhere;
    }
    .link,
    .successor {
      color: #1d4ed8;
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
export class EntitySummaryRow {
  readonly entity = input.required<Entity>();

  /** The project's slug, for a ticket's link out — see {@link ./entity-card#EntityCard}. */
  readonly projectSlug = input<string>('');

  /**
   * The successor's title, or null when there is none to name.
   *
   * Passed in rather than looked up, because only the panel holding every entity can resolve an id to
   * a title. A `supersededByEpicId` this list does not contain draws no link at all — a dead anchor
   * would scroll nowhere and say the successor is on screen when it is not.
   */
  readonly successorTitle = input<string | null>(null);

  protected readonly ticket = computed(() => {
    const entity = this.entity();
    return entity.archetype === 'TICKET' ? entity : null;
  });

  protected readonly badge = computed(() => entityBadge(this.entity()));

  protected readonly type = computed(() => ticketTypeBadge(this.ticket()?.type ?? 'BUG'));

  protected readonly assignee = computed(() => this.ticket()?.assignee || NONE);

  protected readonly age = computed(() => relativeSince(this.ticket()?.createdAt ?? ''));

  protected readonly route = computed(() =>
    ticketRoute(this.projectSlug(), this.ticket()?.slug ?? ''),
  );

  protected readonly successor = computed(() => {
    const entity = this.entity();
    const id = entity.archetype === 'EPIC' ? entity.supersededByEpicId : null;
    const title = this.successorTitle();
    return id && title ? { anchor: entityAnchor('EPIC', id), title } : null;
  });
}
