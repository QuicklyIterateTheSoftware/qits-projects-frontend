import { HttpErrorResponse } from '@angular/common/http';
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
import { QitsAppLinks, QitsBadge, QitsButton } from '@qits/ui-components';
import { ArchetypesApi, type ArchetypeRegistry } from '../api/archetypes-api';
import { CampaignsApi } from '../api/campaigns-api';
import { DossierApi, epicDossier, ticketDossier, type DossierOwner } from '../api/dossier-api';
import type {
  AuditEntryDto,
  DispatchMode,
  EntityDispatchDto,
  EntityDispatchStateDto,
  TicketType,
} from '../api/dto';
import { EntitiesApi } from '../api/entities-api';
import { ProjectEvents } from '../api/project-events';
import { ProjectsApi } from '../api/projects-api';
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import { ProjectParam } from '../nav/project-param';
import { DossierPanel } from '../refining/dossier/dossier-panel';
import { Async } from '../ui/async';
import { NONE, relativeSince } from '../ui/format';
import {
  LOADING,
  describeError,
  failed,
  ready,
  serverMessage,
  statusOf,
  type Loadable,
} from '../ui/loadable';
import { MarkdownView } from '../ui/markdown-view';
import { CampaignMembers, type CampaignCandidate } from './campaign-members';
import { CampaignProgress } from './campaign-progress';
import {
  BLOCKED_BADGE,
  IMPETUS_RULE,
  featureStatus,
  isFinalStatus,
  lifecycleMoves,
  statusBadge,
  lifecycleOf,
  statusLabel,
  statusesOf,
  taskStatus,
  ticketTypeBadge,
  type LifecycleMove,
} from './entities-model';
import {
  ARCHETYPE_PARAM,
  archetypeFilterParam,
  archetypeLabel,
  childrenOf,
  entityAddress,
  entityRoute,
  flattenEntities,
  nodeById,
  nodeByNumber,
  parseEntityNumber,
  refinementRoute,
  ticketOf,
  workRoute,
  type EntityNode,
} from './entity-nodes';
import { EntityTransitionPanel } from './entity-transition-panel';
import { restatement, subjectsOf } from './entity-transition-model';
import { EntityThread } from './entity-thread';
import { WorkspaceLinks, workspaceAddress } from './workspace-links';

/** The two kinds, in the order the edit form offers them — the same order the create form uses. */
const TYPES: readonly { readonly value: TicketType; readonly label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
];

/**
 * `MAINTENANCE` appended, offered only on a ticket that already carries it — the opt-out from the
 * platform's own auto-close, never a third choice a person picks from a blank form. A ticket that
 * is retyped away from it and saved has no way back to it here, which is the point: the type is a
 * person's own from then on.
 */
const TYPES_WITH_MAINTENANCE: readonly { readonly value: TicketType; readonly label: string }[] = [
  ...TYPES,
  { value: 'MAINTENANCE', label: 'Maintenance' },
];

/** What the page reads to draw anything: the project's nodes and the served model. */
interface Ground {
  readonly nodes: readonly EntityNode[];
  readonly registry: ArchetypeRegistry;
  /** Repository id to its name, for a task's repository. Empty when the read failed. */
  readonly repositories: ReadonlyMap<string, string>;
}

/** One line of an epic's tree: a feature, or a task under it. */
interface TreeRow {
  readonly node: EntityNode;
  readonly depth: 0 | 1;
  readonly implemented: boolean;
  readonly repository: string | null;
}

/**
 * **One node's page** — `/<project>/work/<qualified id>`, for every archetype (qits-397).
 *
 * <p>It replaces the ticket page, and it is the first page an epic, a feature or a task has had: an
 * epic used to be read on its card and entered only through its refining room, and features and
 * tasks were rows inside a card. The page is **a frame plus an archetype-shaped body**.
 *
 * <p><b>The frame</b> is the same for every node: the title, the qualified number, the archetype and
 * the status; the parent and the children; the three actions; the edits and moves; and the history.
 *
 * <ul>
 *   <li><b>Dispatch</b> (`FLOW`) and <b>Run the next phase</b> (`PHASE`) go to the one dispatching
 *       door, `POST /entities/{id}/dispatch`. Whether they are enabled, and which phase they would
 *       start, is `GET /entities/{id}/dispatch`'s answer — `dispatchable` and `nextPhase` — so this
 *       page never maps a status to a phase itself.</li>
 *   <li><b>Refine</b> opens the entity's refinement room through `POST /entities/{id}/refinement`
 *       and goes there. It is enabled where the dispatch state's next phase is `refine` — refinement
 *       *is* that phase — and an existing room is always offered as "Open refinement", whatever the
 *       status, because the service answers an existing room whatever the state.</li>
 *   <li>The three are absent for an archetype with no lifecycle (the registry's `legalStatuses` is
 *       empty: a feature, a task), which is also where the service would refuse them.</li>
 * </ul>
 *
 * <p><b>Which status moves are offered is the served registry's `transitions`</b>, labelled by kind
 * (forward "Mark <word>", back "Back to <word>", "Drop", "Reopen") — the client keeps no table of
 * them. A status with no moves (`DONE`) is final and says so instead; a registry that serves no
 * `transitions` draws no moves at all rather than guessing.
 *
 * <p><b>Status moves use the archetype's lifecycle door</b> — `POST /tickets/{id}/transition`,
 * `POST /epics/{id}/transition` — and not the multi-entity transition. The lifecycle door is what runs
 * the step (adjacency, the implemented stamping at IMPLEMENTED, discarding the room a resolving move
 * ends) and then the phase advance; the multi-entity door restates a row's shape and runs none of it.
 * **Field edits and reshapes** — title, description, impetus, type, assignee; promote, demote,
 * reparent — **go through `POST /entities/transition`**, a restatement of the whole row, which is
 * what replaced the retired `PUT /epics/{id}` and `PUT /tickets/{id}`.
 *
 * <p><b>A campaign</b> (qits-419, qits-420) is a root with a lifecycle and a body of its own: how
 * it is running ({@link CampaignProgress}), and its members, their order and their conditions
 * ({@link CampaignMembers}). Its status moves go through its own
 * door (`POST /campaigns/{id}/transition` — the multi-entity door refuses a campaign); its one
 * dispatching press is <b>Start campaign</b> (or <b>Re-check members</b> once started), asked twice
 * because it authorises every ungated dispatch in the campaign; and *Run the next phase*, *Refine*,
 * *Edit* and *Reshape* are not offered, because the service would refuse every one of them.
 *
 * <p><b>The number is resolved by reading the project</b>: there is no read by number, so the page
 * reads the collection the desk reads and looks the number up (`entity-nodes.ts`). A feature's page
 * needs its epic and siblings anyway. The page listens to both the `epics` and `tickets` topics and
 * re-reads quietly, never blanking what is on screen for a hint.
 */
@Component({
  selector: 'app-entity-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Async,
    CampaignMembers,
    CampaignProgress,
    DossierPanel,
    EntityThread,
    EntityTransitionPanel,
    MarkdownView,
    QitsBadge,
    QitsButton,
    RouterLink,
    WorkspaceLinks,
  ],
  template: `
    <p class="back">
      <a [routerLink]="deskRoute()" [queryParams]="deskQuery()">← Work</a>
    </p>

    @if (behind()) {
      <p class="behind" role="status">Live updates are reconnecting — briefly behind.</p>
    }

    <app-async
      [state]="ground()"
      loadingLabel="Loading the entity"
      errorLabel="Could not load the entity"
      (retry)="load()"
    />

    @if (missing(); as message) {
      <p class="failed" role="alert">{{ message }}</p>
    }

    @if (node(); as n) {
      <div class="title-row">
        <h1>{{ n.title }}</h1>
        <span class="badges">
          @if (n.qualifiedId; as qualified) {
            <span class="qualified">{{ qualified }}</span>
          }
          <qits-badge class="archetype" [label]="archetype()" tone="neutral" />
          @if (ticket(); as row) {
            <qits-badge class="type" [label]="type().label" [tone]="type().tone" />
          }
          @if (n.status !== null) {
            <qits-badge class="status" [label]="badge().label" [tone]="badge().tone" />
          } @else {
            <qits-badge class="marker" [label]="marker().label" [tone]="marker().tone" />
          }
          @if (blockedEntity()) {
            <qits-badge class="blocked" [label]="blocked.label" [tone]="blocked.tone" />
          }
        </span>
      </div>

      @if (ticket()?.impetus; as impetus) {
        <p class="impetus">{{ impetus }}</p>
      }

      <dl class="facts">
        @if (parent(); as above) {
          <dt>Parent</dt>
          <dd class="parent">
            <a [routerLink]="routeOf(above)">{{ label(above) }}</a>
          </dd>
        }
        @if (successor(); as next) {
          <dt>Superseded by</dt>
          <dd class="successor">
            <a [routerLink]="routeOf(next)">{{ label(next) }}</a>
          </dd>
        }
        @if (ticket(); as row) {
          <dt>Assignee</dt>
          <dd class="assignee">{{ row.assignee || none }}</dd>
          <dt>Reported by</dt>
          <dd class="reporter">{{ row.createdBy || none }}</dd>
        }
        @if (n.archetype === 'TASK') {
          <dt>Repository</dt>
          <dd class="repository">{{ repositoryName(n.repositoryId) }}</dd>
        }
        @if (dependsOn(); as first) {
          <dt>Depends on</dt>
          <dd class="depends-on">
            <a [routerLink]="routeOf(first)">{{ label(first) }}</a>
          </dd>
        }
        @if (n.createdAt) {
          <dt>Opened</dt>
          <dd class="opened">{{ age(n.createdAt) }}</dd>
        }
        @if (n.updatedAt) {
          <dt>Updated</dt>
          <dd class="updated">{{ age(n.updatedAt) }}</dd>
        }
      </dl>

      @if (lifecycle() && n.archetype === 'CAMPAIGN') {
        <section class="flow start" aria-label="Start">
          <div class="actions">
            <qits-button
              class="dispatch start-campaign"
              variant="primary"
              [disabled]="!dispatchable() || action() !== null"
              [busy]="action() === 'dispatch:FLOW'"
              (pressed)="start()"
            >
              {{ confirming() === 'start' ? 'Confirm ' + startLabel().toLowerCase() + '?' : startLabel() }}
            </qits-button>
            @if (confirming() === 'start') {
              <qits-button variant="ghost" size="sm" (pressed)="confirming.set(null)">
                Cancel
              </qits-button>
            }
            <span class="note flow-note">{{ flowNote() }}</span>
          </div>
          @if (confirming() === 'start') {
            <p class="start-caption" role="status">{{ startCaption }}</p>
          }
        </section>
      } @else if (lifecycle()) {
        <section class="flow" aria-label="Agent">
          <div class="actions">
            <qits-button
              class="dispatch"
              variant="primary"
              [disabled]="!dispatchable() || action() !== null"
              [busy]="action() === 'dispatch:FLOW'"
              (pressed)="dispatch('FLOW')"
            >
              Dispatch
            </qits-button>
            <qits-button
              class="next-phase"
              variant="secondary"
              [disabled]="!dispatchable() || action() !== null"
              [busy]="action() === 'dispatch:PHASE'"
              (pressed)="dispatch('PHASE')"
            >
              Run the next phase
            </qits-button>
            <qits-button
              class="refine"
              variant="secondary"
              [disabled]="!refinable() || action() !== null"
              [busy]="action() === 'refine'"
              (pressed)="refine()"
            >
              {{ room() ? 'Open refinement' : 'Refine' }}
            </qits-button>
            <span class="note flow-note">{{ flowNote() }}</span>
          </div>
          @if (dispatched(); as answer) {
            <p class="dispatched">
              @if (dispatchHref(); as href) {
                <a class="workspace" [href]="href">Open workspace</a>
              }
              <span class="note">{{ dispatchNote() }}</span>
            </p>
          }
        </section>
      }

      <div class="actions moves">
        @if (n.archetype !== 'CAMPAIGN') {
          <qits-button variant="secondary" [disabled]="action() !== null" (pressed)="startEditing()">
            Edit
          </qits-button>
        }
        @for (step of moves(); track step.target) {
          <qits-button
            [class]="'move ' + step.kind.toLowerCase()"
            [variant]="step.variant"
            [disabled]="action() !== null"
            [busy]="action() === 'move:' + step.target"
            (pressed)="move(step)"
          >
            {{ step.label }}
          </qits-button>
        }
        @if (final()) {
          <span class="note final-note">{{ finalNote() }}</span>
        }
        @if (supersedable()) {
          <qits-button
            class="supersede"
            variant="ghost"
            [disabled]="action() !== null"
            [busy]="action() === 'supersede'"
            (pressed)="supersede()"
          >
            {{ confirming() === 'supersede' ? 'Confirm supersede?' : 'Supersede' }}
          </qits-button>
        }
        @if (blockable() && !blocking()) {
          <qits-button
            [class]="blockedEntity() ? 'unblock' : 'block'"
            variant="ghost"
            [disabled]="action() !== null"
            (pressed)="startBlocking(blockedEntity() ? 'unblock' : 'block')"
          >
            {{ blockedEntity() ? 'Unblock' : 'Block' }}
          </qits-button>
        }
        @if (n.archetype !== 'CAMPAIGN') {
          <qits-button
            class="reshape"
            variant="ghost"
            [disabled]="action() !== null"
            (pressed)="reshaping.set(true)"
          >
            Reshape
          </qits-button>
        }
        @if (ticket()) {
          <qits-button
            class="delete"
            variant="ghost"
            [disabled]="action() !== null"
            [busy]="action() === 'delete'"
            (pressed)="remove()"
          >
            {{ confirming() === 'delete' ? 'Confirm delete?' : 'Delete' }}
          </qits-button>
        }
      </div>

      @if (editing()) {
        <section class="form" aria-label="Edit">
          <label class="field">
            <span class="label" id="edit-title-label">Title</span>
            <input
              type="text"
              class="text edit-title"
              autocomplete="off"
              aria-labelledby="edit-title-label"
              [value]="draftTitle()"
              (input)="draftTitle.set(value($event))"
            />
          </label>
          @if (ticket()) {
            <label class="field">
              <span class="label" id="edit-impetus-label">Impetus</span>
              <textarea
                class="text area edit-impetus"
                rows="3"
                aria-labelledby="edit-impetus-label"
                [value]="draftImpetus()"
                (input)="draftImpetus.set(value($event))"
              ></textarea>
            </label>
            <p class="hint">{{ impetusRule }}</p>
            <label class="field">
              <span class="label" id="edit-type-label">Type</span>
              <select
                class="text edit-type"
                aria-labelledby="edit-type-label"
                (change)="draftType.set(typeOf($event))"
              >
                @for (option of types(); track option.value) {
                  <option [value]="option.value" [selected]="option.value === draftType()">
                    {{ option.label }}
                  </option>
                }
              </select>
            </label>
          }
          <label class="field">
            <span class="label" id="edit-description-label">Description</span>
            <textarea
              class="text area edit-description"
              rows="6"
              aria-labelledby="edit-description-label"
              [value]="draftDescription()"
              (input)="draftDescription.set(value($event))"
            ></textarea>
          </label>
          @if (ticket()) {
            <label class="field">
              <span class="label" id="edit-assignee-label">Assignee</span>
              <input
                type="text"
                class="text edit-assignee"
                autocomplete="off"
                aria-labelledby="edit-assignee-label"
                [value]="draftAssignee()"
                (input)="draftAssignee.set(value($event))"
              />
            </label>
          }
          <p class="hint">An empty box clears the field rather than leaving it as it was.</p>
          <div class="actions">
            <qits-button
              class="save"
              variant="primary"
              [disabled]="!savable()"
              [busy]="action() === 'save'"
              (pressed)="save()"
            >
              Save
            </qits-button>
            <qits-button
              variant="ghost"
              [disabled]="action() !== null"
              (pressed)="editing.set(false)"
            >
              Cancel
            </qits-button>
          </div>
        </section>
      }

      @if (blocking(); as mode) {
        <section class="form" [attr.aria-label]="mode === 'block' ? 'Block' : 'Unblock'">
          <label class="field">
            <span class="label" id="block-note-label">{{
              mode === 'block' ? 'Why is it blocked?' : 'Anything to note?'
            }}</span>
            <textarea
              class="text area block-note"
              rows="3"
              aria-labelledby="block-note-label"
              [value]="blockNote()"
              (input)="blockNote.set(value($event))"
            ></textarea>
          </label>
          <div class="actions">
            <qits-button
              class="send-block"
              variant="primary"
              [disabled]="!blockSendable()"
              [busy]="action() === 'blocked'"
              (pressed)="setBlocked()"
            >
              {{ mode === 'block' ? 'Block' : 'Unblock' }}
            </qits-button>
            <qits-button
              variant="ghost"
              [disabled]="action() !== null"
              (pressed)="blocking.set(null)"
            >
              Cancel
            </qits-button>
          </div>
        </section>
      }

      @if (reshaping()) {
        <app-entity-transition-panel
          [projectId]="projectId()"
          [entityId]="n.id"
          (done)="reshaped()"
          (cancelled)="reshaping.set(false)"
        />
      }

      @if (actionFailure(); as message) {
        <p class="failed" role="alert">{{ message }}</p>
      }

      <section class="body" [attr.data-archetype]="n.archetype">
        <h2>{{ ticket() ? 'The work' : 'Description' }}</h2>
        @if (n.archetype === 'CAMPAIGN') {
          <app-campaign-members
            [campaignId]="n.id"
            [projectSlug]="projectSlug()"
            [entities]="campaignCandidates()"
            [repositories]="repositoryList()"
            [revision]="revision()"
          />
          <app-campaign-progress
            [campaignId]="n.id"
            [projectSlug]="projectSlug()"
            [revision]="revision()"
          />
        } @else if (n.description; as text) {
          <app-markdown class="description" [text]="text" />
        } @else {
          <p class="absent">
            {{
              ticket()
                ? 'Not refined yet — nobody has written what to do about this.'
                : 'No description yet.'
            }}
          </p>
        }

        @if (n.archetype === 'EPIC') {
          <section class="tree" aria-label="Features and tasks">
            <h2>Features and tasks</h2>
            @if (tree().length === 0) {
              <p class="absent">No features yet.</p>
            } @else {
              <ul class="rows">
                @for (row of tree(); track row.node.id) {
                  <li
                    class="row"
                    [class.indent]="row.depth === 1"
                    [attr.data-archetype]="row.node.archetype"
                  >
                    <a class="qualified" [routerLink]="routeOf(row.node)">{{
                      address(row.node)
                    }}</a>
                    <a class="child-title" [routerLink]="routeOf(row.node)">{{ row.node.title }}</a>
                    <qits-badge
                      class="implemented-marker"
                      [label]="row.implemented ? 'implemented' : 'open'"
                      [tone]="row.implemented ? 'success' : 'neutral'"
                    />
                    @if (row.repository; as repository) {
                      <span class="repo">{{ repository }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        }

        @if (n.archetype === 'FEATURE') {
          <section class="tree" aria-label="Tasks">
            <h2>Tasks</h2>
            @if (children().length === 0) {
              <p class="absent">No tasks yet.</p>
            } @else {
              <ul class="rows">
                @for (child of children(); track child.id) {
                  <li class="row" data-archetype="TASK">
                    <a class="qualified" [routerLink]="routeOf(child)">{{ address(child) }}</a>
                    <a class="child-title" [routerLink]="routeOf(child)">{{ child.title }}</a>
                    <qits-badge
                      class="implemented-marker"
                      [label]="child.implementedAt ? 'implemented' : 'open'"
                      [tone]="child.implementedAt ? 'success' : 'neutral'"
                    />
                    <span class="repo">{{ repositoryName(child.repositoryId) }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        }

        @if (n.entity?.workspaces?.length) {
          <section class="workspaces-section" aria-label="Workspaces">
            <h2>Workspaces</h2>
            <div class="workspaces">
              <app-workspace-links [workspaces]="n.entity?.workspaces ?? []" />
            </div>
          </section>
        }

        @if (dossierOwner(); as owner) {
          @if (hasDossier()) {
            <section class="dossier-section" aria-label="Dossier">
              <h2>Dossier</h2>
              <app-dossier-panel
                [projectId]="projectId()"
                [owner]="owner"
                [visible]="true"
                [editable]="n.archetype === 'TICKET'"
                [pageSlug]="dossierPageSlug()"
                (pageChosen)="dossierPageChosen($event)"
              />
            </section>
          }
        }

        <app-entity-thread [entityId]="n.id" [archetype]="n.archetype" />
      </section>

      <details class="history">
        <summary>History</summary>
        <app-async
          [state]="audit()"
          loadingLabel="Loading the history"
          errorLabel="Could not load the history"
          (retry)="readAudit()"
        />
        @if (history().length === 0 && audit().kind === 'ready') {
          <p class="absent">Nothing recorded.</p>
        }
        <ol class="audit">
          @for (entry of history(); track entry.id) {
            <li class="audit-entry">
              <span class="operation">{{ entry.operation.toLowerCase() }}</span>
              <span class="entity-type">{{ entry.entityType.toLowerCase() }}</span>
              <span class="by">{{ entry.changedBy || none }}</span>
              <span class="when">{{ age(entry.changedAt) }}</span>
            </li>
          }
        </ol>
      </details>
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
    h2 {
      margin: 1rem 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85rem;
      color: #6b7280;
      user-select: all;
    }
    .badges {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
    }
    .impetus {
      margin: 0 0 0.9rem;
      font-size: 1rem;
      line-height: 1.5;
      color: #111827;
      overflow-wrap: anywhere;
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
    .flow {
      margin: 0 0 0.75rem;
      padding: 0.6rem 0.8rem;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .moves {
      margin: 0 0 1rem;
    }
    .note {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .start-caption {
      margin: 0.5rem 0 0;
      color: #92400e;
      font-size: 0.85rem;
    }
    .dispatched {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      margin: 0.5rem 0 0;
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
    .hint {
      margin: -0.4rem 0 0.7rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .failed {
      margin: 0.6rem 0;
      color: #b91c1c;
    }
    .description {
      color: #374151;
    }
    .absent {
      margin: 0 0 1rem;
      color: #6b7280;
      font-style: italic;
    }
    .rows {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.85rem;
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.3rem 0;
      border-top: 1px solid #f3f4f6;
    }
    .row.indent {
      padding-left: 1.25rem;
    }
    .child-title {
      color: #1d4ed8;
      overflow-wrap: anywhere;
    }
    .repo {
      margin-left: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #6b7280;
    }
    .workspaces {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .dossier-section {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
    }
    .history {
      margin-top: 1.75rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
      font-size: 0.85rem;
    }
    .history summary {
      cursor: pointer;
      font-weight: 600;
      color: #6b7280;
    }
    .audit {
      margin: 0.5rem 0 0;
      padding: 0;
      list-style: none;
    }
    .audit-entry {
      display: flex;
      gap: 0.5rem;
      padding: 0.2rem 0;
      color: #374151;
    }
    .audit-entry .when {
      margin-left: auto;
      color: #6b7280;
    }
  `,
})
export class EntityDetailPage {
  private readonly api = inject(EntitiesApi);
  private readonly projects = inject(ProjectsApi);
  private readonly refinements = inject(RefinementsApi);
  private readonly campaigns = inject(CampaignsApi);
  private readonly archetypes = inject(ArchetypesApi);
  private readonly dossier = inject(DossierApi);
  private readonly events = inject(ProjectEvents);
  private readonly param = inject(ProjectParam);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly appLinks = inject(QitsAppLinks);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  /** The address's own segment — `qits-1337`, or the bare `1337`. */
  protected readonly segment = computed(() => this.params().get('number') ?? '');
  protected readonly number = computed(() => parseEntityNumber(this.segment()));

  protected readonly none = NONE;
  protected readonly impetusRule = IMPETUS_RULE;
  protected readonly blocked = BLOCKED_BADGE;

  protected readonly ground = signal<Loadable<Ground>>(LOADING);
  protected readonly state = signal<EntityDispatchStateDto | null>(null);
  protected readonly room = signal<RefinementDto | null>(null);
  protected readonly audit = signal<Loadable<readonly AuditEntryDto[]>>(LOADING);
  protected readonly dispatched = signal<EntityDispatchDto | null>(null);
  private readonly dossierPages = signal<readonly string[]>([]);

  /** Which write is in flight: `dispatch:<mode>`, `refine`, `move:<target>`, `save`, … */
  protected readonly action = signal<string | null>(null);
  protected readonly actionFailure = signal<string | null>(null);
  /** Which destructive (or authorising) press is waiting for its second press. */
  protected readonly confirming = signal<'supersede' | 'delete' | 'start' | null>(null);

  /** What the start press authorises, said on its confirm step (qits-419). */
  protected readonly startCaption =
    'Start — this authorises every dispatch in this campaign that no approval gates';

  /** Bumped after this page's own presses, so a campaign's own reads re-read. */
  protected readonly revision = signal(0);

  protected readonly editing = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftImpetus = signal('');
  protected readonly draftType = signal<TicketType>('BUG');
  protected readonly draftDescription = signal('');
  protected readonly draftAssignee = signal('');

  protected readonly blocking = signal<'block' | 'unblock' | null>(null);
  protected readonly blockNote = signal('');
  protected readonly reshaping = signal(false);

  private readonly loaded = computed<Ground | null>(() => {
    const state = this.ground();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly node = computed<EntityNode | null>(() => {
    const ground = this.loaded();
    const number = this.number();
    return ground && number !== null ? nodeByNumber(ground.nodes, number) : null;
  });

  /** The not-found sentence, once the collection has answered without the number in it. */
  protected readonly missing = computed(() => {
    if (!this.loaded() || this.node()) {
      return null;
    }
    return this.number() === null
      ? `“${this.segment()}” is not an entity number.`
      : `This project has no entity numbered ${this.number()}.`;
  });

  protected readonly ticket = computed(() => ticketOf(this.node()));

  /**
   * Whether this node is blocked — read off whichever root holds the flag, an epic or a ticket
   * through {@link EntityNode.entity}, a campaign through {@link EntityNode.campaign}. False for a
   * feature or a task, which carry neither.
   */
  protected readonly blockedEntity = computed(
    () => this.node()?.entity?.blocked ?? this.node()?.campaign?.blocked ?? false,
  );

  protected readonly archetype = computed(() => archetypeLabel(this.node()?.archetype ?? ''));
  protected readonly badge = computed(() => statusBadge(this.node()?.status ?? null));
  protected readonly type = computed(() => ticketTypeBadge(this.ticket()?.type ?? 'BUG'));

  /**
   * `MAINTENANCE` joins the edit form's options only on a ticket that already carries it. Every
   * other ticket sees the same two a person has always had, so retyping into `MAINTENANCE` by hand
   * stays impossible — it is a state the platform files, not one a form offers.
   */
  protected readonly types = computed(() =>
    this.ticket()?.type === 'MAINTENANCE' ? TYPES_WITH_MAINTENANCE : TYPES,
  );

  /** A feature's or a task's implemented marker — what stands where a status would. */
  protected readonly marker = computed(() => {
    const node = this.node();
    if (node?.task) {
      return taskStatus(node.task);
    }
    return featureStatus({ implementedOn: node?.feature?.implementedOn ?? null });
  });

  /** The words this node's archetype may hold — empty for an archetype with no lifecycle. */
  private readonly vocabulary = computed<readonly string[]>(() => {
    const ground = this.loaded();
    const node = this.node();
    return ground && node ? statusesOf(ground.registry, node.archetype) : [];
  });

  /** Whether this node has a lifecycle — and so the three actions. The registry says, not a list. */
  protected readonly lifecycle = computed(() => this.vocabulary().length > 0);

  protected readonly moves = computed<readonly LifecycleMove[]>(() => {
    const node = this.node();
    return node ? lifecycleMoves(this.loaded()?.registry ?? null, node.archetype, node.status) : [];
  });

  /** Whether the node holds a final status — served, with no move out of it (`DONE`). */
  protected readonly final = computed(() => {
    const node = this.node();
    return node ? isFinalStatus(this.loaded()?.registry ?? null, node.archetype, node.status) : false;
  });

  protected readonly finalNote = computed(() => {
    const node = this.node();
    const word = node?.status ? statusLabel(node.status) : '';
    return `${word.charAt(0).toUpperCase()}${word.slice(1)} — final. Follow-up work is a new ticket or epic.`;
  });

  protected readonly dispatchable = computed(() => this.state()?.dispatchable === true);

  /**
   * Refine is offered where refining is the phase that runs — the dispatch state's `nextPhase` — or
   * wherever a room already stands, since the service always answers an existing one.
   */
  protected readonly refinable = computed(
    () => this.room() !== null || this.state()?.nextPhase === 'refine',
  );

  /** The start press's word: *Start campaign*, or *Re-check members* once a start is live. */
  protected readonly startLabel = computed(() =>
    this.state()?.nextPhase === 'recheck' ? 'Re-check members' : 'Start campaign',
  );

  protected readonly flowNote = computed(() => {
    const state = this.state();
    if (!state) {
      return '';
    }
    if (this.node()?.archetype === 'CAMPAIGN') {
      if (state.dispatchable) {
        return state.nextPhase === 'recheck'
          ? 'Running — a press re-checks every waiting member now.'
          : 'A press starts the campaign.';
      }
      return state.status
        ? `Nothing to start at ${statusLabel(state.status)} — a campaign starts from refined.`
        : 'Nothing to start.';
    }
    if (state.dispatchable && state.nextPhase) {
      return `A press starts the ${state.nextPhase} phase.`;
    }
    if (state.blocked) {
      return 'Blocked — unblock it before dispatching.';
    }
    return state.status
      ? `Nothing to dispatch at ${statusLabel(state.status)}.`
      : 'Nothing to dispatch.';
  });

  protected readonly dispatchHref = computed(() => {
    const answer = this.dispatched();
    return answer
      ? workspaceAddress(this.appLinks, answer.repositoryId, answer.workspaceRowId)
      : undefined;
  });

  protected readonly dispatchNote = computed(() => {
    const answer = this.dispatched();
    if (!answer) {
      return '';
    }
    const stop = answer.mode === 'PHASE' ? ', stopping after it' : '';
    return answer.agentLaunch === 'SKIPPED_RUNNING'
      ? `an agent is already working on ${answer.branch}`
      : `an agent is starting the ${answer.phase} phase on ${answer.branch}${stop}`;
  });

  /**
   * Supersede is an operation on an epic's plan: it lands the epic dropped, so it is offered where a
   * drop is a served move, and past the first word of the walk (a draft has no frozen scope).
   */
  protected readonly supersedable = computed(() => {
    const node = this.node();
    const ground = this.loaded();
    if (node?.archetype !== 'EPIC' || !node.status || !ground) {
      return false;
    }
    const walk = lifecycleOf(ground.registry, node.archetype);
    return node.status !== walk[0] && this.moves().some((step) => step.kind === 'DROP');
  });

  /** Block is offered where a phase runs behind the status — the dispatch state's `nextPhase`. */
  /**
   * Block is offered on every lifecycle archetype — an epic, a ticket or a campaign, read off
   * whichever root the node holds — and only where a phase runs behind the status, the dispatch
   * state's `nextPhase`. A feature or a task holds neither {@link EntityNode.entity} nor
   * {@link EntityNode.campaign}, so it never qualifies.
   */
  protected readonly blockable = computed(() => {
    const node = this.node();
    return (
      node !== null &&
      (node.entity !== null || node.campaign !== null) &&
      (this.state()?.nextPhase ?? null) !== null
    );
  });

  protected readonly blockSendable = computed(
    () =>
      this.action() === null && (this.blocking() !== 'block' || this.blockNote().trim().length > 0),
  );

  protected readonly savable = computed(
    () =>
      this.draftTitle().trim().length > 0 &&
      (!this.ticket() || this.draftImpetus().trim().length > 0) &&
      this.action() === null,
  );

  protected readonly parent = computed(() => {
    const ground = this.loaded();
    return ground ? nodeById(ground.nodes, this.node()?.parentId ?? null) : null;
  });

  protected readonly successor = computed(() => {
    const ground = this.loaded();
    const epic = this.node()?.entity;
    const id = epic?.archetype === 'EPIC' ? epic.supersededByEpicId : null;
    return ground ? nodeById(ground.nodes, id) : null;
  });

  protected readonly dependsOn = computed(() => {
    const ground = this.loaded();
    return ground ? nodeById(ground.nodes, this.node()?.dependsOn ?? null) : null;
  });

  protected readonly children = computed<readonly EntityNode[]>(() => {
    const ground = this.loaded();
    const node = this.node();
    return ground && node ? childrenOf(ground.nodes, node.id) : [];
  });

  /** An epic's features with their tasks under them, each with its implemented marker. */
  protected readonly tree = computed<readonly TreeRow[]>(() => {
    const ground = this.loaded();
    const node = this.node();
    if (!ground || node?.archetype !== 'EPIC') {
      return [];
    }
    const rows: TreeRow[] = [];
    for (const feature of childrenOf(ground.nodes, node.id)) {
      rows.push({
        node: feature,
        depth: 0,
        implemented: feature.implementedAt !== null,
        repository: null,
      });
      for (const task of childrenOf(ground.nodes, feature.id)) {
        rows.push({
          node: task,
          depth: 1,
          implemented: task.implementedAt !== null,
          repository: this.repositoryName(task.repositoryId),
        });
      }
    }
    return rows;
  });

  /** The dossier this node owns: an epic's or a ticket's; a feature or a task has none. */
  protected readonly dossierOwner = computed<DossierOwner | null>(() => {
    const node = this.node();
    if (node?.archetype === 'EPIC') {
      return epicDossier(node.id);
    }
    return node?.archetype === 'TICKET' ? ticketDossier(node.id) : null;
  });

  protected readonly hasDossier = computed(() => this.dossierPages().length > 0);

  /** The project's epics and tickets, as a campaign's add-member picker offers them. */
  protected readonly campaignCandidates = computed<readonly CampaignCandidate[]>(() =>
    (this.loaded()?.nodes ?? [])
      .filter((node) => node.archetype === 'EPIC' || node.archetype === 'TICKET')
      .map((node) => ({
        id: node.id,
        archetype: node.archetype,
        qualifiedId: node.qualifiedId,
        title: node.title,
      })),
  );

  /** The project's repositories by name, for a campaign's *repository releases* criterion. */
  protected readonly repositoryList = computed<readonly string[]>(() =>
    [...(this.loaded()?.repositories.values() ?? [])].sort(),
  );
  protected readonly dossierPageSlug = computed(() => this.query().get('page'));

  /**
   * This node's own history. The audit subtree is keyed by the root (a ticket's id, an epic's id for
   * its whole tree), so a feature's and a task's rows are picked out of their epic's by `entityId`.
   */
  protected readonly history = computed<readonly AuditEntryDto[]>(() => {
    const state = this.audit();
    const node = this.node();
    if (state.kind !== 'ready' || !node) {
      return [];
    }
    return node.entity ? state.value : state.value.filter((entry) => entry.entityId === node.id);
  });

  protected readonly deskRoute = computed(() => workRoute(this.projectSlug()));

  /** Back to the desk filtered to this node's root archetype — where the reader came from. */
  protected readonly deskQuery = computed(() => {
    const node = this.node();
    const root =
      node?.entity?.archetype ?? (node?.epic ? 'EPIC' : node?.campaign ? 'CAMPAIGN' : null);
    return root ? { [ARCHETYPE_PARAM]: archetypeFilterParam(root) } : {};
  });

  private readonly wasLive = signal(false);
  protected readonly behind = computed(() => this.wasLive() && !this.events.connected());

  private watching: string | null = null;
  private hinted = 0;
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const segment = this.segment();
      const hints = this.events.invalidations('epics')() + this.events.invalidations('tickets')();
      if (!projectId || !segment) {
        return;
      }
      const key = `${projectId}/${segment}`;
      const quiet = key === this.watching && hints !== this.hinted;
      if (key !== this.watching) {
        this.dispatched.set(null);
        this.editing.set(false);
        this.reshaping.set(false);
        this.blocking.set(null);
        this.actionFailure.set(null);
      }
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

  // ---- reads ------------------------------------------------------------------------------------

  /**
   * Read the project and resolve the number, then what the frame needs about that node. Loud on
   * arrival and a hop; quiet on a hint and after this page's own writes.
   */
  async load(quiet = false): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) {
      return;
    }
    if (!quiet) {
      this.ground.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const [entities, registry, repositories] = await Promise.all([
        this.api.list(projectId),
        this.archetypes.registry(),
        this.repositoryNames(projectId),
      ]);
      if (attempt !== this.attempt) {
        return;
      }
      this.ground.set(ready({ nodes: flattenEntities(entities), registry, repositories }));
    } catch (error) {
      if (attempt === this.attempt && !(quiet && this.loaded())) {
        this.ground.set(failed(error));
      }
      return;
    }
    const node = this.node();
    if (!node) {
      return;
    }
    await Promise.all([
      this.readFlow(node, attempt),
      this.readAudit(quiet),
      this.readDossier(attempt),
    ]);
  }

  /** The dispatch state and the room, for a node with a lifecycle. Neither failing hides the page. */
  private async readFlow(node: EntityNode, attempt: number): Promise<void> {
    if (!this.lifecycle()) {
      this.state.set(null);
      this.room.set(null);
      return;
    }
    // A campaign has no refinement room — its members are refined, not it.
    const [state, room] = await Promise.all([
      this.api.dispatchState(node.id).catch(() => null),
      node.archetype === 'CAMPAIGN'
        ? Promise.resolve(null)
        : this.refinements.findFor(node.id).catch(() => null),
    ]);
    if (attempt === this.attempt) {
      this.state.set(state);
      this.room.set(room);
    }
  }

  async readAudit(quiet = false): Promise<void> {
    const node = this.node();
    // A campaign's writes are audited under its own id, the way an epic's tree is under the epic's.
    const key = node?.entity?.id ?? node?.epic?.id ?? node?.campaign?.id ?? null;
    if (!key) {
      this.audit.set(ready([]));
      return;
    }
    if (!quiet || this.audit().kind !== 'ready') {
      this.audit.set(LOADING);
    }
    try {
      this.audit.set(ready(await this.api.audit(key)));
    } catch (error) {
      if (!(quiet && this.audit().kind === 'ready')) {
        this.audit.set(failed(error));
      }
    }
  }

  private async readDossier(attempt: number): Promise<void> {
    const owner = this.dossierOwner();
    if (!owner) {
      this.dossierPages.set([]);
      return;
    }
    try {
      const pages = await this.dossier.list(owner);
      if (attempt === this.attempt) {
        this.dossierPages.set(pages.map((page) => page.slug));
      }
    } catch {
      if (attempt === this.attempt) {
        this.dossierPages.set([]);
      }
    }
  }

  /** Repository names by id, for a task's line. A failed read leaves the ids on screen. */
  private async repositoryNames(projectId: string): Promise<ReadonlyMap<string, string>> {
    try {
      const components = await this.projects.components(projectId);
      return new Map(components.repositories.map((repository) => [repository.id, repository.name]));
    } catch {
      return new Map();
    }
  }

  // ---- the three actions ------------------------------------------------------------------------

  /** Dispatch (FLOW) or Run the next phase (PHASE), then read the node and its state again. */
  protected async dispatch(mode: DispatchMode): Promise<void> {
    const node = this.node();
    if (!node || this.action()) {
      return;
    }
    await this.run(`dispatch:${mode}`, async () => {
      const answer = await this.api.dispatch(node.id, mode);
      this.dispatched.set('dispatch' in answer ? answer.dispatch : null);
      await this.load(true);
    });
  }

  /**
   * **Start a campaign** — asked twice, because it is a decision: the first press shows what it
   * authorises (every dispatch in the campaign no approval gates), the second sends it. It is the
   * dispatching press (`FLOW`) on the campaign, which answers `{progress}`; the campaign's own reads
   * re-read. Once a start is live the same press re-checks the waiting members. A 403 (a non-admin
   * session) shows the service's sentence the way the dispatch press does.
   */
  protected async start(): Promise<void> {
    const node = this.node();
    if (!node || this.action() || !this.dispatchable()) {
      return;
    }
    if (this.confirming() !== 'start') {
      this.confirming.set('start');
      this.actionFailure.set(null);
      return;
    }
    this.confirming.set(null);
    await this.run('dispatch:FLOW', async () => {
      await this.api.dispatch(node.id, 'FLOW');
      this.revision.update((count) => count + 1);
      await this.load(true);
    });
  }

  /** Open the node's refinement room — finding the one there is, or making one — and go there. */
  protected async refine(): Promise<void> {
    const node = this.node();
    if (!node || this.action()) {
      return;
    }
    await this.run('refine', async () => {
      if (!this.room()) {
        this.room.set(await this.refinements.openFor(node.id));
      }
      await this.router.navigate(refinementRoute(this.projectSlug(), node) as string[]);
    });
  }

  // ---- moves and edits --------------------------------------------------------------------------

  /** One lifecycle step, through the archetype's lifecycle door — see the class note. */
  protected async move(step: LifecycleMove): Promise<void> {
    const node = this.node();
    if (!node || this.action()) {
      return;
    }
    this.blocking.set(null);
    await this.run(`move:${step.target}`, async () => {
      if (node.archetype === 'TICKET') {
        await this.api.transition(node.id, step.target);
      } else if (node.archetype === 'CAMPAIGN') {
        // The campaign's own door is the only one that moves its status (qits-413).
        await this.campaigns.transition(node.id, step.target);
        this.revision.update((count) => count + 1);
      } else {
        await this.projects.transitionEpic(node.id, step.target);
      }
      await this.load(true);
    });
  }

  /** Supersede the epic — asked twice — and go to the successor draft it answers. */
  protected async supersede(): Promise<void> {
    const node = this.node();
    if (!node || this.action()) {
      return;
    }
    if (this.confirming() !== 'supersede') {
      this.confirming.set('supersede');
      return;
    }
    this.confirming.set(null);
    await this.run('supersede', async () => {
      const answer = await this.projects.transitionEpic(node.id, 'SUPERSEDED');
      await this.load(true);
      if (answer.successor) {
        await this.router.navigate(entityRoute(this.projectSlug(), answer.successor) as string[]);
      }
    });
  }

  protected startEditing(): void {
    const node = this.node();
    if (!node) {
      return;
    }
    const ticket = this.ticket();
    this.draftTitle.set(node.title);
    this.draftDescription.set(node.description ?? '');
    this.draftImpetus.set(ticket?.impetus ?? '');
    this.draftType.set(ticket?.type ?? 'BUG');
    this.draftAssignee.set(ticket?.assignee ?? '');
    this.actionFailure.set(null);
    this.blocking.set(null);
    this.editing.set(true);
  }

  /**
   * Save the edit as a restatement of the row on `POST /entities/transition` — the door that replaced
   * the retired PUTs. An emptied box clears its property; see {@link restatement}.
   */
  protected async save(): Promise<void> {
    const node = this.node();
    const ground = this.loaded();
    if (!node || !ground || !this.savable()) {
      return;
    }
    const root = node.entity ?? node.epic;
    const subject = root ? subjectsOf([root]).find((candidate) => candidate.id === node.id) : null;
    if (!subject) {
      return;
    }
    const changes: Record<string, string | null> = {
      TITLE: this.draftTitle().trim(),
      DESCRIPTION: this.draftDescription().trim() || null,
    };
    if (this.ticket()) {
      changes['IMPETUS'] = this.draftImpetus().trim();
      changes['TICKET_TYPE'] = this.draftType();
      changes['ASSIGNEE'] = this.draftAssignee().trim() || null;
    }
    const position = node.parentId
      ? childrenOf(ground.nodes, node.parentId).findIndex((sibling) => sibling.id === node.id)
      : undefined;
    await this.run('save', async () => {
      await this.api.transitionEntities(
        new Map([[node.id, restatement(ground.registry, subject, changes, position)]]),
      );
      this.editing.set(false);
      await this.load(true);
    });
  }

  protected startBlocking(mode: 'block' | 'unblock'): void {
    this.actionFailure.set(null);
    this.editing.set(false);
    this.blockNote.set('');
    this.blocking.set(mode);
  }

  protected async setBlocked(): Promise<void> {
    const node = this.node();
    const mode = this.blocking();
    if (!node || !mode || !this.blockSendable()) {
      return;
    }
    await this.run('blocked', async () => {
      await this.api.setBlocked(node.id, mode === 'block', this.blockNote().trim());
      this.blocking.set(null);
      this.blockNote.set('');
      await this.load(true);
    });
  }

  /** A reshape landed: close the form and read again — the node may be another archetype now. */
  protected reshaped(): void {
    this.reshaping.set(false);
    void this.load(true);
  }

  /** Delete the ticket — asked twice — and go back to the desk. */
  protected async remove(): Promise<void> {
    const node = this.node();
    if (!node || this.action()) {
      return;
    }
    if (this.confirming() !== 'delete') {
      this.confirming.set('delete');
      return;
    }
    this.confirming.set(null);
    await this.run('delete', async () => {
      await this.api.remove(node.id);
      await this.router.navigate(this.deskRoute() as string[]);
    });
  }

  protected dossierPageChosen(slug: string): void {
    if (this.query().get('page') === slug) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: slug },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- helpers ----------------------------------------------------------------------------------

  protected routeOf(node: EntityNode): readonly string[] {
    return entityRoute(this.projectSlug(), node);
  }

  protected address(node: EntityNode): string {
    return entityAddress(node);
  }

  protected label(node: EntityNode): string {
    return `${entityAddress(node)} ${node.title}`;
  }

  protected repositoryName(id: string | null): string {
    if (!id) {
      return NONE;
    }
    return this.loaded()?.repositories.get(id) ?? id;
  }

  protected age(iso: string): string {
    return relativeSince(iso);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected typeOf(event: Event): TicketType {
    return (event.target as HTMLSelectElement).value as TicketType;
  }

  /** One write: the busy key, the failure line, and the 409's own sentence when the server gave one. */
  private async run(key: string, work: () => Promise<void>): Promise<void> {
    this.action.set(key);
    this.actionFailure.set(null);
    try {
      await work();
    } catch (error) {
      this.actionFailure.set(refusal(error));
    } finally {
      this.action.set(null);
    }
  }
}

/** A refusal as a sentence: the service's own words on a 409, a described error otherwise. */
function refusal(error: unknown): string {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const stated = statusOf(error) === 409 ? serverMessage(body) : null;
  return stated ?? `That did not work — ${describeError(error)}.`;
}
