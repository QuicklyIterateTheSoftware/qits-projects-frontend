import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { NONE, relativeSince } from '../ui/format';
import { MarkdownView } from '../ui/markdown-view';
import { blockedBadges, epicProgress, statusBadge, ticketTypeBadge } from './entities-model';
import { campaignLine, type WorkItem } from './campaign-model';
import { archetypeLabel, entityRoute } from './entity-nodes';

/**
 * **One card for every archetype on the desk** — the entity's name, where it stands, and the way to
 * its page.
 *
 * <p><b>The qualified number is the link, and so is the title.</b> `qits-1337` is what a person
 * copies into a commit subject or a sentence, and since qits-397 it is also the address: the card
 * links to `/<project>/work/qits-1337`, which is the entity's page with its actions, its tree or its
 * thread. The card itself carries no actions any more beyond what the desk puts under it — the three
 * dispatching and refining presses live on the page, where the dispatch state can be read first.
 *
 * <p>The body is archetype-shaped and small: a ticket's impetus (the reporter's words) and its
 * refined description, an epic's description and how much of its tree has landed, a campaign's
 * member count and whether it is running (its listing carries no age). Everything larger
 * — the feature/task tree, the thread, the dossier — is the page's.
 *
 * <p>A null `qualifiedId` draws no identifier (the service could not resolve the project row), and
 * the link then spells the bare number, which the page reads just as well.
 */
@Component({
  selector: 'app-entity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownView, QitsBadge, QitsCard, RouterLink],
  template: `
    <qits-card>
      <div class="head">
        <a class="title" [routerLink]="route()">{{ entity().title }}</a>
        <span class="badges">
          @if (entity().qualifiedId; as qualified) {
            <a class="qualified" [routerLink]="route()">{{ qualified }}</a>
          }
          <qits-badge class="archetype" [label]="archetype()" tone="neutral" />
          @if (ticket(); as row) {
            <qits-badge [label]="type().label" [tone]="type().tone" />
          }
          <qits-badge class="status" [label]="badge().label" [tone]="badge().tone" />
          <!-- Beside the status and never instead of it: blocked is a different fact. Every
               archetype on the desk carries the flag now, not only a ticket. One or two badges
               (qits-895): an explicit block and an agent-derived one are independent facts. -->
          @for (badge of blocked(); track badge.label) {
            <span [title]="badge.title"
              ><qits-badge class="blocked" [label]="badge.label" [tone]="badge.tone"
            /></span>
          }
        </span>
      </div>

      <p class="meta">
        @if (ticket(); as row) {
          <span class="assignee">{{ row.assignee || none }}</span>
          <span class="dot" aria-hidden="true">·</span>
        }
        @if (progress(); as landed) {
          <span class="progress">{{ landed }}</span>
          <span class="dot" aria-hidden="true">·</span>
        }
        @if (age(); as opened) {
          <span class="age">{{ opened }}</span>
        }
      </p>

      @if (ticket()?.impetus; as impetus) {
        <p class="impetus">{{ impetus }}</p>
      }

      @if (entity().description; as text) {
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
    /* The one identifier a person copies, so it is drawn as something copyable rather than as prose. */
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      color: #6b7280;
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
    .impetus {
      margin: 0.5rem 0 0;
      font-size: 0.9rem;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .description {
      margin-top: 0.5rem;
      font-size: 0.9rem;
      color: #374151;
    }
  `,
})
export class EntityCard {
  readonly entity = input.required<WorkItem>();

  /** The project's slug, which every address is spelled with. The desk always has it. */
  readonly projectSlug = input<string>('');

  protected readonly none = NONE;
  protected readonly blocked = computed(() => blockedBadges(this.entity()));

  protected readonly ticket = computed(() => {
    const entity = this.entity();
    return entity.archetype === 'TICKET' ? entity : null;
  });

  protected readonly badge = computed(() => statusBadge(this.entity().status));

  protected readonly archetype = computed(() => archetypeLabel(this.entity().archetype));

  protected readonly type = computed(() => ticketTypeBadge(this.ticket()?.type ?? 'BUG'));

  protected readonly route = computed(() => entityRoute(this.projectSlug(), this.entity()));

  /**
   * "3 of 5 implemented" for an epic with a tree, "3 members · running" for a campaign; nothing for a
   * ticket or an empty epic.
   */
  protected readonly progress = computed(() => {
    const entity = this.entity();
    if (entity.archetype === 'CAMPAIGN') {
      return campaignLine(entity);
    }
    if (entity.archetype !== 'EPIC') {
      return null;
    }
    const { implemented, total } = epicProgress(entity);
    return total > 0 ? `${implemented} of ${total} implemented` : null;
  });

  /** How long ago it was opened, or null where the read carries no timestamp (a campaign). */
  protected readonly age = computed(() => {
    const at = this.entity().createdAt;
    return at ? relativeSince(at) : null;
  });
}
