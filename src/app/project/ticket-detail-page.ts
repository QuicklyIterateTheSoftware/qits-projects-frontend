import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import type { TicketCommentDto, TicketDto, TicketType } from '../api/dto';
import { ProjectEvents } from '../api/project-events';
import { TicketsApi, type TicketEdit } from '../api/tickets-api';
import { ProjectParam } from '../nav/project-param';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, relativeSince } from '../ui/format';
import { IDLE, LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { MarkdownView } from '../ui/markdown-view';
import {
  isEdited,
  ticketBySlug,
  ticketStatusBadge,
  ticketTypeBadge,
  ticketsRoute,
} from './tickets-model';

/** The two kinds, in the order the edit form offers them — the same order the create form uses. */
const TYPES: readonly { readonly value: TicketType; readonly label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
];

/** One comment, with the two things the row derives rather than reads off the wire. */
interface DrawnComment {
  readonly comment: TicketCommentDto;
  readonly author: string;
  readonly age: string;
  readonly edited: boolean;
}

/**
 * One ticket, whole: what it says, what has been said about it, and what can be done to it.
 *
 * <p><b>The address names the slug, and the slug is resolved through the project's list.</b> There
 * is no by-slug read on the service — the API's vocabulary is ids and the URL grammar's is slugs,
 * which is exactly the division {@link ProjectParam} makes one segment up. So this page reads the
 * project's tickets and matches, which costs the same request the overview makes and is warm in the
 * browser's cache when a reader arrives by clicking rather than by pasting. A slug the list does not
 * hold is an ordinary not-found drawn in the page's own error state, not a thrown request.
 *
 * <p><b>The edit is four plain boxes, and deliberately not a workspace.</b> An epic gets a whole
 * refining container because a plan is written over days by an agent and a person together. A ticket
 * is a paragraph somebody types once and occasionally corrects, so the edit is the same four fields
 * the create form has, seeded from the row, saved in one PUT — and **emptying a box clears the
 * field** rather than leaving it, which is what the request's paired `clear` flags are for.
 *
 * <p><b>Resolve and reopen are one button that swaps.</b> A ticket has two states, so an action row
 * offering both would always have one press that does nothing. The button names the move that is
 * available, and the badge above it names the state it is in.
 *
 * <p><b>A transition's answer is used directly; every other write re-reads.</b> The transition
 * answers this ticket and can change nothing else, so the row it returns *is* the new subject.
 * Comments cannot be spliced the same way — an add, an edit and a delete all change a list whose
 * order and membership the server owns — so each of them re-reads the thread.
 *
 * <p><b>Deleting leaves.</b> The page's subject no longer exists, so staying on it would mean
 * drawing a not-found where the reader was just working; it goes back to the overview, which is
 * where the ticket would have been.
 *
 * <p><b>It listens on the project's `tickets` topic</b>, exactly as the overview does, and for the
 * same reason: another tab, another person, or an agent may be commenting on the ticket being read.
 * The refresh is quiet — a hint swaps the content underneath the reader rather than blanking the
 * page — and a quiet refresh that fails leaves what is on screen standing, because a moment-old
 * ticket is better than no ticket.
 */
@Component({
  selector: 'app-ticket-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, MarkdownView, QitsBadge, QitsButton, RouterLink],
  template: `
    <p class="back">
      <a [routerLink]="backRoute()">← Tickets</a>
    </p>

    @if (behind()) {
      <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
    }

    <app-async
      [state]="subject()"
      loadingLabel="Loading the ticket"
      errorLabel="Could not load the ticket"
      (retry)="load()"
    />

    @if (ticket(); as row) {
      <div class="title-row">
        <h1>{{ row.title }}</h1>
        <span class="badges">
          <qits-badge [label]="type().label" [tone]="type().tone" />
          <qits-badge [label]="status().label" [tone]="status().tone" />
        </span>
      </div>

      <dl class="facts">
        <dt>Assignee</dt>
        <dd class="assignee">{{ row.assignee || none }}</dd>
        <dt>Reported by</dt>
        <dd class="reporter">{{ row.createdBy || none }}</dd>
        <dt>Opened</dt>
        <dd class="opened">{{ opened() }}</dd>
        <dt>Updated</dt>
        <dd class="updated">{{ updated() }}</dd>
      </dl>

      @if (editing()) {
        <section class="form" aria-label="Edit the ticket">
          <label class="field">
            <span class="label" id="edit-title-label">Title</span>
            <input
              type="text"
              class="text edit-title"
              autocomplete="off"
              aria-labelledby="edit-title-label"
              [value]="draftTitle()"
              (input)="onDraftTitle($event)"
            />
          </label>

          <label class="field">
            <span class="label" id="edit-type-label">Type</span>
            <select class="select" aria-labelledby="edit-type-label" (change)="onDraftType($event)">
              @for (option of types; track option.value) {
                <option [value]="option.value" [selected]="option.value === draftType()">
                  {{ option.label }}
                </option>
              }
            </select>
          </label>

          <label class="field">
            <span class="label" id="edit-description-label">Description</span>
            <textarea
              class="text area edit-description"
              rows="6"
              aria-labelledby="edit-description-label"
              [value]="draftDescription()"
              (input)="onDraftDescription($event)"
            ></textarea>
          </label>

          <label class="field">
            <span class="label" id="edit-assignee-label">Assignee</span>
            <input
              type="text"
              class="text edit-assignee"
              autocomplete="off"
              aria-labelledby="edit-assignee-label"
              [value]="draftAssignee()"
              (input)="onDraftAssignee($event)"
            />
          </label>
          <p class="hint">An empty box clears the field rather than leaving it as it was.</p>

          <div class="actions">
            <qits-button
              variant="primary"
              [disabled]="!savable()"
              [busy]="action() === 'save'"
              (pressed)="save()"
            >
              Save
            </qits-button>
            <qits-button variant="ghost" [disabled]="action() !== null" (pressed)="stopEditing()">
              Cancel
            </qits-button>
          </div>
        </section>
      } @else {
        @if (row.description; as text) {
          <app-markdown class="description" [text]="text" />
        } @else {
          <p class="absent">This ticket has no description.</p>
        }

        <div class="actions">
          <qits-button
            variant="secondary"
            [disabled]="action() !== null"
            (pressed)="startEditing()"
          >
            Edit
          </qits-button>
          <qits-button
            variant="secondary"
            [disabled]="action() !== null"
            [busy]="action() === 'transition'"
            (pressed)="transition()"
          >
            {{ transitionLabel() }}
          </qits-button>
          @if (confirmingDelete()) {
            <qits-button
              variant="secondary"
              [disabled]="action() !== null"
              [busy]="action() === 'delete'"
              (pressed)="remove()"
            >
              Confirm delete?
            </qits-button>
          } @else {
            <qits-button variant="ghost" [disabled]="action() !== null" (pressed)="askDelete()">
              Delete
            </qits-button>
          }
        </div>
      }

      @if (actionFailure(); as message) {
        <p class="failed" role="alert">{{ message }}</p>
      }

      <section class="comments">
        <h2>Comments</h2>

        <app-async
          [state]="comments()"
          loadingLabel="Loading the comments"
          errorLabel="Could not load the comments"
          (retry)="reloadComments()"
        />

        @if (comments().kind === 'ready') {
          @if (thread().length === 0) {
            <app-empty message="Nothing has been said about this ticket yet." />
          } @else {
            <ol class="thread">
              @for (entry of thread(); track entry.comment.id) {
                <li class="comment">
                  <p class="byline">
                    <span class="author">{{ entry.author }}</span>
                    <span class="age">{{ entry.age }}</span>
                    @if (entry.edited) {
                      <span class="edited">edited</span>
                    }
                  </p>

                  @if (editingComment() === entry.comment.id) {
                    <textarea
                      class="text area comment-edit"
                      rows="4"
                      aria-label="Edit the comment"
                      [value]="commentDraft()"
                      (input)="onCommentDraft($event)"
                    ></textarea>
                    <div class="actions">
                      <qits-button
                        variant="primary"
                        size="sm"
                        [disabled]="!commentDraft().trim() || commentAction() !== null"
                        [busy]="commentAction() === 'save'"
                        (pressed)="saveComment(entry.comment.id)"
                      >
                        Save
                      </qits-button>
                      <qits-button
                        variant="ghost"
                        size="sm"
                        [disabled]="commentAction() !== null"
                        (pressed)="stopEditingComment()"
                      >
                        Cancel
                      </qits-button>
                    </div>
                  } @else {
                    <app-markdown class="body" [text]="entry.comment.body" />
                    <div class="actions">
                      <qits-button
                        variant="ghost"
                        size="sm"
                        [disabled]="commentAction() !== null"
                        (pressed)="startEditingComment(entry.comment)"
                      >
                        Edit
                      </qits-button>
                      <qits-button
                        variant="ghost"
                        size="sm"
                        [disabled]="commentAction() !== null"
                        [busy]="commentAction() === 'delete:' + entry.comment.id"
                        (pressed)="removeComment(entry.comment.id)"
                      >
                        Delete
                      </qits-button>
                    </div>
                  }
                </li>
              }
            </ol>
          }

          <div class="composer">
            <textarea
              class="text area compose"
              rows="3"
              aria-label="Add a comment"
              placeholder="Say something about this ticket."
              [value]="composed()"
              (input)="onComposed($event)"
            ></textarea>
            <div class="actions">
              <qits-button
                variant="primary"
                [disabled]="!composed().trim() || commentAction() !== null"
                [busy]="commentAction() === 'add'"
                (pressed)="addComment()"
              >
                Comment
              </qits-button>
            </div>
          </div>
        }

        @if (commentFailure(); as message) {
          <p class="failed" role="alert">{{ message }}</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 48rem;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    .behind {
      margin: 0 0 0.5rem;
      color: #6b7280;
      font-size: 0.8rem;
      font-style: italic;
    }
    .title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .badges {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      align-items: baseline;
      column-gap: 0.75rem;
      row-gap: 0.15rem;
      margin: 0 0 1rem;
      font-size: 0.85rem;
    }
    dt {
      color: #6b7280;
    }
    dd {
      margin: 0;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .description {
      margin: 0 0 1rem;
      color: #374151;
    }
    .absent {
      margin: 0 0 1rem;
      color: #6b7280;
      font-style: italic;
    }
    .form {
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
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
    .failed {
      margin: 0.6rem 0 0;
      color: #b91c1c;
    }
    .comments {
      margin-top: 1.75rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
    }
    .thread {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .comment {
      padding: 0.6rem 0;
      border-top: 1px solid #f3f4f6;
    }
    .comment:first-of-type {
      border-top: 0;
    }
    .byline {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin: 0 0 0.3rem;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .author {
      font-weight: 600;
      color: #374151;
    }
    .edited {
      font-style: italic;
    }
    .body {
      font-size: 0.9rem;
      color: #374151;
    }
    .composer {
      margin-top: 1rem;
    }
  `,
})
export class TicketDetailPage {
  private readonly api = inject(TicketsApi);
  private readonly events = inject(ProjectEvents);
  private readonly param = inject(ProjectParam);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  /** The id every request takes, and the slug every link is spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  /** The address's own segment: the ticket's slug, never its id. */
  protected readonly ticketSlug = computed(() => this.params().get('ticket') ?? '');

  protected readonly none = NONE;
  protected readonly types = TYPES;

  protected readonly subject = signal<Loadable<TicketDto>>(LOADING);
  protected readonly comments = signal<Loadable<readonly TicketCommentDto[]>>(IDLE);

  /** Which ticket-level write is in flight — `save`, `transition` or `delete`. */
  protected readonly action = signal<string | null>(null);
  protected readonly actionFailure = signal<string | null>(null);

  /** Which comment-level write is in flight — `add`, `save`, or `delete:<id>`. */
  protected readonly commentAction = signal<string | null>(null);
  protected readonly commentFailure = signal<string | null>(null);

  protected readonly editing = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftType = signal<TicketType>('BUG');
  protected readonly draftDescription = signal('');
  protected readonly draftAssignee = signal('');

  /** Deleting throws a record away, so it asks in the button rather than in a browser dialog. */
  protected readonly confirmingDelete = signal(false);

  protected readonly editingComment = signal<string | null>(null);
  protected readonly commentDraft = signal('');
  protected readonly composed = signal('');

  protected readonly ticket = computed<TicketDto | null>(() => {
    const state = this.subject();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly backRoute = computed(() => ticketsRoute(this.projectSlug()));

  protected readonly type = computed(() => ticketTypeBadge(this.ticket()?.type ?? 'BUG'));

  protected readonly status = computed(() => ticketStatusBadge(this.ticket()?.status ?? 'OPEN'));

  /** The move that is available, which is the one the button is named after. */
  protected readonly transitionLabel = computed(() =>
    this.ticket()?.status === 'RESOLVED' ? 'Reopen' : 'Resolve',
  );

  protected readonly opened = computed(() => {
    const row = this.ticket();
    return row ? relativeSince(row.createdAt) : NONE;
  });

  protected readonly updated = computed(() => {
    const row = this.ticket();
    return row ? relativeSince(row.updatedAt) : NONE;
  });

  protected readonly savable = computed(
    () => this.draftTitle().trim().length > 0 && this.action() === null,
  );

  /** The thread as the rows draw it: the byline's two derived facts, resolved once per comment. */
  protected readonly thread = computed<readonly DrawnComment[]>(() => {
    const state = this.comments();
    if (state.kind !== 'ready') {
      return [];
    }
    return state.value.map((comment) => ({
      comment,
      author: comment.author || NONE,
      age: relativeSince(comment.createdAt),
      edited: isEdited(comment),
    }));
  });

  /** Whether the channel has ever been up. Nothing is "behind" before it has ever been current. */
  private readonly wasLive = signal(false);

  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  /** Which project-and-slug the last run of the read effect was for, so a hop is told from a hint. */
  private watching: string | null = null;

  private hinted = 0;

  /** How many reads have started. A read that is no longer the newest is dropped when it lands. */
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const slug = this.ticketSlug();
      const hints = this.events.invalidations('tickets')();
      if (!projectId || !slug) {
        return;
      }
      const key = `${projectId}/${slug}`;
      // Arrival and a move to another ticket show the loading state. A hint on the ticket already on
      // screen never does — that is the whole difference between the two ways this effect runs.
      const quiet = key === this.watching && hints !== this.hinted;
      this.watching = key;
      this.hinted = hints;
      untracked(() => {
        this.events.connect(projectId);
        void this.load(quiet);
      });
    });

    effect(() => {
      if (this.events.connected()) {
        this.wasLive.set(true);
      }
    });

    inject(DestroyRef).onDestroy(() => this.events.close());
  }

  /**
   * Resolve the address to a ticket, then read its thread.
   *
   * The list is what turns the slug into a row — see the class note on why there is no by-slug read.
   * A slug the project does not hold is a not-found stated in the page's own error state rather than
   * an exception: nothing failed, the address simply names nothing.
   */
  protected async load(quiet = false): Promise<void> {
    const projectId = this.projectId();
    const slug = this.ticketSlug();
    if (!projectId || !slug) {
      this.subject.set(IDLE);
      return;
    }
    if (!quiet) {
      this.subject.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const found = ticketBySlug(await this.api.list(projectId), slug);
      if (!this.newest(attempt)) {
        return;
      }
      if (!found) {
        this.subject.set({ kind: 'error', status: 404, message: `No ticket '${slug}'.` });
        this.comments.set(IDLE);
        return;
      }
      this.subject.set(ready(found));
      await this.readComments(found.id, quiet);
    } catch (error) {
      if (this.newest(attempt) && !(quiet && this.ticket())) {
        this.subject.set(failed(error));
      }
    }
  }

  /** The retry under the comments' own async state, which re-reads only the thread. */
  protected async reloadComments(): Promise<void> {
    const row = this.ticket();
    if (row) {
      await this.readComments(row.id);
    }
  }

  /**
   * The thread, in its own state.
   *
   * Separate from the ticket's, because the two fail independently and only one of them is the page:
   * a comments read that falls over should leave the ticket on screen with a retry under the
   * heading, not replace the whole page with an error about a list.
   */
  private async readComments(ticketId: string, quiet = false): Promise<void> {
    if (!quiet) {
      this.comments.set(LOADING);
    }
    const attempt = this.attempt;
    try {
      const thread = await this.api.comments(ticketId);
      if (this.newest(attempt)) {
        this.comments.set(ready(thread));
      }
    } catch (error) {
      if (this.newest(attempt) && !(quiet && this.comments().kind === 'ready')) {
        this.comments.set(failed(error));
      }
    }
  }

  /** Whether an answer that has just landed is still the one this page is waiting for. */
  private newest(attempt: number): boolean {
    return attempt === this.attempt;
  }

  // ---- the ticket -------------------------------------------------------------------------------

  /** Open the edit form, seeded from the row — which is what makes an emptied box a clear. */
  protected startEditing(): void {
    const row = this.ticket();
    if (!row) {
      return;
    }
    this.draftTitle.set(row.title);
    this.draftType.set(row.type);
    this.draftDescription.set(row.description ?? '');
    this.draftAssignee.set(row.assignee ?? '');
    this.actionFailure.set(null);
    this.confirmingDelete.set(false);
    this.editing.set(true);
  }

  protected stopEditing(): void {
    this.editing.set(false);
    this.actionFailure.set(null);
  }

  protected onDraftTitle(event: Event): void {
    this.draftTitle.set((event.target as HTMLInputElement).value);
  }

  protected onDraftType(event: Event): void {
    this.draftType.set((event.target as HTMLSelectElement).value as TicketType);
  }

  protected onDraftDescription(event: Event): void {
    this.draftDescription.set((event.target as HTMLTextAreaElement).value);
  }

  protected onDraftAssignee(event: Event): void {
    this.draftAssignee.set((event.target as HTMLInputElement).value);
  }

  /**
   * Save the form as it stands: the four fields it shows, and a clear for each of the two it shows
   * empty.
   *
   * The whole form is sent rather than a diff. The boxes were seeded from the row, so what is in
   * them *is* the intended state — and computing a diff here would mean this page deciding that an
   * unchanged field need not be mentioned, which is a second implementation of the server's own
   * merge rule.
   */
  protected async save(): Promise<void> {
    const row = this.ticket();
    if (!row || !this.savable()) {
      return;
    }
    const description = this.draftDescription().trim();
    const assignee = this.draftAssignee().trim();
    const edit: TicketEdit = {
      title: this.draftTitle().trim(),
      type: this.draftType(),
      ...(description ? { description } : { clearDescription: true }),
      ...(assignee ? { assignee } : { clearAssignee: true }),
    };

    this.action.set('save');
    this.actionFailure.set(null);
    try {
      this.subject.set(ready(await this.api.update(row.id, edit)));
      this.editing.set(false);
    } catch (error) {
      this.actionFailure.set(`Could not save it — ${describeError(error)}.`);
    } finally {
      this.action.set(null);
    }
  }

  /**
   * Resolve it, or reopen it.
   *
   * The answer is the new subject rather than the trigger for a re-read: a ticket transition can
   * change exactly one row, and that row is what came back. That is the difference from an epic's
   * transition, which can create a second epic and so cannot be spliced.
   */
  protected async transition(): Promise<void> {
    const row = this.ticket();
    if (!row || this.action()) {
      return;
    }
    const target = row.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
    this.action.set('transition');
    this.actionFailure.set(null);
    try {
      this.subject.set(ready(await this.api.transition(row.id, target)));
    } catch (error) {
      this.actionFailure.set(`Could not move it — ${describeError(error)}.`);
    } finally {
      this.action.set(null);
    }
  }

  /** Ask first. The second press is {@link remove}. */
  protected askDelete(): void {
    this.actionFailure.set(null);
    this.confirmingDelete.set(true);
  }

  /** Delete it and leave: the page's subject is gone, so staying would draw a not-found. */
  protected async remove(): Promise<void> {
    const row = this.ticket();
    if (!row || this.action()) {
      return;
    }
    this.action.set('delete');
    this.actionFailure.set(null);
    try {
      await this.api.remove(row.id);
      await this.router.navigate(this.backRoute() as string[]);
    } catch (error) {
      this.actionFailure.set(`Could not delete it — ${describeError(error)}.`);
      this.confirmingDelete.set(false);
    } finally {
      this.action.set(null);
    }
  }

  // ---- the thread -------------------------------------------------------------------------------

  protected onComposed(event: Event): void {
    this.composed.set((event.target as HTMLTextAreaElement).value);
  }

  protected onCommentDraft(event: Event): void {
    this.commentDraft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Say something. The author is the session's, so only the body travels. */
  protected async addComment(): Promise<void> {
    const row = this.ticket();
    const body = this.composed().trim();
    if (!row || !body || this.commentAction()) {
      return;
    }
    this.commentAction.set('add');
    this.commentFailure.set(null);
    try {
      await this.api.addComment(row.id, body);
      this.composed.set('');
      await this.readComments(row.id);
    } catch (error) {
      this.commentFailure.set(`Could not add the comment — ${describeError(error)}.`);
    } finally {
      this.commentAction.set(null);
    }
  }

  protected startEditingComment(comment: TicketCommentDto): void {
    this.commentDraft.set(comment.body);
    this.commentFailure.set(null);
    this.editingComment.set(comment.id);
  }

  protected stopEditingComment(): void {
    this.editingComment.set(null);
    this.commentDraft.set('');
    this.commentFailure.set(null);
  }

  protected async saveComment(commentId: string): Promise<void> {
    const row = this.ticket();
    const body = this.commentDraft().trim();
    if (!row || !body || this.commentAction()) {
      return;
    }
    this.commentAction.set('save');
    this.commentFailure.set(null);
    try {
      await this.api.updateComment(commentId, body);
      this.stopEditingComment();
      await this.readComments(row.id);
    } catch (error) {
      this.commentFailure.set(`Could not save the comment — ${describeError(error)}.`);
    } finally {
      this.commentAction.set(null);
    }
  }

  protected async removeComment(commentId: string): Promise<void> {
    const row = this.ticket();
    if (!row || this.commentAction()) {
      return;
    }
    this.commentAction.set(`delete:${commentId}`);
    this.commentFailure.set(null);
    try {
      await this.api.removeComment(commentId);
      await this.readComments(row.id);
    } catch (error) {
      this.commentFailure.set(`Could not delete the comment — ${describeError(error)}.`);
    } finally {
      this.commentAction.set(null);
    }
  }
}
