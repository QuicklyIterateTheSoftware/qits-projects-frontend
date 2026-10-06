import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import { CampaignsApi } from '../api/campaigns-api';
import type {
  CampaignDto,
  CampaignMemberDto,
  ConditionGroup,
  CriterionDto,
  CriterionSpec,
} from '../api/dto';
import { ProjectEvents } from '../api/project-events';
import { Async } from '../ui/async';
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
import { CampaignCriterionForm } from './campaign-criterion-form';
import {
  criterionSentence,
  editableMember,
  memberRefs,
  membershipEditable,
  waitTargets,
  waitsForLine,
  withCriterion,
  withoutCriterion,
  type MemberRef,
} from './campaign-model';
import { statusBadge } from './entities-model';

/** An epic or a ticket of this project that could join the campaign. */
export interface CampaignCandidate {
  readonly id: string;
  readonly archetype: string;
  readonly qualifiedId: string | null;
  readonly title: string;
}

/** The "already in flight" control: auto sends nothing and lets the service decide. */
type InFlight = 'auto' | 'yes' | 'no';

/** Where an add-form is open: which member, and which group (null: a new group, "or instead…"). */
interface Adding {
  readonly membershipId: string;
  readonly group: number | null;
}

/**
 * **A campaign's membership, its order and its conditions** — the authoring half of the CAMPAIGN
 * body on the entity page (qits-419).
 *
 * <ul>
 *   <li><b>The member list</b>, by position: qualified id, title, status, `joinedRunning`. ↑ and ↓
 *       call `moveMember` and nothing else — order and dependency are two facts, so a reorder never
 *       touches a condition.</li>
 *   <li><b>The "waits for" line</b> under each row names the members its criteria point at, with ↑
 *       for one above the row and ↓ for one below. It is read off the criteria, never off position:
 *       inserting B between A and C leaves C waiting on A, and the line says exactly that.</li>
 *   <li><b>The criteria editor</b>: groups are "any of" boxes, criteria inside a group "all of" rows,
 *       each a sentence. The seeded criterion is tagged <em>seeded</em> and its ✕ is one click —
 *       hiding it would make the seed implied behaviour again. A group left empty by a ✕ is dropped,
 *       because the service refuses an empty group. "…and wait for" adds to a group, "or instead…"
 *       adds a group, and each add PUTs the whole condition.</li>
 *   <li><b>A claimed member is read-only</b> and cannot be removed; an unclaimed one can, and a 409
 *       ("… waits on it") shows the service's sentence.</li>
 *   <li><b>Add member</b>: the project's epics and tickets not already in it, and an "already in
 *       flight" control whose default, <em>auto</em>, sends nothing.</li>
 * </ul>
 *
 * <p>It reads the campaign itself, and again on every `epics` hint and every {@link revision} the page
 * bumps after its own presses — no polling.
 */
@Component({
  selector: 'app-campaign-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, CampaignCriterionForm, MarkdownView, QitsBadge, QitsButton, RouterLink],
  template: `
    <app-async
      [state]="campaign()"
      loadingLabel="Loading the campaign"
      errorLabel="Could not load the campaign"
      (retry)="load()"
    />

    @if (loaded(); as c) {
      @if (c.description; as text) {
        <app-markdown class="description" [text]="text" />
      } @else {
        <p class="absent">No description yet.</p>
      }

      <section class="members" aria-label="Members">
        <h2>Members</h2>
        @if (!editable()) {
          <p class="note locked">
            Membership is fixed at {{ c.status.toLowerCase() }} — it is edited while the campaign is
            reported, refined or ready for dev.
          </p>
        }
        @if (c.members.length === 0) {
          <p class="absent">No members yet.</p>
        }
        <ol class="member-list">
          @for (
            member of c.members;
            track member.membershipId;
            let index = $index;
            let last = $last
          ) {
            <li class="member" [attr.data-membership]="member.membershipId">
              <div class="member-head">
                <span class="position">{{ index + 1 }}</span>
                @if (member.entity.qualifiedId; as qualified) {
                  <a class="qualified" [routerLink]="memberRoute(qualified)">{{ qualified }}</a>
                }
                <span class="member-title">{{ member.entity.title }}</span>
                <qits-badge
                  class="member-status"
                  [label]="statusOf(member).label"
                  [tone]="statusOf(member).tone"
                />
                @if (member.joinedRunning) {
                  <qits-badge class="joined" label="joined running" tone="info" />
                }
                @if (member.claimedAt) {
                  <qits-badge class="claimed" label="claimed" tone="neutral" />
                }
                <span class="row-actions">
                  <qits-button
                    class="up"
                    variant="ghost"
                    size="sm"
                    [attr.aria-label]="'Move ' + name(member) + ' up'"
                    [disabled]="index === 0 || !editable() || action() !== null"
                    (pressed)="move(member, index - 1)"
                  >
                    ↑
                  </qits-button>
                  <qits-button
                    class="down"
                    variant="ghost"
                    size="sm"
                    [attr.aria-label]="'Move ' + name(member) + ' down'"
                    [disabled]="last || !editable() || action() !== null"
                    (pressed)="move(member, index + 1)"
                  >
                    ↓
                  </qits-button>
                  @if (!member.claimedAt && editable()) {
                    <qits-button
                      class="remove-member"
                      variant="ghost"
                      size="sm"
                      [disabled]="action() !== null"
                      [busy]="action() === 'remove:' + member.membershipId"
                      (pressed)="remove(member)"
                    >
                      {{
                        confirmingRemove() === member.membershipId ? 'Confirm remove?' : 'Remove'
                      }}
                    </qits-button>
                  }
                </span>
              </div>

              @if (waitsFor(member); as line) {
                <p class="waits-for">{{ line }}</p>
              }

              <div class="condition" [class.read-only]="!memberEditable(member)">
                @if (member.groups.length > 0) {
                  <p class="caption">Runs when any of these holds:</p>
                }
                @for (group of member.groups; track group.id; let g = $index) {
                  @if (g > 0) {
                    <p class="or">or</p>
                  }
                  <div class="group" [attr.data-group]="group.id">
                    <p class="caption">all of:</p>
                    <ul class="criteria">
                      @for (criterion of group.criteria; track criterion.id) {
                        <li class="criterion" [attr.data-kind]="criterion.kind">
                          <span class="sentence">{{ sentence(criterion) }}</span>
                          @if (criterion.seeded) {
                            <span class="seeded">seeded</span>
                          }
                          @if (criterion.satisfiedAt) {
                            <span class="latched">satisfied</span>
                          }
                          @if (memberEditable(member)) {
                            <button
                              type="button"
                              class="remove-criterion"
                              [attr.aria-label]="'Remove “' + sentence(criterion) + '”'"
                              [disabled]="action() !== null"
                              (click)="removeCriterion(member, criterion)"
                            >
                              ✕
                            </button>
                          }
                        </li>
                      }
                    </ul>
                    @if (memberEditable(member) && !isAdding(member, g)) {
                      <qits-button
                        class="and-wait"
                        variant="ghost"
                        size="sm"
                        [disabled]="action() !== null"
                        (pressed)="startAdding(member, g)"
                      >
                        …and wait for
                      </qits-button>
                    }
                    @if (isAdding(member, g)) {
                      <app-campaign-criterion-form
                        [members]="othersOf(member)"
                        [defaultEntityId]="previousOf(index)"
                        [repositories]="repositories()"
                        [busy]="action() === 'condition:' + member.membershipId"
                        (saved)="addCriterion(member, $event)"
                        (cancelled)="adding.set(null)"
                      />
                    }
                  </div>
                }
                @if (memberEditable(member) && !isAdding(member, null)) {
                  <qits-button
                    class="or-instead"
                    variant="ghost"
                    size="sm"
                    [disabled]="action() !== null"
                    (pressed)="startAdding(member, null)"
                  >
                    {{ member.groups.length > 0 ? 'or instead…' : 'wait for…' }}
                  </qits-button>
                }
                @if (isAdding(member, null)) {
                  <app-campaign-criterion-form
                    [members]="othersOf(member)"
                    [defaultEntityId]="previousOf(index)"
                    [repositories]="repositories()"
                    [busy]="action() === 'condition:' + member.membershipId"
                    (saved)="addCriterion(member, $event)"
                    (cancelled)="adding.set(null)"
                  />
                }
              </div>
            </li>
          }
        </ol>
      </section>

      @if (editable()) {
        <section class="add-member" aria-label="Add a member">
          <h2>Add a member</h2>
          @if (candidates().length === 0) {
            <p class="absent">Every epic and ticket of this project is already a member.</p>
          } @else {
            <div class="add-row">
              <label class="field">
                <span class="label">Epic or ticket</span>
                <select class="text candidate" (change)="candidate.set(selected($event))">
                  @for (option of candidates(); track option.id) {
                    <option [value]="option.id" [selected]="option.id === candidate()">
                      {{ option.qualifiedId ?? '' }} {{ option.title }} ({{
                        option.archetype.toLowerCase()
                      }})
                    </option>
                  }
                </select>
              </label>
              <label class="field">
                <span class="label">Already in flight?</span>
                <select class="text in-flight" (change)="inFlight.set(selected($event))">
                  <option value="auto" [selected]="inFlight() === 'auto'">
                    auto — the service decides
                  </option>
                  <option value="yes" [selected]="inFlight() === 'yes'">yes</option>
                  <option value="no" [selected]="inFlight() === 'no'">no</option>
                </select>
              </label>
              <qits-button
                class="add"
                variant="secondary"
                size="sm"
                [disabled]="!candidate() || action() !== null"
                [busy]="action() === 'add'"
                (pressed)="add()"
              >
                Add member
              </qits-button>
            </div>
          }
          @if (added(); as line) {
            <p class="added" role="status">{{ line }}</p>
          }
        </section>
      }

      @if (failure(); as message) {
        <p class="failed" role="alert">{{ message }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    h2 {
      margin: 1rem 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .absent {
      margin: 0 0 1rem;
      color: #6b7280;
      font-style: italic;
    }
    .note {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .member-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .member {
      padding: 0.5rem 0;
      border-top: 1px solid #f3f4f6;
      font-size: 0.85rem;
    }
    .member-head {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .position {
      min-width: 1.25rem;
      color: #9ca3af;
      font-variant-numeric: tabular-nums;
    }
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #6b7280;
    }
    .member-title {
      color: #111827;
      overflow-wrap: anywhere;
    }
    .row-actions {
      display: inline-flex;
      gap: 0.2rem;
      margin-left: auto;
    }
    .waits-for {
      margin: 0.2rem 0 0 1.7rem;
      color: #374151;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
    }
    .condition {
      margin: 0.3rem 0 0 1.7rem;
    }
    .caption {
      margin: 0 0 0.2rem;
      font-size: 0.75rem;
      color: #6b7280;
    }
    .or {
      margin: 0.2rem 0;
      font-size: 0.75rem;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
    }
    .group {
      padding: 0.35rem 0.55rem;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
    }
    .criteria {
      margin: 0 0 0.25rem;
      padding: 0;
      list-style: none;
    }
    .criterion {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      padding: 0.1rem 0;
    }
    .seeded,
    .latched {
      padding: 0 0.35rem;
      border-radius: 999px;
      font-size: 0.7rem;
    }
    .seeded {
      background: #eef2ff;
      color: #4338ca;
    }
    .latched {
      background: #ecfdf5;
      color: #047857;
    }
    .remove-criterion {
      padding: 0 0.3rem;
      border: 0;
      background: none;
      color: #b91c1c;
      font: inherit;
      cursor: pointer;
    }
    .add-row {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .field {
      display: block;
      flex: 1 1 12rem;
    }
    .label {
      display: block;
      margin-bottom: 0.15rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
    }
    .text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.3rem 0.45rem;
      font: inherit;
      font-size: 0.85rem;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .added {
      margin: 0.4rem 0 0;
      color: #047857;
    }
    .failed {
      margin: 0.6rem 0;
      color: #b91c1c;
    }
  `,
})
export class CampaignMembers {
  private readonly api = inject(CampaignsApi);
  private readonly events = inject(ProjectEvents);

  /** The campaign's qualified id (or its id) — what `/work` addresses it by. */
  readonly campaignId = input.required<string>();

  /** The project's slug, which a member's link is spelled with. */
  readonly projectSlug = input<string>('');

  /** The project's epics and tickets — what the add-member picker offers, less the members. */
  readonly entities = input<readonly CampaignCandidate[]>([]);

  /** The project's repositories, by name, for the *repository releases* form. */
  readonly repositories = input<readonly string[]>([]);

  /** Bumped by the page after its own presses (a status move, the start), so this re-reads. */
  readonly revision = input(0);

  protected readonly campaign = signal<Loadable<CampaignDto>>(LOADING);
  protected readonly action = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly adding = signal<Adding | null>(null);
  protected readonly confirmingRemove = signal<string | null>(null);
  protected readonly added = signal<string | null>(null);
  protected readonly inFlight = signal<InFlight>('auto');

  protected readonly loaded = computed(() => {
    const state = this.campaign();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly editable = computed(() => membershipEditable(this.loaded()?.status ?? null));

  private readonly refs = computed<readonly MemberRef[]>(() =>
    memberRefs(this.loaded()?.members ?? []),
  );

  /** The epics and tickets not already in this campaign. */
  protected readonly candidates = computed<readonly CampaignCandidate[]>(() => {
    const members = new Set((this.loaded()?.members ?? []).map((member) => member.entity.id));
    return this.entities().filter((entity) => !members.has(entity.id));
  });

  protected readonly candidate = linkedSignal<string>(() => this.candidates()[0]?.id ?? '');

  private watching: string | null = null;
  private attempt = 0;

  constructor() {
    effect(() => {
      const id = this.campaignId();
      this.revision();
      this.events.invalidations('epics')();
      if (!id) {
        return;
      }
      const quiet = id === this.watching;
      this.watching = id;
      untracked(() => void this.load(quiet));
    });
  }

  /** Read the campaign. Loud on arrival; quiet on a hint, keeping the rows when a quiet read fails. */
  async load(quiet = false): Promise<void> {
    const id = this.campaignId();
    if (!quiet) {
      this.campaign.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const campaign = await this.api.get(id);
      if (attempt === this.attempt) {
        this.campaign.set(ready(campaign));
      }
    } catch (error) {
      if (attempt === this.attempt && !(quiet && this.loaded())) {
        this.campaign.set(failed(error));
      }
    }
  }

  // ---- presses ------------------------------------------------------------------------------------

  /** ↑ or ↓: order only. `moveMember` answers the members, which replace the rows. */
  protected async move(member: CampaignMemberDto, position: number): Promise<void> {
    await this.run(`move:${member.membershipId}`, async () => {
      const members = await this.api.moveMember(this.campaignId(), member.membershipId, position);
      const campaign = this.loaded();
      if (campaign) {
        this.campaign.set(ready({ ...campaign, members }));
      }
    });
  }

  /** Remove an unclaimed member — asked twice. A 409 names who waits on it. */
  protected async remove(member: CampaignMemberDto): Promise<void> {
    if (this.confirmingRemove() !== member.membershipId) {
      this.confirmingRemove.set(member.membershipId);
      return;
    }
    this.confirmingRemove.set(null);
    await this.run(`remove:${member.membershipId}`, async () => {
      await this.api.removeMember(this.campaignId(), member.membershipId);
      await this.load(true);
    });
  }

  /** The ✕: the whole condition without this criterion, a group it empties dropped with it. */
  protected async removeCriterion(
    member: CampaignMemberDto,
    criterion: CriterionDto,
  ): Promise<void> {
    await this.condition(member, withoutCriterion(member.groups, criterion.id));
  }

  protected startAdding(member: CampaignMemberDto, group: number | null): void {
    this.failure.set(null);
    this.adding.set({ membershipId: member.membershipId, group });
  }

  protected isAdding(member: CampaignMemberDto, group: number | null): boolean {
    const adding = this.adding();
    return adding?.membershipId === member.membershipId && adding.group === group;
  }

  /** A form's criterion: into its group ("…and wait for") or a new one ("or instead…"), then PUT. */
  protected async addCriterion(member: CampaignMemberDto, criterion: CriterionSpec): Promise<void> {
    const group = this.adding()?.group ?? null;
    const saved = await this.condition(member, withCriterion(member.groups, criterion, group));
    if (saved) {
      this.adding.set(null);
    }
  }

  /** Add the picked entity. `auto` sends no `inFlight`; the answer's `joinedRunning` is echoed. */
  protected async add(): Promise<void> {
    const entityId = this.candidate();
    if (!entityId) {
      return;
    }
    const choice = this.inFlight();
    const inFlight = choice === 'auto' ? undefined : choice === 'yes';
    this.added.set(null);
    await this.run('add', async () => {
      const member = await this.api.addMember(this.campaignId(), entityId, undefined, inFlight);
      this.added.set(
        member.joinedRunning
          ? `${this.name(member)} joined already running — this campaign will not dispatch it.`
          : `${this.name(member)} joined — this campaign dispatches it when its condition holds.`,
      );
      this.inFlight.set('auto');
      await this.load(true);
    });
  }

  // ---- reading ------------------------------------------------------------------------------------

  protected statusOf(member: CampaignMemberDto) {
    return statusBadge(member.entity.status);
  }

  protected name(member: Pick<CampaignMemberDto, 'entity'>): string {
    return member.entity.qualifiedId ?? member.entity.title;
  }

  protected memberRoute(qualified: string): readonly string[] {
    return ['/', this.projectSlug(), 'work', qualified];
  }

  protected memberEditable(member: CampaignMemberDto): boolean {
    return editableMember(member, this.loaded()?.status ?? null);
  }

  protected sentence(criterion: CriterionDto): string {
    return criterionSentence(criterion, this.refs());
  }

  protected waitsFor(member: CampaignMemberDto): string {
    const members = this.loaded()?.members ?? [];
    return waitsForLine(waitTargets(member, members), member.groups.length > 0);
  }

  /** Every member but this one — what a *member reaches status* criterion may name. */
  protected othersOf(member: CampaignMemberDto): readonly MemberRef[] {
    return this.refs().filter((ref) => ref.entityId !== member.entity.id);
  }

  /** The member above row `index`, the *member reaches status* form's default target. */
  protected previousOf(index: number): string | null {
    return this.loaded()?.members[index - 1]?.entity.id ?? null;
  }

  protected selected<T extends string>(event: Event): T {
    return (event.target as HTMLSelectElement).value as T;
  }

  // ---- plumbing -----------------------------------------------------------------------------------

  /** PUT a whole condition and splice the answered member in. True when the service took it. */
  private async condition(
    member: CampaignMemberDto,
    groups: readonly ConditionGroup[],
  ): Promise<boolean> {
    let saved = false;
    await this.run(`condition:${member.membershipId}`, async () => {
      const answered = await this.api.setCondition(this.campaignId(), member.membershipId, groups);
      const campaign = this.loaded();
      if (campaign) {
        this.campaign.set(
          ready({
            ...campaign,
            members: campaign.members.map((row) =>
              row.membershipId === answered.membershipId ? answered : row,
            ),
          }),
        );
      }
      saved = true;
    });
    return saved;
  }

  private async run(key: string, work: () => Promise<void>): Promise<void> {
    this.action.set(key);
    this.failure.set(null);
    try {
      await work();
    } catch (error) {
      this.failure.set(refusal(error));
    } finally {
      this.action.set(null);
    }
  }
}

/**
 * A refusal as a sentence: the service's own words on a 409 (and on a 400, which lists every
 * violation of a condition), a described error — status and message — otherwise.
 */
function refusal(error: unknown): string {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const status = statusOf(error);
  const stated = status === 409 || status === 400 ? serverMessage(body) : null;
  return stated ?? `That did not work — ${describeError(error)}.`;
}
