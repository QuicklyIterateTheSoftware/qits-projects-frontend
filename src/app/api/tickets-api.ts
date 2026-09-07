import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  TicketCommentDto,
  TicketCommentEntriesResponse,
  TicketCommentResponse,
  TicketDto,
  TicketEntriesResponse,
  TicketResponse,
  TicketStatus,
  TicketType,
} from './dto';

/**
 * What a POST sends to open a ticket.
 *
 * <p>`description` and `assignee` are **optional rather than nullable**: the wire's absence is what
 * means "nothing was said", and sending an explicit `null` would be a third spelling of the same
 * thing. The page leaves an empty box off the body entirely.
 *
 * <p>Neither `createdBy` nor `status` is here, and both omissions are the contract rather than an
 * oversight. The principal is stamped from the session — a client that sent one would be asserting
 * an identity it does not own — and a new ticket is `OPEN` by definition, so offering to create a
 * resolved one would be offering to skip the work.
 */
export interface NewTicket {
  readonly title: string;
  readonly description?: string;
  readonly type: TicketType;
  readonly assignee?: string;
}

/**
 * What a PUT sends to change a ticket: every field optional, and **two of them paired with an
 * explicit clear**.
 *
 * <p>That pairing is the whole shape of this body. A partial update means an absent field is
 * untouched, so absence cannot also mean "empty it" — the two are opposite intentions and a single
 * spelling would make one of them unreachable. `clearDescription` and `clearAssignee` are how a
 * reader takes a description or an assignee *off* a ticket, and they are separate booleans rather
 * than a `null` value so that the request stays readable in a log.
 *
 * <p>`status` is not here: it moves through the transition, which is a different verb on a different
 * path. Resolving a ticket is an event, not a field edit, and keeping it out of this body is what
 * stops a retitle from quietly closing something.
 */
export interface TicketEdit {
  readonly title?: string;
  readonly description?: string;
  readonly clearDescription?: boolean;
  readonly type?: TicketType;
  readonly assignee?: string;
  readonly clearAssignee?: boolean;
}

/**
 * The tickets on a project, and the conversations on them.
 *
 * <p><b>A service of its own rather than more methods on {@link ./projects-api#ProjectsApi}</b>, for
 * the reason {@link ./designs-api#DesignsApi} is one: tickets are a whole subject with ten calls and
 * two row types, and folding them into the class that already carries projects, repositories, the
 * wrapper and three levels of the plan would make that file the place everything goes. The
 * conventions are shared and nothing else is — `HttpClient` on the fetch backend, `firstValueFrom`
 * immediately, ids escaped rather than pasted, and the envelope unwrapped here so no page ever sees
 * an `entries` array.
 *
 * <p><b>Two path families, and the split is the service's.</b> A list and a create are addressed
 * under their parent — `projects/{id}/tickets`, `tickets/{id}/comments` — because that is the only
 * place the parent is known. Everything about one existing row is addressed by that row's own id at
 * the top level, `tickets/{id}` and `ticket-comments/{id}`, because an id is already unique and
 * repeating its parent in the path would be a second copy of a fact the id carries. That is the same
 * grammar the epics use (`projects/{id}/epics`, then `epics/{id}`), mirrored rather than reinvented.
 *
 * <p><b>The deletes drop their bodies.</b> Both answer `{"success": true}`, which adds nothing a 200
 * has not already said. The callers re-read instead of splicing the row out, exactly as the
 * repository delete does: the server's list is the truth about what a project holds, and this
 * client's is a copy.
 */
@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every ticket in a project, in the server's order — createdAt ascending.
   *
   * A project with no tickets answers an empty list rather than a 404, so absence is an ordinary
   * state and needs no translation. The grouping and the newest-first ordering are the overview's,
   * not this method's: transport does not decide how a screen reads.
   */
  async list(projectId: string): Promise<readonly TicketDto[]> {
    const response = await firstValueFrom(
      this.http.get<TicketEntriesResponse>(this.tickets(projectId)),
    );
    return response.entries.map((entry) => entry.ticket);
  }

  /** Open a ticket. It is `OPEN` and stamped with the session's principal by the time it answers. */
  async create(projectId: string, ticket: NewTicket): Promise<TicketDto> {
    const response = await firstValueFrom(
      this.http.post<TicketResponse>(this.tickets(projectId), ticket),
    );
    return response.ticket;
  }

  /**
   * One ticket by **id**.
   *
   * Not by slug, and there is no by-slug read on the service: the slug is the *address* grammar and
   * the id is the API's, which is the same division {@link ../nav/project-param#ProjectParam} makes
   * one segment up. The detail page resolves the one to the other through the project's list.
   */
  async get(ticketId: string): Promise<TicketDto> {
    const response = await firstValueFrom(this.http.get<TicketResponse>(this.ticket(ticketId)));
    return response.ticket;
  }

  /** Change a ticket's words, its kind or who has it. See {@link TicketEdit} for the clears. */
  async update(ticketId: string, edit: TicketEdit): Promise<TicketDto> {
    const response = await firstValueFrom(
      this.http.put<TicketResponse>(this.ticket(ticketId), edit),
    );
    return response.ticket;
  }

  /**
   * Resolve a ticket, or reopen it.
   *
   * A POST to a verb rather than a PUT of a field, mirroring the epic transition: this is a thing
   * that *happens* to a ticket, and the service is free to do more than set a column when it does.
   */
  async transition(ticketId: string, target: TicketStatus): Promise<TicketDto> {
    const response = await firstValueFrom(
      this.http.post<TicketResponse>(`${this.ticket(ticketId)}/transition`, { target }),
    );
    return response.ticket;
  }

  /** Remove a ticket and everything said on it. The `success` body is dropped — see the class note. */
  async remove(ticketId: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.ticket(ticketId)));
  }

  /** One ticket's comments, oldest first, which is the order a conversation is read in. */
  async comments(ticketId: string): Promise<readonly TicketCommentDto[]> {
    const response = await firstValueFrom(
      this.http.get<TicketCommentEntriesResponse>(this.commentsOf(ticketId)),
    );
    return response.entries.map((entry) => entry.comment);
  }

  /** Say something on a ticket. The author is stamped from the session, so only the body is sent. */
  async addComment(ticketId: string, body: string): Promise<TicketCommentDto> {
    const response = await firstValueFrom(
      this.http.post<TicketCommentResponse>(this.commentsOf(ticketId), { body }),
    );
    return response.comment;
  }

  /**
   * Rewrite one comment.
   *
   * Addressed at `ticket-comments/{id}` rather than under its ticket, because the id is already
   * unique — and the answer's `updatedAt` is what makes the "edited" hint appear beside it.
   */
  async updateComment(commentId: string, body: string): Promise<TicketCommentDto> {
    const response = await firstValueFrom(
      this.http.put<TicketCommentResponse>(this.comment(commentId), { body }),
    );
    return response.comment;
  }

  /** Take one comment back. The `success` body is dropped, and the caller re-reads the thread. */
  async removeComment(commentId: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.comment(commentId)));
  }

  private tickets(projectId: string): string {
    return `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/tickets`;
  }

  private ticket(ticketId: string): string {
    return `${this.base}/projects/api/tickets/${encodeURIComponent(ticketId)}`;
  }

  private commentsOf(ticketId: string): string {
    return `${this.ticket(ticketId)}/comments`;
  }

  private comment(commentId: string): string {
    return `${this.base}/projects/api/ticket-comments/${encodeURIComponent(commentId)}`;
  }
}
