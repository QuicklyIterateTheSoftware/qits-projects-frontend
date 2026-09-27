import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { TicketCommentDto } from '../api/dto';
import { EntitiesApi } from '../api/entities-api';
import { ProjectEvents } from '../api/project-events';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, relativeSince } from '../ui/format';
import { IDLE, LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { MarkdownView } from '../ui/markdown-view';
import { isEdited } from './entities-model';

/** One comment, with the two things the row derives rather than reads off the wire. */
interface DrawnComment {
  readonly comment: TicketCommentDto;
  readonly author: string;
  readonly age: string;
  readonly edited: boolean;
}

/**
 * **A ticket's thread** — the body the entity page draws for a ticket beneath its work, moved out of
 * the retired ticket page as it was (qits-397).
 *
 * <p>Comments read **oldest first**, which is the order a conversation is read in (the audit log is
 * newest-first, because a log is scanned from the top). The author is the session's, so only the body
 * travels; an edit moves `updatedAt` and the "edited" hint is derived from the two stamps. Every write
 * re-reads the thread rather than splicing it: the server's list is the truth.
 *
 * <p>It listens to the project's `tickets` topic — a dispatch or a phase advance writes here — and a
 * hint's re-read is quiet: it never blanks the thread, and a failed one leaves it standing.
 */
@Component({
  selector: 'app-ticket-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, MarkdownView, QitsButton],
  template: `
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
  `,
  styles: `
    :host {
      display: block;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
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
    .area {
      resize: vertical;
      font-family: inherit;
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
  `,
})
export class TicketThread {
  private readonly api = inject(EntitiesApi);
  private readonly events = inject(ProjectEvents);

  /** The ticket whose thread this is. */
  readonly ticketId = input.required<string>();

  protected readonly comments = signal<Loadable<readonly TicketCommentDto[]>>(IDLE);

  /** Which comment-level write is in flight — `add`, `save`, or `delete:<id>`. */
  protected readonly commentAction = signal<string | null>(null);
  protected readonly commentFailure = signal<string | null>(null);

  protected readonly editingComment = signal<string | null>(null);
  protected readonly commentDraft = signal('');
  protected readonly composed = signal('');

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

  private watching: string | null = null;
  private hinted = 0;
  private attempt = 0;

  constructor() {
    effect(() => {
      const ticketId = this.ticketId();
      const hints = this.events.invalidations('tickets')();
      if (!ticketId) {
        return;
      }
      const quiet = ticketId === this.watching && hints !== this.hinted;
      this.watching = ticketId;
      this.hinted = hints;
      untracked(() => void this.readComments(quiet));
    });
  }

  /** The retry under the thread's own async state. */
  protected reloadComments(): Promise<void> {
    return this.readComments();
  }

  private async readComments(quiet = false): Promise<void> {
    const ticketId = this.ticketId();
    if (!quiet) {
      this.comments.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const thread = await this.api.comments(ticketId);
      if (attempt === this.attempt) {
        this.comments.set(ready(thread));
      }
    } catch (error) {
      if (attempt === this.attempt && !(quiet && this.comments().kind === 'ready')) {
        this.comments.set(failed(error));
      }
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
    const ticketId = this.ticketId();
    const body = this.composed().trim();
    if (!ticketId || !body || this.commentAction()) {
      return;
    }
    this.commentAction.set('add');
    this.commentFailure.set(null);
    try {
      await this.api.addComment(ticketId, body);
      this.composed.set('');
      await this.readComments();
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
    const ticketId = this.ticketId();
    const body = this.commentDraft().trim();
    if (!ticketId || !body || this.commentAction()) {
      return;
    }
    this.commentAction.set('save');
    this.commentFailure.set(null);
    try {
      await this.api.updateComment(commentId, body);
      this.stopEditingComment();
      await this.readComments();
    } catch (error) {
      this.commentFailure.set(`Could not save the comment — ${describeError(error)}.`);
    } finally {
      this.commentAction.set(null);
    }
  }

  protected async removeComment(commentId: string): Promise<void> {
    const ticketId = this.ticketId();
    if (!ticketId || this.commentAction()) {
      return;
    }
    this.commentAction.set(`delete:${commentId}`);
    this.commentFailure.set(null);
    try {
      await this.api.removeComment(commentId);
      await this.readComments();
    } catch (error) {
      this.commentFailure.set(`Could not delete the comment — ${describeError(error)}.`);
    } finally {
      this.commentAction.set(null);
    }
  }
}
