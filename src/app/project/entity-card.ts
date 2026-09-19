import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsCard } from '@qits/ui-components';
import { NONE, relativeSince } from '../ui/format';
import { MarkdownView } from '../ui/markdown-view';
import { EpicDraftCard } from './epic-draft-card';
import {
  entityBadge,
  epicBranch,
  featureBranch,
  featureStatus,
  taskBranch,
  taskStatus,
  ticketRoute,
  ticketTypeBadge,
  type EpicEntity,
  type Entity,
  type StatusBadge,
} from './entities-model';

/** What an epic branch is cut from, and therefore what its commits are counted against. */
const TRUNK = 'main';

/** One line of an epic's card: its words, how it stands, its branch, and what a compare would show. */
interface Row {
  readonly key: string;
  /** The left cell's classes, which is also where a task's indent lives. */
  readonly left: string;
  /** The right cell's classes. */
  readonly right: string;
  readonly text: string;
  /**
   * Whether {@link text} is markdown to render rather than a label to print.
   *
   * True on the summary line and nowhere else: that line is the epic's *description*, which is
   * written in markdown, while every row below it is a title — one line of words that would gain
   * nothing from a renderer and could only be surprised by it.
   */
  readonly markdown: boolean;
  /** Null on the summary line, whose badge sits in the card header instead. */
  readonly badge: StatusBadge | null;
  readonly branch: string;
  readonly compare: string;
}

function compareText(branch: string, parent: string): string {
  return `Commits on ${branch} compared to ${parent}. The comparison view is not built yet.`;
}

/**
 * An epic's lines, in the order the plan reads: the epic, then each feature with its tasks under it.
 *
 * Flat rather than nested because the two columns have to line up across every level — a branch
 * name that starts at a different x on each row is a column the eye cannot scan. Depth is the
 * left cell's indent, and nothing else.
 */
function rowsOf(entity: EpicEntity): readonly Row[] {
  const epicSlug = entity.slug;
  const rows: Row[] = [
    {
      key: entity.id,
      left: 'cell left summary',
      right: 'cell right summary',
      text: entity.description || NONE,
      markdown: Boolean(entity.description),
      badge: null,
      branch: epicBranch(epicSlug),
      compare: compareText(epicBranch(epicSlug), TRUNK),
    },
  ];

  for (const child of entity.features) {
    const featureSlug = child.feature.slug;
    const branch = featureBranch(epicSlug, featureSlug);
    rows.push({
      key: child.feature.id,
      left: 'cell left',
      right: 'cell right',
      text: child.feature.title,
      markdown: false,
      badge: featureStatus(child.feature),
      branch,
      compare: compareText(branch, epicBranch(epicSlug)),
    });

    for (const task of child.tasks) {
      const taskRef = taskBranch(epicSlug, featureSlug, task.slug);
      rows.push({
        key: task.id,
        left: 'cell left indent',
        right: 'cell right',
        text: task.title,
        markdown: false,
        badge: taskStatus(task),
        branch: taskRef,
        compare: compareText(taskRef, branch),
      });
    }
  }

  return rows;
}

/**
 * **One entity, drawn the way its archetype reads** — what `epic-card` and `ticket-card` were.
 *
 * <p><b>One component rather than two, because the difference between them was never the card.</b>
 * Both draw a heading, a badge or two, a description in markdown and the entity's own identifier; what
 * differs is the *body*, because an epic is a tree with branch names down it and a ticket is a row
 * with a kind, an owner and an age. Two components meant two copies of everything around that body,
 * and every fix to one of them — the markdown renderer, the identifier, the wrapping rules — had to
 * be found and made twice.
 *
 * <p><b>The archetype is read once, at the top, from the model's own discriminant.</b> There is no
 * string compare in this template beyond the `@switch`: everything below it is already narrowed, so
 * a ticket's fields cannot be reached on an epic and the compiler says so.
 *
 * <p><b>A refining epic is a third rendering and not a third archetype</b>, which is why it is
 * delegated to {@link EpicDraftCard} rather than being a case here. A draft has no branch names and
 * no per-line badges — nothing is frozen, so any `epic/` name composed from a slug that can still
 * change would be a ref that never existed — so it is a genuinely different card for the same kind of
 * thing. Keeping it a component of its own says that out loud; folding it in would make this
 * template's three arms look like three archetypes.
 *
 * <p><b>The identifier is on every card, at the top, in monospace.</b> `qualifiedId` is the point of
 * the unified entity: it is the short name a person writes into a commit subject or says out loud,
 * and an identifier nobody can see is an identifier nobody will use. It is **nullable** — the service
 * answers null when it could not resolve the owning project — and a null draws *nothing*, never
 * `null-`: a half-spelled identifier is one somebody may copy.
 *
 * <p><b>The compare is a sentence, not a dead link.</b> Every epic row names the branch its work
 * belongs on, and the obvious next question is what is on that branch — but there is no comparison
 * view in this build, so an anchor here would be a promise it cannot keep. The placeholder says the
 * view does not exist and its hover text says what it would show.
 *
 * <p><b>A ticket's title is a link, so it is in the card's body rather than its heading.</b>
 * `qits-card`'s `heading` is a string it prints itself — there is no way to project markup into it —
 * so a ticket card built the epics' way would draw the title twice or draw it dead. An epic's title
 * stays in the heading, because an epic has no detail page to link to.
 *
 * <p><b>A ticket's impetus is the card's sentence and its description is only there once it
 * exists.</b> A reported ticket has no description at all — refining has not run — so a card that
 * drew only the description would be a title and two badges for exactly the rows a reader is deciding
 * between. And the dash is a fact: a ticket nobody has taken draws {@link NONE} in the assignee's
 * place rather than a gap that reads as a card drawn wrong.
 */
@Component({
  selector: 'app-entity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EpicDraftCard, MarkdownView, QitsBadge, QitsCard, RouterLink],
  template: `
    @switch (entity().archetype) {
      @case ('EPIC') {
        @if (draft(); as drafted) {
          <app-epic-draft-card [entity]="drafted" />
        } @else if (epic(); as plan) {
          <qits-card [heading]="plan.title">
            <span qitsCardActions>
              @if (plan.qualifiedId; as qualified) {
                <span class="qualified">{{ qualified }}</span>
              }
              <qits-badge [label]="badge().label" [tone]="badge().tone" />
            </span>

            <div class="rows">
              @for (row of rows(); track row.key) {
                <span [class]="row.left">
                  @if (row.markdown) {
                    <app-markdown class="text" [text]="row.text" />
                  } @else {
                    <span class="text">{{ row.text }}</span>
                  }
                  @if (row.badge; as rowBadge) {
                    <qits-badge [label]="rowBadge.label" [tone]="rowBadge.tone" />
                  }
                </span>
                <span [class]="row.right">
                  <span class="branch">{{ row.branch }}</span>
                  <span class="compare" [title]="row.compare">comparison unavailable</span>
                </span>
              }
            </div>
          </qits-card>
        }
      }
      @case ('TICKET') {
        @if (ticket(); as row) {
          <qits-card>
            <div class="head">
              <a class="title" [routerLink]="route()">{{ row.title }}</a>
              <span class="badges">
                @if (row.qualifiedId; as qualified) {
                  <span class="qualified">{{ qualified }}</span>
                }
                <qits-badge [label]="type().label" [tone]="type().tone" />
                <qits-badge [label]="badge().label" [tone]="badge().tone" />
              </span>
            </div>

            <p class="meta">
              <span class="assignee">{{ assignee() }}</span>
              <span class="dot" aria-hidden="true">·</span>
              <span class="age">{{ age() }}</span>
            </p>

            @if (row.impetus; as impetus) {
              <p class="impetus">{{ impetus }}</p>
            }

            @if (row.description; as text) {
              <app-markdown class="description" [text]="text" />
            }
          </qits-card>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    /* The one identifier a person copies, so it is drawn as something copyable rather than as prose. */
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      color: #6b7280;
      user-select: all;
    }
    .rows {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, auto);
      align-items: baseline;
      column-gap: 1rem;
      font-size: 0.85rem;
    }
    .cell {
      padding: 0.35rem 0;
      border-top: 1px solid #e5e7eb;
      overflow-wrap: anywhere;
    }
    .summary {
      padding-top: 0;
      border-top: 0;
      color: #6b7280;
    }
    .left {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      color: #374151;
    }
    /* Depth is an indent and nothing else, so the branch column stays scannable. */
    .indent {
      padding-left: 1.25rem;
    }
    .right {
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .text {
      color: #111827;
    }
    /* The rendered description is a flex item, and a zero min-width is what lets a wide code block
       scroll inside it rather than push the branch column off the card. */
    .summary .text {
      min-width: 0;
      color: #6b7280;
    }
    .branch {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #374151;
    }
    .compare {
      color: #6b7280;
      font-style: italic;
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
  readonly entity = input.required<Entity>();

  /**
   * The project's slug, for a ticket's link out. Optional and falling back to nothing useful only
   * when the caller has none — a desk always has it, because the address it is drawn at carries it.
   */
  readonly projectSlug = input<string>('');

  /** The epic still being drafted, or null — the one rendering this card hands to another component. */
  protected readonly draft = computed<EpicEntity | null>(() => {
    const entity = this.entity();
    return entity.archetype === 'EPIC' && entity.status === 'REFINING' ? entity : null;
  });

  /** The epic drawn as frozen plan, or null. Narrowing for the template, which cannot do it itself. */
  protected readonly epic = computed<EpicEntity | null>(() => {
    const entity = this.entity();
    return entity.archetype === 'EPIC' && entity.status !== 'REFINING' ? entity : null;
  });

  protected readonly ticket = computed(() => {
    const entity = this.entity();
    return entity.archetype === 'TICKET' ? entity : null;
  });

  /** The entity's own badge — the lifecycle, or the epic's derivation. One rule, both archetypes. */
  protected readonly badge = computed(() => entityBadge(this.entity()));

  protected readonly rows = computed(() => {
    const epic = this.epic();
    return epic ? rowsOf(epic) : [];
  });

  protected readonly route = computed(() =>
    ticketRoute(this.projectSlug(), this.ticket()?.slug ?? ''),
  );

  protected readonly type = computed(() => ticketTypeBadge(this.ticket()?.type ?? 'BUG'));

  /** Free text, or the dash — see the class note on why the slot is never simply left out. */
  protected readonly assignee = computed(() => this.ticket()?.assignee || NONE);

  protected readonly age = computed(() => relativeSince(this.ticket()?.createdAt ?? ''));
}
