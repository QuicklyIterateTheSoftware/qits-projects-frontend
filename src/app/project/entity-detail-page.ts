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
import { DossierApi, epicDossier, ticketDossier, type DossierOwner } from '../api/dossier-api';
import { workRef } from '../api/work';
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
  ACCEPTANCE_CRITERIA,
  IMPETUS_RULE,
  blockedBadges,
  blockedReasonLine,
  criteriaEditable,
  criterionProblems,
  featureStatus,
  gateHints,
  isExplicitBlock,
  isFinalStatus,
  lifecycleMoves,
  statusBadge,
  lifecycleOf,
  permits,
  statusLabel,
  statusesOf,
  taskStatus,
  ticketTypeBadge,
  type LifecycleMove,
  type StatusBadge,
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
import { restatement, specOf, subjectsOf, type TransitionSubject } from './entity-transition-model';
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
  /** The row's own badge: its status once the service serves one (qits-763), its marker otherwise. */
  readonly badge: StatusBadge;
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
 *       door, `POST /work/{q}/dispatch`. Dispatch is enabled off `dispatchable` alone — since
 *       qits-1075 that is true at an unblocked `REFINED` too, where a person's press schedules the
 *       ticket (`REFINED` → `READY_FOR_DEV`, as that person) and starts implementing rather than
 *       starting a phase. Run the next phase stays keyed on `nextPhase`, which is null at `REFINED`
 *       even then, so this page never maps a status to a phase itself.</li>
 *   <li><b>Refine</b> opens the entity's refinement room through `POST /work/{q}/refinement`
 *       and goes there. It is enabled where the dispatch state's next phase is `refine` — refinement
 *       *is* that phase — and an existing room is always offered as "Open refinement", whatever the
 *       status, because the service answers an existing room whatever the state.</li>
 *   <li>The three are absent for an archetype with no lifecycle at all — campaign's shorter set is
 *       the only one left (qits-763 gave a feature and a task the eight-word walk too) — **and** for
 *       a feature or a task regardless: {@link lifecycle} also requires `mayBeRoot`, because neither
 *       gets the phase machinery the three actions are drawn from, which is also where the service
 *       would refuse them.</li>
 * </ul>
 *
 * <p><b>Which status moves are offered is the served registry's `transitions`</b>, labelled by kind
 * (forward "Mark <word>", back "Back to <word>", "Drop", "Reopen") — the client keeps no table of
 * them. A status with no moves (`DONE`) is final and says so instead; a registry that serves no
 * `transitions` draws no moves at all rather than guessing.
 *
 * <p><b>Every path here names the node by its qualified id</b> — `/work/{q}/…` (epic qits-965); see
 * {@link ref}.
 *
 * <p><b>Status moves use the lifecycle door</b> — `POST /work/{q}/status`, every archetype's — and
 * not the multi-entity transition. The lifecycle door is what runs
 * the step (adjacency, the implemented stamping at IMPLEMENTED, discarding the room a resolving move
 * ends) and then the phase advance; the multi-entity door restates a row's shape and runs none of it.
 * **Field edits and reshapes** — title, description, impetus, type, assignee (wherever the registry
 * permits it: a ticket, and an epic from qits-887 on); promote, demote,
 * reparent — **go through `POST /work/transition`**, a restatement of the whole row, which is
 * what replaced the retired `PUT /epics/{id}` and `PUT /tickets/{id}`.
 *
 * <p><b>Acceptance criteria</b> (qits-887) are drawn, and edited in the edit form, wherever the
 * registry permits `ACCEPTANCE_CRITERIA` on the archetype — never by the archetype's name, so the
 * section appears the day the service permits it. They are saved as one whole list through
 * `PATCH /work/{q}` (a merge patch; `null` clears), and the editor is closed from
 * `READY_FOR_DEV` on, where the service freezes them. A move the registry serves with `gates` says
 * so beside its button ("needs acceptance criteria", "needs a person"); the gate itself is the
 * service's, and its 409 is shown as worded.
 *
 * <p><b>A campaign</b> (qits-419, qits-420) is a root with a lifecycle and a body of its own: how
 * it is running ({@link CampaignProgress}), and its members, their order and their conditions
 * ({@link CampaignMembers}). Its status moves go through the same lifecycle door
 * (`POST /work/{q}/status` — the multi-entity door refuses a campaign); its one
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
          @for (badge of blockBadges(); track badge.label) {
            <span [title]="badge.title"
              ><qits-badge class="blocked" [label]="badge.label" [tone]="badge.tone"
            /></span>
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
        @if (assigneePermitted()) {
          <dt>Assignee</dt>
          <dd class="assignee">{{ assignee() || none }}</dd>
        }
        @if (ticket(); as row) {
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
              {{
                confirming() === 'start'
                  ? 'Confirm ' + startLabel().toLowerCase() + '?'
                  : startLabel()
              }}
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
              [disabled]="!phaseRunnable() || action() !== null"
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
          <qits-button
            variant="secondary"
            [disabled]="action() !== null"
            (pressed)="startEditing()"
          >
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
          @if (step.gates.length > 0) {
            <span class="note gate-hint">{{ step.label }} {{ hints(step) }}</span>
          }
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
          @if (blockedNote(); as note) {
            <span class="note block-note">{{ note }}</span>
          }
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
          @if (assigneePermitted()) {
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
          @if (criteriaPermitted()) {
            <fieldset class="criteria-editor" [disabled]="!criteriaOpen()">
              <legend class="label">Acceptance criteria</legend>
              @if (!criteriaOpen()) {
                <p class="hint frozen">{{ criteriaFrozenNote() }}</p>
              }
              <ol class="criteria-drafts">
                @for (item of draftCriteria(); track $index; let i = $index) {
                  <li class="criterion-draft">
                    <div class="criterion-row">
                      <input
                        type="text"
                        class="text edit-criterion"
                        autocomplete="off"
                        [attr.aria-label]="'Criterion ' + (i + 1)"
                        [value]="item"
                        (input)="setCriterion(i, value($event))"
                      />
                      <qits-button
                        class="criterion-up"
                        variant="ghost"
                        size="sm"
                        [disabled]="!criteriaOpen() || i === 0"
                        (pressed)="moveCriterion(i, -1)"
                      >
                        ↑
                      </qits-button>
                      <qits-button
                        class="criterion-down"
                        variant="ghost"
                        size="sm"
                        [disabled]="!criteriaOpen() || i === draftCriteria().length - 1"
                        (pressed)="moveCriterion(i, 1)"
                      >
                        ↓
                      </qits-button>
                      <qits-button
                        class="criterion-remove"
                        variant="ghost"
                        size="sm"
                        [disabled]="!criteriaOpen()"
                        (pressed)="removeCriterion(i)"
                      >
                        Remove
                      </qits-button>
                    </div>
                    @if (criterionMessage(item); as message) {
                      <p class="criterion-problem" role="alert">{{ message }}</p>
                    }
                  </li>
                }
              </ol>
              <qits-button
                class="criterion-add"
                variant="secondary"
                size="sm"
                [disabled]="!criteriaOpen()"
                (pressed)="addCriterion()"
              >
                Add a criterion
              </qits-button>
              <p class="hint criteria-rule">{{ criteriaRule }}</p>
            </fieldset>
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
          @if (mode === 'unblock' && blockedNote(); as current) {
            <p class="note block-current">{{ current }}</p>
          }
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
            [campaignId]="ref(n)"
            [projectSlug]="projectSlug()"
            [entities]="campaignCandidates()"
            [repositories]="repositoryList()"
            [revision]="revision()"
          />
          <app-campaign-progress
            [campaignId]="ref(n)"
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

        @if (criteriaPermitted()) {
          <section class="criteria" aria-label="Acceptance criteria">
            <h2>Acceptance criteria</h2>
            @if (criteria().length === 0) {
              <p class="absent">None yet — it cannot be scheduled until it has some.</p>
            } @else {
              <ol class="criteria-list">
                @for (item of criteria(); track $index) {
                  <li class="criterion"><app-markdown [text]="item" [inline]="true" /></li>
                }
              </ol>
            }
          </section>
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
                      [label]="row.badge.label"
                      [tone]="row.badge.tone"
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
                      [label]="nodeBadge(child).label"
                      [tone]="nodeBadge(child).tone"
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

        <app-entity-thread [entityId]="ref(n)" [archetype]="n.archetype" />
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
    .criteria-editor {
      margin: 0 0 0.6rem;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .criteria-drafts,
    .criteria-list {
      margin: 0 0 0.5rem;
      padding-left: 1.25rem;
    }
    .criterion-draft {
      margin: 0 0 0.35rem;
    }
    .criterion-row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .criterion-problem {
      margin: 0.15rem 0 0;
      font-size: 0.8rem;
      color: #b91c1c;
    }
    .criteria-rule {
      margin: 0.4rem 0 0;
    }
    .criterion {
      margin: 0 0 0.2rem;
      color: #374151;
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
  /** The acceptance criteria being edited, one box per item, in order (qits-887). */
  protected readonly draftCriteria = signal<readonly string[]>([]);

  /** The item rules, as the editor says them — the service's, mirrored for the message only. */
  protected readonly criteriaRule =
    'One line each: at most one “.”, fewer than 20 spaces. Empty boxes are left out.';

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
   * feature or a task, which carry neither. The *effective* block since qits-895 — an explicit flag
   * or the agent waiting, either one.
   */
  protected readonly blockedEntity = computed(
    () => this.node()?.entity?.blocked ?? this.node()?.campaign?.blocked ?? false,
  );

  /** Whichever root carries the block fields — an epic's or a ticket's entity, or a campaign's. */
  private readonly blockedRoot = computed(() => this.node()?.entity ?? this.node()?.campaign ?? null);

  /** The badge(s) beside the title — none, one or both of blocked and waiting for you (qits-895). */
  protected readonly blockBadges = computed(() => {
    const root = this.blockedRoot();
    return root ? blockedBadges(root) : [];
  });

  /**
   * What the Block/Unblock section says about why, right now: "The agent is waiting for you." for a
   * pure `AGENT_WAITING` block, else "Blocked by `<who>`: `<reason>`". Empty while not blocked.
   */
  protected readonly blockedNote = computed(() => {
    const root = this.blockedRoot();
    return root ? blockedReasonLine(root) : '';
  });

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

  /**
   * A feature's or a task's fallback badge, for the `@else` branch above: drawn only while
   * `node().status` is null, which {@link taskStatus} and {@link featureStatus} then read as "no
   * status served yet" and answer from the markers instead — see the compatibility note on
   * {@link ../api/dto#FeatureDto.status}.
   */
  protected readonly marker = computed(() => {
    const node = this.node();
    if (node?.task) {
      return taskStatus(node.task);
    }
    return featureStatus({
      status: node?.feature?.status ?? null,
      implementedOn: node?.feature?.implementedOn ?? null,
      implementingOn: node?.feature?.implementingOn ?? null,
    });
  });

  /** The words this node's archetype may hold — empty for an archetype with no lifecycle. */
  private readonly vocabulary = computed<readonly string[]>(() => {
    const ground = this.loaded();
    const node = this.node();
    return ground && node ? statusesOf(ground.registry, node.archetype) : [];
  });

  /**
   * Whether this node has a lifecycle **and** the agent surface that goes with one — dispatch, the
   * next-phase press, refine.
   *
   * <p>Not vocabulary alone, deliberately: qits-763 gives a feature and a task the same eight-word
   * lifecycle an epic or a ticket has, but none of the phase machinery that runs behind it — the
   * service keeps `PhaseAdvance`, dispatch and refinement refused for both archetypes. `mayBeRoot` is
   * what the registry already uses to say "sits at the top of a project with its own phase", and it is
   * true for exactly the three archetypes this section was ever drawn for — epic, ticket, campaign —
   * so AND-ing it in is what keeps a feature's or a task's page from growing a Dispatch section merely
   * because its status picker now has words in it.
   */
  protected readonly lifecycle = computed(() => {
    if (this.vocabulary().length === 0) {
      return false;
    }
    const ground = this.loaded();
    const node = this.node();
    return ground && node ? (specOf(ground.registry, node.archetype)?.mayBeRoot ?? false) : false;
  });

  protected readonly moves = computed<readonly LifecycleMove[]>(() => {
    const node = this.node();
    return node ? lifecycleMoves(this.loaded()?.registry ?? null, node.archetype, node.status) : [];
  });

  /**
   * Whether the registry lets this node's archetype carry an assignee — a ticket's always has, an
   * epic's does from qits-887 on. Read off `permitted`, never the archetype's name.
   */
  protected readonly assigneePermitted = computed(() => {
    const node = this.node();
    return node ? permits(this.loaded()?.registry ?? null, node.archetype, 'ASSIGNEE') : false;
  });

  /** Who is on it — an epic's or a ticket's assignee, null when nobody has said. */
  protected readonly assignee = computed(() => this.node()?.entity?.assignee ?? null);

  /** Whether the registry lets this node's archetype carry acceptance criteria (qits-887). */
  protected readonly criteriaPermitted = computed(() => {
    const node = this.node();
    return node
      ? permits(this.loaded()?.registry ?? null, node.archetype, ACCEPTANCE_CRITERIA)
      : false;
  });

  /** The node's acceptance criteria as stored, in order — none on a server that serves none. */
  protected readonly criteria = computed<readonly string[]>(
    () => this.node()?.entity?.acceptanceCriteria ?? [],
  );

  /** Whether they may still be edited — before READY_FOR_DEV, where the service freezes them. */
  protected readonly criteriaOpen = computed(() => {
    const node = this.node();
    return node
      ? criteriaEditable(this.loaded()?.registry ?? null, node.archetype, node.status)
      : false;
  });

  protected readonly criteriaFrozenNote = computed(() => {
    const status = this.node()?.status;
    return `Frozen at ${status ? statusLabel(status) : 'this status'} — move it back to refined to change them.`;
  });

  /** The edited list as it would be sent: trimmed, empty boxes left out. */
  private readonly criteriaToSend = computed(() =>
    this.draftCriteria()
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

  /** Whether the node holds a final status — served, with no move out of it (`DONE`). */
  protected readonly final = computed(() => {
    const node = this.node();
    return node
      ? isFinalStatus(this.loaded()?.registry ?? null, node.archetype, node.status)
      : false;
  });

  protected readonly finalNote = computed(() => {
    const node = this.node();
    const word = node?.status ? statusLabel(node.status) : '';
    return `${word.charAt(0).toUpperCase()}${word.slice(1)} — final. Follow-up work is a new ticket or epic.`;
  });

  /** Dispatch (`FLOW`) is enabled wherever a press would run something — a schedule, as well as a phase. */
  protected readonly dispatchable = computed(() => this.state()?.dispatchable === true);

  /**
   * Run the next phase (`PHASE`) additionally requires a phase to run — the dispatch state's
   * `nextPhase`, which the service answers off status alone and does not null out for a blocked
   * entity. `dispatchable` alone is not enough here as it is for {@link dispatchable}'s own button:
   * since qits-1075 the two read differently at an unblocked `REFINED`, where `dispatchable` is true
   * (a `FLOW` press schedules the ticket) but `nextPhase` is still null (scheduling is not a phase),
   * so Run the next phase stays off there while Dispatch turns on.
   */
  protected readonly phaseRunnable = computed(
    () => this.state()?.dispatchable === true && this.state()?.nextPhase != null,
  );

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

  /**
   * What the flow actions' row says. A `preApprovedBy` outranks everything else — it is the more
   * specific story, and it reads whether or not the entity also sits at a dispatchable `REFINED`.
   * Past that: which phase a press starts, or — unblocked `REFINED`'s own case, where `dispatchable`
   * is true but `nextPhase` is not — that a press schedules and implements it.
   *
   * <p>The "Blocked" hint reads {@link isExplicitBlock}: a derived (`AGENT_WAITING`) block never
   * refuses a dispatch (qits-895), so `state.blocked` alone is not enough here — were it purely
   * `AGENT_WAITING`, `dispatchable` would already be true and an earlier branch would have returned.
   * The guard matters for the case where something else *also* keeps `dispatchable` false (an
   * unreachable status, say): there the hint should still name the explicit block, never the derived
   * one, since unblocking it is the one press that does anything.
   */
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
        ? `Nothing to start at ${statusLabel(state.status)} — a campaign starts from refined or ready for dev.`
        : 'Nothing to start.';
    }
    if (state.preApprovedBy) {
      return `Pre-approved by ${state.preApprovedBy}: the platform schedules it once refined.`;
    }
    if (state.dispatchable && state.nextPhase) {
      return `A press starts the ${state.nextPhase} phase.`;
    }
    if (state.dispatchable) {
      return 'A press schedules it and starts implementing.';
    }
    if (state.blocked && isExplicitBlock(state)) {
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
   *
   * <p>This is the gate on the button existing at all, both words. Which word it says is
   * {@link blockedEntity}'s alone: Unblock shows whenever this is true and the node's effective
   * block is true too — a pure `AGENT_WAITING` block included, since unblocking there still clears
   * the explicit half if one is ever added, and the service tolerates an unblock that was already
   * the case.
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
      this.criteriaToSend().every((item) => criterionProblems(item).length === 0) &&
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
        badge: this.nodeBadge(feature),
        repository: null,
      });
      for (const task of childrenOf(ground.nodes, feature.id)) {
        rows.push({
          node: task,
          depth: 1,
          badge: this.nodeBadge(task),
          repository: this.repositoryName(task.repositoryId),
        });
      }
    }
    return rows;
  });

  /**
   * A feature's or a task's row badge, wherever it is drawn as a child rather than as the page's own
   * node — the tree under an epic, and the list under a feature. Its own status once the service
   * serves one (qits-763), read through {@link taskStatus}/{@link featureStatus} exactly as the
   * page's own {@link marker} is, so a reader sees the same word in both places.
   */
  protected nodeBadge(node: EntityNode): StatusBadge {
    if (node.task) {
      return taskStatus(node.task);
    }
    if (node.feature) {
      return featureStatus(node.feature);
    }
    return {
      label: node.implementedAt ? 'implemented' : 'open',
      tone: node.implementedAt ? 'success' : 'neutral',
    };
  }

  /** The dossier this node owns: an epic's or a ticket's; a feature or a task has none. */
  protected readonly dossierOwner = computed<DossierOwner | null>(() => {
    const node = this.node();
    if (node?.archetype === 'EPIC') {
      return epicDossier(node.id, node.qualifiedId);
    }
    return node?.archetype === 'TICKET' ? ticketDossier(node.id, node.qualifiedId) : null;
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

  /**
   * The dispatch state and the room, for a node with the agent surface — see {@link lifecycle}.
   * Neither failing hides the page.
   */
  private async readFlow(node: EntityNode, attempt: number): Promise<void> {
    if (!this.lifecycle()) {
      this.state.set(null);
      this.room.set(null);
      return;
    }
    // A campaign has no refinement room — its members are refined, not it.
    const [state, room] = await Promise.all([
      this.api.dispatchState(this.ref(node)).catch(() => null),
      node.archetype === 'CAMPAIGN'
        ? Promise.resolve(null)
        : this.refinements.findFor(this.ref(node)).catch(() => null),
    ]);
    if (attempt === this.attempt) {
      this.state.set(state);
      this.room.set(room);
    }
  }

  async readAudit(quiet = false): Promise<void> {
    const node = this.node();
    // A campaign's writes are audited under its own id, the way an epic's tree is under the epic's.
    const root = node?.entity ?? node?.epic ?? node?.campaign ?? null;
    const key = root ? workRef(root) : null;
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
      const answer = await this.api.dispatch(this.ref(node), mode);
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
      await this.api.dispatch(this.ref(node), 'FLOW');
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
        this.room.set(await this.refinements.openFor(this.ref(node)));
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
      // One lifecycle door for every archetype (`POST /work/{q}/status`); a campaign's move also
      // re-reads its members and progress.
      await this.api.transition(this.ref(node), step.target);
      if (node.archetype === 'CAMPAIGN') {
        this.revision.update((count) => count + 1);
      }
      await this.load(true);
    });
  }

  /** Supersede the epic — asked twice — and go to the successor draft its answer names. */
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
      const answer = await this.api.transition(this.ref(node), 'SUPERSEDED');
      await this.load(true);
      const successor = nodeById(this.loaded()?.nodes ?? [], answer.supersededBy);
      if (successor) {
        await this.router.navigate(entityRoute(this.projectSlug(), successor) as string[]);
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
    this.draftAssignee.set(this.assignee() ?? '');
    this.draftCriteria.set([...this.criteria()]);
    this.actionFailure.set(null);
    this.blocking.set(null);
    this.editing.set(true);
  }

  /**
   * Save the edit as a restatement of the row on `POST /work/transition` — the door that replaced
   * the retired PUTs. An emptied box clears its property; see {@link restatement}.
   */
  protected async save(): Promise<void> {
    const node = this.node();
    const ground = this.loaded();
    if (!node || !ground || !this.savable()) {
      return;
    }
    const root = node.entity ?? node.epic;
    const subject = root
      ? subjectsOf(ground.registry, [root]).find((candidate) => candidate.id === node.id)
      : null;
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
    }
    if (this.assigneePermitted()) {
      changes['ASSIGNEE'] = this.draftAssignee().trim() || null;
    }
    const position = node.parentId
      ? childrenOf(ground.nodes, node.parentId).findIndex((sibling) => sibling.id === node.id)
      : undefined;
    const criteria = this.criteriaToSend();
    const criteriaChanged =
      this.criteriaPermitted() &&
      this.criteriaOpen() &&
      JSON.stringify(criteria) !== JSON.stringify(this.criteria());
    // The restatement is PUT-shaped: it carries the list it should leave behind, so it never undoes
    // the patch it follows.
    const stated = criteriaChanged ? withCriteria(subject, criteria) : subject;
    await this.run('save', async () => {
      if (criteriaChanged) {
        // The whole list through the merge patch; an emptied list clears it.
        await this.api.patch(this.ref(node), {
          acceptanceCriteria: criteria.length > 0 ? criteria : null,
        });
      }
      await this.api.transitionEntities(
        new Map([[node.id, restatement(ground.registry, stated, changes, position)]]),
      );
      this.editing.set(false);
      await this.load(true);
    });
  }

  protected setCriterion(index: number, item: string): void {
    this.draftCriteria.update((items) => items.map((old, at) => (at === index ? item : old)));
  }

  protected addCriterion(): void {
    this.draftCriteria.update((items) => [...items, '']);
  }

  protected removeCriterion(index: number): void {
    this.draftCriteria.update((items) => items.filter((_, at) => at !== index));
  }

  /** Swap one item with its neighbour above (`-1`) or below (`1`). */
  protected moveCriterion(index: number, by: -1 | 1): void {
    const to = index + by;
    this.draftCriteria.update((items) => {
      if (to < 0 || to >= items.length) {
        return items;
      }
      const next = [...items];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  /** What is wrong with one box, as a sentence — nothing for a good one or an empty one. */
  protected criterionMessage(item: string): string | null {
    if (item.trim().length === 0) {
      return null;
    }
    const problems = criterionProblems(item.trim());
    return problems.length > 0 ? `This criterion ${problems.join(', ')}.` : null;
  }

  protected hints(step: LifecycleMove): string {
    return gateHints(step);
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
      await this.api.setBlocked(this.ref(node), mode === 'block', this.blockNote().trim());
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
      await this.api.remove(this.ref(node));
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

  /** The segment `/work` addresses this node by: its qualified id (or its id, lacking one). */
  protected ref(node: Pick<EntityNode, 'id' | 'qualifiedId'>): string {
    return workRef(node);
  }

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

/**
 * A refusal as a sentence: the service's own words on a 409 (a freeze, a gate) or a 400 (a rule a
 * field broke — an acceptance criterion's, say), a described error otherwise.
 */
function refusal(error: unknown): string {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const status = statusOf(error);
  const stated = status === 409 || status === 400 ? serverMessage(body) : null;
  return stated ?? `That did not work — ${describeError(error)}.`;
}

/** The subject with its acceptance criteria replaced — an empty list carried as none. */
function withCriteria(subject: TransitionSubject, criteria: readonly string[]): TransitionSubject {
  const lists = { ...(subject.lists ?? {}) };
  if (criteria.length > 0) {
    lists[ACCEPTANCE_CRITERIA] = criteria;
  } else {
    delete lists[ACCEPTANCE_CRITERIA];
  }
  return { ...subject, lists };
}
