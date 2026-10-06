import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  epicEntity,
  ticketEntity,
  type Archetype,
  type Entity,
  type EpicEntity,
  type FeatureNode,
  type TicketEntity,
} from '../project/entities-model';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import { campaignEntity, type CampaignEntity, type WorkItem } from '../project/campaign-model';
import { QITS_API_BASE } from './api-base';
import { CampaignsApi } from './campaigns-api';
import { ProjectsApi } from './projects-api';
import type {
  AuditEntriesResponse,
  AuditEntryDto,
  CommentDto,
  CommentEntriesResponse,
  CommentResponse,
  DispatchMode,
  EntityBlockDto,
  EntityBlockResponse,
  EntityDispatchAnswer,
  EntityDispatchStateDto,
  EntityDispatchStateResponse,
  EntityStatus,
  TicketType,
  WorkspaceReferenceDto,
} from './dto';
import {
  epicOf,
  featureOf,
  taskOf,
  ticketOf,
  workRef,
  type WorkEntityDto,
  type WorkWorkspacesResponse,
} from './work';

/**
 * Every PATCH here — an entity's, a comment's — is a JSON merge patch (RFC 7396), sent as plain
 * `application/json`. The `/work` doors read either spelling as the same merge patch
 * (`@Consumes({application/merge-patch+json, application/json})`), and the plain one is what the
 * consumer pact can state: a golden interaction pins its request's `Content-Type` to
 * `application/json`.
 */

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
 * <p><b>No `archetype` either</b>: {@link EntitiesApi.create} adds it, since `POST /work` opens every
 * archetype from one body shape, and maps `type` onto the wire's `ticketType`.
 */
export interface NewTicket {
  readonly title: string;
  readonly impetus: string;
  readonly description?: string;
  readonly type: TicketType;
  readonly assignee?: string;
}

/**
 * **A project's entities**, of every root archetype, on the `/work` surface (epic qits-965) — and
 * the writes that belong to one entity.
 *
 * <p><b>Everything about one entity is addressed by its qualified id</b> — `/work/{q}/…`, whichever
 * archetype it is; a UUID still resolves, so a row with no qualified id is addressed by its id (see
 * {@link workRef}). The callers pass that reference; this class never composes one from parts.
 *
 * <p><b>{@link list} is the one read surface, and the archetype is a filter on it.</b> The service
 * answers a project's whole tree in one read (`GET /projects/{project}/work`), so every desk asks the
 * same question and filters the answer. That listing is a summary, though — no description, no
 * acceptance criteria, no workspaces — and every reader here draws those, so each root is read whole
 * (`GET /work/{q}`) and its workspaces asked (`GET /work/{q}/workspaces`), in parallel across the
 * roots. An epic's features and their tasks come from `GET /work/{q}/children`, which carries their
 * bodies: the reshape form restates them, and a restatement without a body would clear it.
 *
 * <p><b>Comments are the one thread every archetype shares</b> (qits-551): `/work/{q}/comments` for
 * the list and the create, and `/work/{q}/comments/{commentId}` for an edit or a delete.
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
  private readonly campaigns = inject(CampaignsApi);

  /**
   * Every root of work in a project — epics, tickets and campaigns — or those of one archetype.
   *
   * <p>The filter is optional and omitting it means "everything", which is the honest default for a
   * collection: a caller that wants one desk's rows says so, and a caller that wants the project's
   * whole body of work does not have to name the archetypes that exist today.
   *
   * <p>The roots keep the server's order — createdAt ascending — and are not re-sorted here. The
   * grouping and the newest-first ordering belong to the desks. A project with no rows answers an
   * empty list rather than a 404, so absence needs no translation.
   *
   * <p><b>Campaigns are roots of work too</b> (qits-419), stamped `archetype: 'CAMPAIGN'` with their
   * started/active/member count read off each one's progress. Without them the detail page could not
   * resolve a campaign's number, since it looks the number up in this same collection.
   */
  list(projectId: string, archetype: Archetype): Promise<readonly Entity[]>;
  list(projectId: string, archetype: 'CAMPAIGN'): Promise<readonly CampaignEntity[]>;
  list(projectId: string, archetype?: Archetype | 'CAMPAIGN'): Promise<readonly WorkItem[]>;
  async list(projectId: string, archetype?: Archetype | 'CAMPAIGN'): Promise<readonly WorkItem[]> {
    const rows = await this.projects.work(projectId);
    const roots = rows.filter(
      (row) => row.parent === null && (archetype === undefined || row.archetype === archetype),
    );
    const items = await Promise.all(roots.map((row) => this.root(row)));
    return items.filter((item): item is WorkItem => item !== null);
  }

  /**
   * The epics and the tickets, without the campaigns — the pre-campaign "everything". For the readers
   * a campaign can never be a subject of: the reshape form (the multi-entity transition refuses a
   * campaign) and the refinement room (a campaign has none).
   */
  async epicsAndTickets(projectId: string): Promise<readonly Entity[]> {
    const rows = await this.projects.work(projectId);
    const roots = rows.filter(
      (row) => row.parent === null && (row.archetype === 'EPIC' || row.archetype === 'TICKET'),
    );
    const items = await Promise.all(roots.map((row) => this.root(row)));
    return items.filter((item): item is Entity => item !== null && item.archetype !== 'CAMPAIGN');
  }

  /**
   * Open a ticket — `POST /work` with `archetype: TICKET`. It is `REPORTED` and stamped with the
   * session's principal when it answers.
   */
  async create(projectId: string, ticket: NewTicket): Promise<TicketEntity> {
    const { type, ...rest } = ticket;
    const created = await this.projects.createWork({
      archetype: 'TICKET',
      project: projectId,
      ...rest,
      ticketType: type,
    });
    return ticketEntity(ticketOf(created));
  }

  /** One ticket by qualified id (or id), with its workspaces. */
  async get(ref: string): Promise<TicketEntity> {
    const [ticket, workspaces] = await Promise.all([
      this.projects.workItem(ref),
      this.workspaces(ref),
    ]);
    return ticketEntity(ticketOf(ticket, workspaces));
  }

  /**
   * Move an entity one step along the lifecycle, forwards or back — every archetype's lifecycle door,
   * `POST /work/{q}/status` (see {@link ProjectsApi.setStatus}).
   *
   * <p><b>The service owns adjacency.</b> A target two steps away, or the status the entity already
   * holds, answers 409 with the sentence saying so — which is what a page that has been open while
   * somebody else moved it renders. The caller offers only the neighbours, but offering correctly is
   * not the same as being sure, and only the server is.
   *
   * <p><b>A status move stays on this door.</b> The multi-entity write ({@link transitionEntities})
   * restates a row's shape and runs no lifecycle at all — no adjacency, no phase advance after the
   * move, no discarding of the refinement room a resolving move ends.
   */
  transition(ref: string, target: EntityStatus): Promise<WorkEntityDto> {
    return this.projects.setStatus(ref, target);
  }

  /**
   * Say that an epic's, a ticket's or a campaign's phase cannot proceed, or that it can again —
   * `POST /work/{q}/blocked`.
   *
   * <p>A POST to its own door rather than a field on the edit: blocking is a thing that *happens* to
   * an entity — it writes a comment saying why. A feature or a task has no lifecycle phase, and the
   * service refuses one there with a 409, the same as a status with no phase running (VERIFIED, DONE,
   * DROPPED).
   *
   * <p><b>The reason is required to block and a note to unblock, and the asymmetry is the point.</b>
   * The caller withholds the press until there is a reason, and the service refuses a blank one
   * regardless.
   *
   * <p>The answer is the flag as the write left it, not the whole row.
   */
  async setBlocked(ref: string, blocked: boolean, reason = ''): Promise<EntityBlockDto> {
    const response = await firstValueFrom(
      this.http.post<EntityBlockResponse>(`${this.work(ref)}/blocked`, { blocked, reason }),
    );
    return response.block;
  }

  /**
   * **Restate several entities at once**, and have the service take all of it or none of it —
   * `POST /work/transition`.
   *
   * <p><b>A map of entity to that entity's whole target state, applied atomically.</b> A person
   * splitting a feature out of an epic is promoting the feature *and* re-shaping the tasks under it,
   * and those two writes are not independent: one request is the only expression of one intention.
   * The keys, and every id in an entry, are qualified ids or UUIDs.
   *
   * <p><b>PUT semantics per entry: a property the body does not carry is cleared.</b> That is what
   * makes the form's "what will be lost" warning load-bearing rather than decorative.
   *
   * <p><b>A refusal is one 400 carrying every violation, joined with `"; "`.</b> The panel splits
   * that sentence and points the fragments at the fields they name.
   *
   * <p>The answer is the post-state of every row written, keyed exactly as the request was.
   */
  async transitionEntities(
    request: ReadonlyMap<string, EntityTransitionRequest>,
  ): Promise<ReadonlyMap<string, WorkEntityDto>> {
    const body = Object.fromEntries(request);
    const response = await firstValueFrom(
      this.http.post<Record<string, WorkEntityDto>>(
        `${this.base}/projects/api/work/transition`,
        body,
      ),
    );
    return new Map(Object.entries(response ?? {}));
  }

  /**
   * **A field edit as a JSON merge patch** — `PATCH /work/{q}` (qits-887 is its first reader here:
   * the acceptance criteria). A property the body names is written, `null` clears it, and one it
   * leaves out is left alone — the opposite of {@link transitionEntities}. A list is sent whole. A
   * 400 names every refusal in one sentence; a 409 is a freeze. Answers the row as it now stands.
   */
  patch(ref: string, changes: Readonly<Record<string, unknown>>): Promise<WorkEntityDto> {
    return firstValueFrom(
      this.http.patch<WorkEntityDto>(this.work(ref), changes),
    );
  }

  /**
   * **Dispatch** (`FLOW`) or **Run the next phase** (`PHASE`) — the one dispatching door for every
   * archetype with a lifecycle (qits-394), `POST /work/{q}/dispatch`.
   *
   * <p>It starts the phase the entity's status implies in a workspace on the project's wrapper, on
   * `ticket/<slug>` or `epic/<slug>`, and answers where it went. A VERIFIED, DONE or DROPPED entity, a
   * blocked one, a feature and a task are 409s — which is why a page asks {@link dispatchState}
   * first and does not offer the press at all where it would be refused.
   *
   * <p><b>On a campaign the press is its start</b> (qits-417) and the answer is `{progress}` rather
   * than `{dispatch}`, so the envelope is returned whole and a caller narrows on the key —
   * `'progress' in answer`. See {@link EntityDispatchAnswer}.
   */
  dispatch(ref: string, mode: DispatchMode): Promise<EntityDispatchAnswer> {
    return firstValueFrom(
      this.http.post<EntityDispatchAnswer>(`${this.work(ref)}/dispatch`, { mode }),
    );
  }

  /**
   * What a press would start, asked before anybody presses: `nextPhase`, `dispatchable`, the block
   * and the stored mode — `GET /work/{q}/dispatch`.
   */
  async dispatchState(ref: string): Promise<EntityDispatchStateDto> {
    const response = await firstValueFrom(
      this.http.get<EntityDispatchStateResponse>(`${this.work(ref)}/dispatch`),
    );
    return response.state;
  }

  /**
   * The history of an entity, newest first — `GET /work/{q}/audit`. A root (an epic, a ticket, a
   * campaign) answers its whole subtree; a feature or a task its own rows. It answers after the rows
   * are gone, which is the point of an audit log.
   */
  async audit(ref: string): Promise<readonly AuditEntryDto[]> {
    const response = await firstValueFrom(
      this.http.get<AuditEntriesResponse>(`${this.work(ref)}/audit`),
    );
    return response.entries ?? [];
  }

  /** Remove an entity and everything said on it. See the class note on the deletes. */
  remove(ref: string): Promise<void> {
    return this.projects.deleteWork(ref);
  }

  /** The workspaces a dispatch stood on an entity's branch, live and resolved alike. */
  async workspaces(ref: string): Promise<readonly WorkspaceReferenceDto[]> {
    const response = await firstValueFrom(
      this.http.get<WorkWorkspacesResponse>(`${this.work(ref)}/workspaces`),
    );
    return response.workspaces ?? [];
  }

  /** One entity's comments, oldest first, whichever archetype it is (qits-551). */
  async comments(ref: string): Promise<readonly CommentDto[]> {
    const response = await firstValueFrom(
      this.http.get<CommentEntriesResponse>(`${this.work(ref)}/comments`),
    );
    return response.entries.map((entry) => entry.comment);
  }

  /** Say something on an entity's thread. The author is stamped from the session, so only the body is sent. */
  async addComment(ref: string, body: string): Promise<CommentDto> {
    const response = await firstValueFrom(
      this.http.post<CommentResponse>(`${this.work(ref)}/comments`, { body }),
    );
    return response.comment;
  }

  /**
   * Rewrite one comment of the entity's thread, as a JSON merge patch (qits-551): the only property
   * it carries is `body`. The answer's `updatedAt` is what makes the "edited" hint appear beside it.
   */
  async updateComment(ref: string, commentId: string, body: string): Promise<CommentDto> {
    const response = await firstValueFrom(
      this.http.patch<CommentResponse>(this.comment(ref, commentId), { body }),
    );
    return response.comment;
  }

  /** Take one comment back. The `success` body is dropped, and the caller re-reads the thread. */
  async removeComment(ref: string, commentId: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.comment(ref, commentId)));
  }

  /** One root of the listing as a desk item; null for an archetype no desk draws. */
  private root(row: WorkEntityDto): Promise<WorkItem | null> {
    switch (row.archetype) {
      case 'EPIC':
        return this.epic(row);
      case 'TICKET':
        return this.ticket(row);
      case 'CAMPAIGN':
        return this.campaigns.summary(row).then(campaignEntity);
      default:
        return Promise.resolve(null);
    }
  }

  /** A ticket, read whole, with its workspaces. */
  private async ticket(row: WorkEntityDto): Promise<TicketEntity> {
    const ref = workRef(row);
    const [ticket, workspaces] = await Promise.all([
      this.projects.workItem(ref),
      this.workspaces(ref),
    ]);
    return ticketEntity(ticketOf(ticket, workspaces));
  }

  /**
   * An epic, read whole, with its workspaces and its features and their tasks — each level in
   * parallel across its parents, so a project with twenty epics stays three round trips deep.
   */
  private async epic(row: WorkEntityDto): Promise<EpicEntity> {
    const ref = workRef(row);
    const [epic, workspaces, features] = await Promise.all([
      this.projects.workItem(ref),
      this.workspaces(ref),
      this.features(ref),
    ]);
    return epicEntity(epicOf(epic, workspaces), features);
  }

  private async features(epicRef: string): Promise<readonly FeatureNode[]> {
    const features = await this.projects.children(epicRef);
    return Promise.all(
      features.map(async (feature) => ({
        feature: featureOf(feature),
        tasks: (await this.projects.children(workRef(feature))).map(taskOf),
      })),
    );
  }

  private work(ref: string): string {
    return `${this.base}/projects/api/work/${encodeURIComponent(ref)}`;
  }

  private comment(ref: string, commentId: string): string {
    return `${this.work(ref)}/comments/${encodeURIComponent(commentId)}`;
  }
}
