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
import { flattenEntities, nodeByNumber } from '../project/entity-nodes';
import { QITS_API_BASE } from './api-base';
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
  type DropResolution,
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
 * same question and filters the answer. **The desk is drawn from that listing alone** (qits-1815):
 * an epic's features and tasks are the listing's own rows under it, by `parent`, and every ticket's
 * and epic's workspaces come from one more read for the whole project
 * (`GET /projects/{project}/work/workspaces`, {@link ProjectsApi.workWorkspaces}). That is a request
 * count that does not grow with the project. It used to be `GET /work/{q}` and `/workspaces` for
 * every root plus `/children` for every epic and feature, all at once: about 1,900 requests on a
 * project of 743 roots, which headless Chromium refuses with `net::ERR_INSUFFICIENT_RESOURCES` and
 * the desk drew as an unreachable service.
 *
 * <p><b>So what {@link list} answers is a summary</b> — no description and no acceptance criteria on
 * any row, epic, ticket, feature or task. A reader that draws a body, or **writes one back**, reads
 * the one entity it is about whole: {@link get} (a ticket), {@link epic} (an epic with its features'
 * and tasks' bodies), or {@link whole} for whichever root a row is, and {@link listWithWhole} for a
 * page addressed by number. That matters most for the writes: the multi-entity transition is PUT per
 * entry, so restating an entity built from a summary row would *clear* its description.
 * {@link wholeRow} is the read the reshape panel makes for every row it restates.
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

  /**
   * Every root of work in a project — epics and tickets — or those of one archetype.
   *
   * <p>The filter is optional and omitting it means "everything", which is the honest default for a
   * collection: a caller that wants one desk's rows says so, and a caller that wants the project's
   * whole body of work does not have to name the archetypes that exist today.
   *
   * <p>The roots keep the server's order — createdAt ascending — and are not re-sorted here. The
   * grouping and the newest-first ordering belong to the desks. A project with no rows answers an
   * empty list rather than a 404, so absence needs no translation.
   */
  list(projectId: string, archetype?: Archetype): Promise<readonly Entity[]> {
    return this.desk(projectId, (row) => archetype === undefined || row.archetype === archetype);
  }

  /**
   * The epics and the tickets — every root this client reads (qits-1907 retired the campaign desk).
   * The reshape form reads this too, since the multi-entity transition is theirs alone. The
   * refinement room reads {@link list} directly. A summary, like {@link list}: see the class note.
   */
  epicsAndTickets(projectId: string): Promise<readonly Entity[]> {
    return this.desk(projectId, (row) => row.archetype === 'EPIC' || row.archetype === 'TICKET');
  }

  /**
   * **The project's work with one entity's root read whole** — {@link list}, then the root whose tree
   * holds `number` replaced by {@link whole}'s read of it: an epic for itself, its features and its
   * tasks; a ticket for itself.
   *
   * <p>For a page addressed by number (the detail page, the refinement room): there is no read by
   * number, so the number is looked up in the listing, and the listing is a summary — so the one
   * entity the page draws a body for, and may write back, is read again whole. The rest of the
   * project stays summary rows: the page draws only their titles and statuses (the parent, the
   * siblings). A number the listing does not hold answers the listing as it is.
   */
  async listWithWhole(projectId: string, number: number | null): Promise<readonly Entity[]> {
    const items = await this.list(projectId);
    const node = number === null ? null : nodeByNumber(flattenEntities(items), number);
    const root = node ? (node.epic ?? node.entity) : null;
    if (!root) {
      return items;
    }
    const read = await this.whole(root);
    return items.map((item) => (item.id === read.id ? read : item));
  }

  /** One root of work read whole, whichever archetype it is — see the class note. */
  whole(item: Entity): Promise<Entity> {
    const ref = workRef(item);
    return item.archetype === 'EPIC' ? this.epic(ref) : this.get(ref);
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

  /** One ticket by qualified id (or id), whole, with its workspaces. */
  async get(ref: string): Promise<TicketEntity> {
    const [ticket, workspaces] = await Promise.all([
      this.projects.workItem(ref),
      this.workspaces(ref),
    ]);
    return ticketEntity(ticketOf(ticket, workspaces));
  }

  /**
   * One epic by qualified id (or id), whole: the epic (`GET /work/{q}`), its workspaces, and its
   * features and their tasks with their bodies (`GET /work/{q}/children`, then the same per feature —
   * the levels in parallel, so the read is three round trips deep however many features it has).
   */
  async epic(ref: string): Promise<EpicEntity> {
    const [epic, workspaces, features] = await Promise.all([
      this.projects.workItem(ref),
      this.workspaces(ref),
      this.features(ref),
    ]);
    return epicEntity(epicOf(epic, workspaces), features);
  }

  /**
   * **One row of any archetype, whole, as the wire answers it** — what a restatement is built from
   * (the reshape panel, qits-1815). A root (an epic, a ticket) is `GET /work/{q}`; a feature or a task
   * is picked out of its parent's `GET /work/{parent}/children`, which carries the children's bodies.
   * Rejects when the parent no longer holds the row: a restatement must never be built from less.
   *
   * @param row the row's id and qualified id, and its archetype
   * @param parentRef the parent's qualified id (or id) for a feature or a task; null for a root
   */
  async wholeRow(
    row: { readonly id: string; readonly qualifiedId: string | null },
    parentRef: string | null,
  ): Promise<WorkEntityDto> {
    if (parentRef === null) {
      return this.projects.workItem(workRef(row));
    }
    const children = await this.projects.children(parentRef);
    const found = children.find((child) => child.id === row.id);
    if (!found) {
      throw new Error(`${workRef(row)} is no longer under ${parentRef}.`);
    }
    return found;
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
   *
   * <p><b>A drop carries its `resolution`</b> (qits-248) — the outcome, and the item it names where
   * the outcome needs one; see {@link ProjectsApi.setStatus}. Every other move passes none.
   */
  transition(
    ref: string,
    target: EntityStatus,
    resolution: DropResolution = {},
  ): Promise<WorkEntityDto> {
    return this.projects.setStatus(ref, target, resolution);
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
   * The history of an entity, newest first — `GET /work/{q}/audit`. A root (an epic, a ticket)
   * answers its whole subtree; a feature or a task its own rows. It answers after the rows are
   * gone, which is the point of an audit log.
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

  /**
   * The desk, from the listing alone: the roots `wanted` keeps, in the listing's order, each built
   * from its own summary row — an epic with the rows under it, a ticket and an epic with their
   * workspaces from the one project-wide read. See the class note.
   *
   * <p>A failure of the workspaces read costs the workspace links and not the desk: a link is the
   * least of what a card draws, and a desk that cannot be drawn at all for want of one is the failure
   * this read exists to remove.
   */
  private async desk(
    projectId: string,
    wanted: (row: WorkEntityDto) => boolean,
  ): Promise<readonly Entity[]> {
    const [rows, workspaces] = await Promise.all([
      this.projects.work(projectId),
      this.projects.workWorkspaces(projectId).catch(() => NO_WORKSPACES),
    ]);
    const roots = rows.filter((row) => row.parent === null && wanted(row));
    const under = childrenByParent(rows);
    const items: Entity[] = [];
    for (const row of roots) {
      const own = workspaces.get(row.id) ?? [];
      switch (row.archetype) {
        case 'EPIC':
          items.push(epicEntity(epicOf(row, own), featuresOf(row.id, under)));
          break;
        case 'TICKET':
          items.push(ticketEntity(ticketOf(row, own)));
          break;
      }
    }
    return items;
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

const NO_WORKSPACES: ReadonlyMap<string, readonly WorkspaceReferenceDto[]> = new Map();

/** The listing's rows by their parent's id, each list in the listing's (the tree's) order. */
function childrenByParent(
  rows: readonly WorkEntityDto[],
): ReadonlyMap<string, readonly WorkEntityDto[]> {
  const under = new Map<string, WorkEntityDto[]>();
  for (const row of rows) {
    if (row.parent !== null) {
      const siblings = under.get(row.parent) ?? [];
      siblings.push(row);
      under.set(row.parent, siblings);
    }
  }
  return under;
}

/** An epic's features and their tasks, out of the listing's own rows — summaries, without bodies. */
function featuresOf(
  epicId: string,
  under: ReadonlyMap<string, readonly WorkEntityDto[]>,
): readonly FeatureNode[] {
  return (under.get(epicId) ?? [])
    .filter((row) => row.archetype === 'FEATURE')
    .map((feature) => ({
      feature: featureOf(feature),
      tasks: (under.get(feature.id) ?? []).filter((row) => row.archetype === 'TASK').map(taskOf),
    }));
}
