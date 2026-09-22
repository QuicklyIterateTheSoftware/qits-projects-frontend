import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  epicEntity,
  ticketEntity,
  type Archetype,
  type Entity,
  type FeatureNode,
  type TicketEntity,
} from '../project/entities-model';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import { QITS_API_BASE } from './api-base';
import { ProjectsApi } from './projects-api';
import type {
  EntityStateDto,
  TicketAgentDispatchDto,
  TicketAgentDispatchResponse,
  TicketCommentDto,
  TicketCommentEntriesResponse,
  TicketCommentResponse,
  TicketEntriesResponse,
  TicketResponse,
  TicketStatus,
  TicketType,
} from './dto';

/**
 * What a POST sends to open a ticket.
 *
 * <p>`impetus` is **required**, and it is the field that makes a ticket worth having: one sentence,
 * in the reporter's words, saying what brought it about. The service refuses a create without one.
 * `description` is the *refinement's* output and so is normally absent at intake — a reporter who
 * already knows what should be done may write it, but nobody is asked to.
 *
 * <p>`description` and `assignee` are **optional rather than nullable**: the wire's absence is what
 * means "nothing was said", and sending an explicit `null` would be a third spelling of the same
 * thing. The page leaves an empty box off the body entirely.
 *
 * <p>Neither `createdBy` nor `status` is here, and both omissions are the contract rather than an
 * oversight. The principal is stamped from the session — a client that sent one would be asserting
 * an identity it does not own — and a new ticket is `REPORTED` by definition, so offering to create
 * one further down the lifecycle would be offering to claim phases that never ran.
 *
 * <p><b>No `archetype` either, and that is the shape of this whole migration.</b> The route says
 * which archetype is being opened, because the route is still `projects/{id}/tickets` — the service
 * unified the storage and deliberately did not move the contract.
 */
export interface NewTicket {
  readonly title: string;
  readonly impetus: string;
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
 * path. Moving a ticket down the lifecycle is an event, not a field edit, and keeping it out of this
 * body is what stops a retitle from quietly closing something.
 *
 * <p><b>`impetus` is here, and nothing freezes it.</b> Triage fixes a badly written impetus — that
 * is the one edit the field is for — and the later phases are kept off it by their **prompt
 * templates**, which tell a refining or implementing agent to answer the impetus rather than rewrite
 * it. Not by a guard: a guard would also refuse the correction triage is supposed to make, and the
 * rule it would be enforcing is a matter of editorial discipline rather than of data integrity.
 *
 * <p>It takes no paired clear, unlike the two above it. An impetus is required at intake, so no form
 * here can produce an empty one, and a `clearImpetus` this client never sends would be a promise
 * about a state the product does not have. What refining produces still goes in `description`.
 */
export interface TicketEdit {
  readonly title?: string;
  readonly impetus?: string;
  readonly description?: string;
  readonly clearDescription?: boolean;
  readonly type?: TicketType;
  readonly assignee?: string;
  readonly clearAssignee?: boolean;
}

/**
 * **A project's entities**, of either archetype — and the writes that belong to the ticket one.
 *
 * <p>This is what `TicketsApi` became. The service merged epics and tickets into one entity with an
 * archetype and left every route, DTO field and JSON name byte-identical, so that the SPA was not
 * forced to move in the deployment that migrated the data. That decision is the whole reason this
 * class looks the way it does: **there is no unified list endpoint to call.** `GET …/epics` and
 * `GET …/tickets` are still the two reads, and the unification is done here, once, on the way in.
 *
 * <p><b>{@link list} is the one read surface, and the archetype is a filter on it.</b> That is what
 * lets both desks — and anything that comes after them — ask the same question of a project and get
 * one collection of one type back. It is also what keeps the cost honest: a filter that names an
 * archetype reads exactly that archetype's endpoint, so the tickets desk pays for one request the
 * way it always did and the epics desk pays for its fan-out and nobody pays for the other's. Asking
 * for both is two requests **in parallel**, not a request per row — the thing a "unified" read is
 * easiest to get catastrophically wrong.
 *
 * <p><b>The epic fan-out lives here rather than in the panel that used to own it.</b> An epic's
 * features and its tasks are part of the entity — a card cannot say how far along an epic is without
 * them — so assembling one is transport's job and not a screen's. It is delegated to
 * {@link ProjectsApi}, which already owns those three routes; duplicating them here would be a second
 * copy of an address.
 *
 * <p><b>Two path families for the ticket writes, and the split is the service's.</b> A list and a
 * create are addressed under their parent — `projects/{id}/tickets`, `tickets/{id}/comments` —
 * because that is the only place the parent is known. Everything about one existing row is addressed
 * by that row's own id at the top level, `tickets/{id}` and `ticket-comments/{id}`, because an id is
 * already unique and repeating its parent in the path would be a second copy of a fact the id
 * carries. The epics use the same grammar, mirrored rather than reinvented.
 *
 * <p><b>The deletes drop their bodies.</b> Both answer `{"success": true}`, which adds nothing a 200
 * has not already said. The callers re-read instead of splicing the row out: the server's list is the
 * truth about what a project holds, and this client's is a copy.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);
  private readonly projects = inject(ProjectsApi);

  /**
   * Every entity in a project, of one archetype or of both.
   *
   * <p>The filter is optional and omitting it means "everything", which is the honest default for a
   * collection: a caller that wants one desk's rows says so, and a caller that wants the project's
   * whole body of work does not have to name the archetypes that exist today.
   *
   * <p>Both reads keep the server's order — createdAt ascending — and neither is re-sorted here. The
   * grouping and the newest-first ordering belong to the desks: transport does not decide how a
   * screen reads. A project with no rows of an archetype answers an empty list rather than a 404, so
   * absence needs no translation.
   */
  async list(projectId: string, archetype?: Archetype): Promise<readonly Entity[]> {
    if (archetype === 'EPIC') {
      return this.epics(projectId);
    }
    if (archetype === 'TICKET') {
      return this.tickets(projectId);
    }
    const [epics, tickets] = await Promise.all([this.epics(projectId), this.tickets(projectId)]);
    return [...epics, ...tickets];
  }

  /** Open a ticket. It is `REPORTED` and stamped with the session's principal when it answers. */
  async create(projectId: string, ticket: NewTicket): Promise<TicketEntity> {
    const response = await firstValueFrom(
      this.http.post<TicketResponse>(this.ticketsPath(projectId), ticket),
    );
    return ticketEntity(response.ticket);
  }

  /**
   * One ticket by **id**.
   *
   * Not by slug, and there is no by-slug read on the service: the slug is the *address* grammar and
   * the id is the API's, which is the same division {@link ../nav/project-param#ProjectParam} makes
   * one segment up. The detail page resolves the one to the other through the project's collection.
   */
  async get(ticketId: string): Promise<TicketEntity> {
    const response = await firstValueFrom(this.http.get<TicketResponse>(this.ticket(ticketId)));
    return ticketEntity(response.ticket);
  }

  /** Change a ticket's words, its kind or who has it. See {@link TicketEdit} for the clears. */
  async update(ticketId: string, edit: TicketEdit): Promise<TicketEntity> {
    const response = await firstValueFrom(
      this.http.put<TicketResponse>(this.ticket(ticketId), edit),
    );
    return ticketEntity(response.ticket);
  }

  /**
   * Move a ticket one step along the lifecycle, forwards or back.
   *
   * <p>A POST to a verb rather than a PUT of a field, mirroring the epic transition: this is a thing
   * that *happens* to a ticket, and the service is free to do more than set a column when it does.
   *
   * <p><b>The service owns adjacency.</b> A target two steps away, or the status the ticket already
   * holds, answers 409 with the sentence saying so — which is what a page that has been open while
   * somebody else moved the ticket renders. The caller offers only the neighbours
   * ({@link ../project/entities-model#ticketTransitions}), but offering correctly is not the same as
   * being sure, and only the server is.
   *
   * <p><b>This is still the single-row door, and it stays that way.</b> The unified entity brought a
   * multi-entity write with it — {@link transitionEntities}, taking a map of id to full target state —
   * and the reshape panel is what calls it. A one-row lifecycle step has no business paying for a map:
   * this door takes a target and nothing else, where that one restates every property of every row it
   * touches. Routing a "mark verified" through the map form would make a page that only meant to move
   * a status responsible for resending the ticket's impetus, its assignee and its kind, and would
   * clear whichever of them it got wrong.
   */
  async transition(ticketId: string, target: TicketStatus): Promise<TicketEntity> {
    const response = await firstValueFrom(
      this.http.post<TicketResponse>(`${this.ticket(ticketId)}/transition`, { target }),
    );
    return ticketEntity(response.ticket);
  }

  /**
   * Say that a ticket's phase cannot proceed, or that it can again.
   *
   * <p>A POST to its own door rather than a field on {@link update}, for {@link transition}'s reason:
   * blocking is a thing that *happens* to a ticket — it writes a comment saying why, and the service
   * is free to do more than set a column — where the edit is a restatement of the ticket's words.
   * Sending it through the edit would also make every other box on that form part of a block.
   *
   * <p><b>The reason is required to block and a note to unblock, and the asymmetry is the point.</b>
   * A blocked ticket with no reason is a row that stops and does not say what it is waiting for,
   * which is the one thing anybody reading it afterwards needs; coming *back* from that is
   * self-explanatory — the thing it was waiting for arrived — so a note there is worth having and not
   * worth demanding. The caller withholds the press until there is a reason
   * ({@link ../project/entities-model#hasPhase} says where the press is offered at all), and the
   * service refuses a blank one regardless: offering correctly is not the same as being sure.
   *
   * <p>The answer is the ticket, and it is the new subject exactly the way a transition's is — one
   * row in, one row out, nothing else on the project can have moved.
   */
  async setBlocked(ticketId: string, blocked: boolean, reason = ''): Promise<TicketEntity> {
    const response = await firstValueFrom(
      this.http.post<TicketResponse>(`${this.ticket(ticketId)}/blocked`, { blocked, reason }),
    );
    return ticketEntity(response.ticket);
  }

  /**
   * **Restate several entities at once**, and have the service take all of it or none of it.
   *
   * <p><b>A map of id to that entity's whole target state, applied atomically.</b> The shape is the
   * contract and it is the reason this exists beside {@link transition} rather than instead of it. A
   * person splitting a feature out of an epic is promoting the feature *and* re-shaping the tasks
   * under it, and those two writes are not independent: sent separately, one of the two orders is
   * refused outright — a feature cannot hold a feature, so promoting the tasks first is illegal while
   * their parent is still one — and the other order walks the plan through an arrangement nobody asked
   * for and leaves it there if the second call fails. One request is the only expression of one
   * intention.
   *
   * <p><b>PUT semantics per entry: a property the body does not carry is cleared.</b> There is no
   * partial spelling and no paired `clear…` boolean the way {@link TicketEdit} has one, because the
   * entry is not an edit — it is the row as it is to be. That is what makes the form's "what will be
   * lost" warning load-bearing rather than decorative: demoting a ticket to a feature discards its
   * status, its kind, its impetus and its assignee by *omission*, and the only place that can be
   * noticed is before the press.
   *
   * <p><b>A refusal is one 400 carrying every violation, joined with `"; "`.</b> Not the first
   * violation and not one 400 per entry — the whole request failed, so the whole reason is answered,
   * and a reader fixing one field at a time across four round trips is a reader who gives up. The
   * panel splits that sentence and points the fragments at the fields they name.
   *
   * <p>The answer is the post-state of every row written, keyed the same way the request was. It is
   * returned rather than dropped — unlike the deletes above — because the ids are the only thing
   * linking a reshaped row back to the entry that asked for it, and the caller re-reads the project
   * anyway.
   */
  async transitionEntities(
    request: ReadonlyMap<string, EntityTransitionRequest>,
  ): Promise<ReadonlyMap<string, EntityStateDto>> {
    const body = Object.fromEntries(request);
    const response = await firstValueFrom(
      this.http.post<Record<string, EntityStateDto>>(
        `${this.base}/projects/api/entities/transition`,
        body,
      ),
    );
    return new Map(Object.entries(response ?? {}));
  }

  /**
   * Put a workspace and a coding agent onto a ticket, and answer where they went.
   *
   * <p>A POST to a verb with **no body at all**: everything the door needs is the ticket, which the
   * path already names, and the principal, which the session stamps. The `{}` is Angular's way of
   * spelling an empty POST, the same one the refinement container calls use.
   *
   * <p><b>Idempotent by construction.</b> Behind it is find-or-create, so a second press re-enters
   * the workspace the first one made rather than opening another — which is what makes it safe for a
   * page that cannot remember, after a reload, that it ever pressed.
   *
   * <p>The door also writes a comment on the ticket and fires the project's `tickets` topic, so no
   * caller re-reads the list itself: the live channel does it, and a manual reload on top would be a
   * second read of the same change.
   */
  async dispatchAgent(ticketId: string): Promise<TicketAgentDispatchDto> {
    const response = await firstValueFrom(
      this.http.post<TicketAgentDispatchResponse>(`${this.ticket(ticketId)}/dispatch-agent`, {}),
    );
    return response.dispatch;
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

  /** The tickets of a project, as entities. One request, the envelope unwrapped here. */
  private async tickets(projectId: string): Promise<readonly Entity[]> {
    const response = await firstValueFrom(
      this.http.get<TicketEntriesResponse>(this.ticketsPath(projectId)),
    );
    return response.entries.map((entry) => ticketEntity(entry.ticket));
  }

  /**
   * The epics of a project, as entities, each with its features and their tasks.
   *
   * <p>The epics, then their features, then their tasks — each level in parallel across its parents,
   * which is what keeps a project with twenty epics three round trips deep rather than sixty. It is
   * a fan-out and it is the price of an archetype the service answers as three lists; the alternative
   * is a card that claims an epic is smaller than it is.
   */
  private async epics(projectId: string): Promise<readonly Entity[]> {
    const epics = await this.projects.epics(projectId);
    return Promise.all(
      epics.map(async (epic) => epicEntity(epic, await this.features(epic.id))),
    );
  }

  private async features(epicId: string): Promise<readonly FeatureNode[]> {
    const features = await this.projects.features(epicId);
    return Promise.all(
      features.map(async (feature) => ({ feature, tasks: await this.projects.tasks(feature.id) })),
    );
  }

  private ticketsPath(projectId: string): string {
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
