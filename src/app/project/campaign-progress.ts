import { HttpErrorResponse } from '@angular/common/http';
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
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import { CampaignsApi } from '../api/campaigns-api';
import type {
  CampaignCriterionProgressDto,
  CampaignMemberProgressDto,
  CampaignProgressDto,
} from '../api/dto';
import { ProjectEvents } from '../api/project-events';
import { Async } from '../ui/async';
import { NONE, formatInstant } from '../ui/format';
import {
  LOADING,
  describeError,
  failed,
  ready,
  serverMessage,
  statusOf,
  type Loadable,
} from '../ui/loadable';
import { STATE_MEANINGS, STATE_TONES, evidenceLine, stateLabel } from './campaign-model';
import { statusLabel } from './entities-model';

/** The header line, drawn only when nothing is listening for the events the criteria wait on. */
const EVALUATOR_DOWN =
  'The campaign evaluator is not listening. Waiting members may be waiting on nothing.';

/**
 * **How a campaign is running** — the watching half of the CAMPAIGN body (qits-420).
 *
 * <p>It reads `GET /campaigns/{id}/progress` and nothing else, and reads it again on every `epics`
 * hint (every campaign write fires one) and every {@link revision} the page bumps after its own
 * presses. There is no polling and no topic of its own.
 *
 * <ul>
 *   <li><b>A state chip per member</b>, one of the eight words, with its meaning on hover.</li>
 *   <li><b>WAITING</b> lists each outstanding criterion's `wouldBeSatisfiedBy`. One with
 *       `satisfiable: false` is drawn in the warning variant with its `reason` — the "stuck versus
 *       waiting" distinction this view exists for. It is not an error banner, and the campaign is
 *       never declared broken.</li>
 *   <li><b>REFUSED</b> says why and when, and links to the member, where a person fixes it.</li>
 *   <li><b>RUNNING / JOINED_RUNNING</b> give the member's status, when it was dispatched, the branch
 *       and the workspace; a joined one says it was never dispatched by this campaign.</li>
 *   <li><b>DISPATCH_FAILED</b> gives the error and what to do about it.</li>
 *   <li><b>Satisfied criteria</b>, in every state, are records rather than ticks: the event that
 *       matched, the state it was already in, or who approved and what they said.</li>
 *   <li><b>The evaluator line</b> is drawn only when nothing is listening
 *       (`!connected || stalled`).</li>
 *   <li><b>Approve</b> copies `ReleaseGatesPanel`'s approval: a note, *Approve*, then *Confirm
 *       approve?*. There is no decline — a decline is the one non-monotone act. A 409 shows the
 *       service's sentence; a non-admin's 403 shows the status and the sentence, as the page's
 *       dispatch press does.</li>
 * </ul>
 */
@Component({
  selector: 'app-campaign-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsBadge, QitsButton, RouterLink],
  template: `
    <section class="progress" aria-label="Progress">
      <h2>Progress</h2>
      <app-async
        [state]="progress()"
        loadingLabel="Loading the progress"
        errorLabel="Could not load the progress"
        (retry)="load()"
      />

      @if (loaded(); as p) {
        @if (!p.evaluator.connected || p.evaluator.stalled) {
          <p class="evaluator-warning" role="status">{{ evaluatorDown }}</p>
        }
        @if (p.members.length === 0) {
          <p class="absent">No members yet.</p>
        }
        <ol class="progress-list">
          @for (member of p.members; track member.membershipId) {
            <li
              class="progress-member"
              [attr.data-membership]="member.membershipId"
              [attr.data-state]="member.state"
            >
              <div class="head">
                @if (member.entity.qualifiedId; as qualified) {
                  <a class="qualified" [routerLink]="memberRoute(qualified)">{{ qualified }}</a>
                }
                <span class="member-title">{{ member.entity.title }}</span>
                <span class="state-chip" [title]="meanings[member.state]">
                  <qits-badge [label]="label(member)" [tone]="tones[member.state]" />
                </span>
              </div>

              @switch (member.state) {
                @case ('WAITING') {
                  <ul class="outstanding">
                    @for (criterion of outstanding(member); track criterion.id) {
                      <li class="would" [class.unsatisfiable]="!criterion.satisfiable">
                        {{ criterion.wouldBeSatisfiedBy }}
                        @if (!criterion.satisfiable) {
                          <span class="reason"
                            >— cannot be met as it stands: {{ criterion.reason }}</span
                          >
                        }
                      </li>
                    }
                  </ul>
                }
                @case ('READY') {
                  <p class="state-line">
                    Its condition holds — the campaign dispatches it on its next pass.
                  </p>
                }
                @case ('REFUSED') {
                  <p class="state-line refused">
                    Refused {{ instant(member.dispatchRefusedAt) }}: {{ member.dispatchRefusal }}
                    @if (member.entity.qualifiedId; as qualified) {
                      —
                      <a class="fix" [routerLink]="memberRoute(qualified)"
                        >fix it on {{ qualified }}</a
                      >
                    }
                  </p>
                }
                @case ('RUNNING') {
                  <p class="state-line running">{{ runLine(member) }}</p>
                }
                @case ('JOINED_RUNNING') {
                  <p class="state-line running">
                    joined already running — never dispatched by this campaign ·
                    {{ runLine(member) }}
                  </p>
                }
                @case ('DISPATCH_FAILED') {
                  <p class="state-line dispatch-error">{{ member.dispatchError }}</p>
                  <p class="hint">
                    the claim is kept; dispatch the member by hand if no workspace came up
                  </p>
                }
                @default {
                  <p class="state-line">{{ memberStatus(member) }}</p>
                }
              }

              @if (evidence(member).length > 0) {
                <ul class="evidence">
                  @for (line of evidence(member); track $index) {
                    <li>{{ line }}</li>
                  }
                </ul>
              }

              @if (askable()) {
                @for (criterion of approvals(member); track criterion.id) {
                  <div class="ask" [attr.data-criterion]="criterion.id">
                    <span class="name">Approval</span>
                    <span class="waiting">— waiting for a person</span>
                    <input
                      class="note-field"
                      type="text"
                      [value]="noteOf(criterion.id)"
                      (input)="noteTyped(criterion.id, $event)"
                      placeholder="A note (optional)"
                      [attr.aria-label]="'A note on approving ' + name(member)"
                    />
                    <qits-button
                      class="approve"
                      variant="primary"
                      size="sm"
                      [busy]="inFlight() === criterion.id"
                      [disabled]="inFlight() !== null"
                      (pressed)="approve(member, criterion)"
                    >
                      {{ pending() === criterion.id ? 'Confirm approve?' : 'Approve' }}
                    </qits-button>
                  </div>
                  @if (failures()[criterion.id]; as failure) {
                    <p class="failed" role="alert">{{ failure }}</p>
                  }
                }
              }
            </li>
          }
        </ol>
      }
    </section>
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
    .evaluator-warning {
      margin: 0 0 0.6rem;
      padding: 0.35rem 0.55rem;
      border: 1px solid #fcd34d;
      border-radius: 0.3rem;
      background: #fffbeb;
      color: #92400e;
      font-size: 0.85rem;
    }
    .progress-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .progress-member {
      padding: 0.45rem 0;
      border-top: 1px solid #f3f4f6;
      font-size: 0.85rem;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #6b7280;
    }
    .member-title {
      color: #111827;
      overflow-wrap: anywhere;
    }
    .state-chip {
      margin-left: auto;
      cursor: help;
    }
    .outstanding,
    .evidence {
      margin: 0.25rem 0 0;
      padding-left: 1.2rem;
      color: #374151;
    }
    .would.unsatisfiable {
      color: #92400e;
      background: #fffbeb;
      border-radius: 0.25rem;
    }
    .evidence {
      color: #047857;
    }
    .state-line {
      margin: 0.25rem 0 0;
      color: #374151;
      overflow-wrap: anywhere;
    }
    .refused {
      color: #92400e;
    }
    .dispatch-error {
      color: #b91c1c;
    }
    .hint {
      margin: 0.15rem 0 0;
      color: #6b7280;
    }
    .ask {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.45rem;
    }
    .note-field {
      flex: 1;
      min-width: 12rem;
      font: inherit;
      font-size: 0.85rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      padding: 0.15rem 0.35rem;
    }
    .waiting {
      color: #6b7280;
    }
    .failed {
      margin: 0.3rem 0 0;
      color: #b91c1c;
    }
  `,
})
export class CampaignProgress {
  private readonly api = inject(CampaignsApi);
  private readonly events = inject(ProjectEvents);

  readonly campaignId = input.required<string>();

  /** The project's slug, which a member's link is spelled with. */
  readonly projectSlug = input<string>('');

  /** Bumped by the page after its own presses (the start, a status move), so this re-reads. */
  readonly revision = input(0);

  protected readonly evaluatorDown = EVALUATOR_DOWN;
  protected readonly meanings = STATE_MEANINGS;
  protected readonly tones = STATE_TONES;

  protected readonly progress = signal<Loadable<CampaignProgressDto>>(LOADING);

  /** The approval asking to be pressed again — the house's confirmation, keyed by criterion. */
  protected readonly pending = signal<string | null>(null);
  protected readonly inFlight = signal<string | null>(null);
  private readonly notes = signal<Readonly<Record<string, string>>>({});
  protected readonly failures = signal<Readonly<Record<string, string>>>({});

  protected readonly loaded = computed(() => {
    const state = this.progress();
    return state.kind === 'ready' ? state.value : null;
  });

  /** A finished campaign takes no approval (the service answers 409), so none is asked for. */
  protected readonly askable = computed(() => {
    const status = this.loaded()?.campaign.status;
    return status !== 'DONE' && status !== 'DROPPED';
  });

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

  /** Read the progress. Loud on arrival; quiet on a hint, keeping what is drawn if a read fails. */
  async load(quiet = false): Promise<void> {
    const id = this.campaignId();
    if (!quiet) {
      this.progress.set(LOADING);
    }
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const progress = await this.api.progress(id);
      if (attempt === this.attempt) {
        this.progress.set(ready(progress));
      }
    } catch (error) {
      if (attempt === this.attempt && !(quiet && this.loaded())) {
        this.progress.set(failed(error));
      }
    }
  }

  // ---- reading ------------------------------------------------------------------------------------

  protected label(member: CampaignMemberProgressDto): string {
    return stateLabel(member.state);
  }

  protected name(member: CampaignMemberProgressDto): string {
    return member.entity.qualifiedId ?? member.entity.title;
  }

  protected memberRoute(qualified: string): readonly string[] {
    return ['/', this.projectSlug(), 'work', qualified];
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected memberStatus(member: CampaignMemberProgressDto): string {
    return member.entity.status ? statusLabel(member.entity.status) : NONE;
  }

  /** Every criterion not yet latched, across the groups — what a WAITING member is waiting on. */
  protected outstanding(
    member: CampaignMemberProgressDto,
  ): readonly CampaignCriterionProgressDto[] {
    return member.groups.flatMap((group) =>
      group.criteria.filter((criterion) => !criterion.satisfied),
    );
  }

  /** "implemented · dispatched 27 Sep 2026 09:00:00Z · branch ticket/x · workspace 7". */
  protected runLine(member: CampaignMemberProgressDto): string {
    const parts = [this.memberStatus(member)];
    parts.push(
      member.dispatchedAt ? `dispatched ${formatInstant(member.dispatchedAt)}` : 'not dispatched',
    );
    parts.push(`branch ${member.dispatch.branch ?? NONE}`);
    parts.push(`workspace ${member.dispatch.workspaceId ?? NONE}`);
    return parts.join(' · ');
  }

  /** The satisfied criteria, as records. */
  protected evidence(member: CampaignMemberProgressDto): readonly string[] {
    return member.groups.flatMap((group) =>
      group.criteria.flatMap((criterion) => {
        const line = criterion.satisfied ? evidenceLine(criterion) : null;
        return line ? [line] : [];
      }),
    );
  }

  /** The outstanding APPROVAL criteria — each gets the ask form. */
  protected approvals(member: CampaignMemberProgressDto): readonly CampaignCriterionProgressDto[] {
    return this.outstanding(member).filter((criterion) => criterion.kind === 'APPROVAL');
  }

  protected noteOf(criterionId: string): string {
    return this.notes()[criterionId] ?? '';
  }

  protected noteTyped(criterionId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.notes.update((notes) => ({ ...notes, [criterionId]: value }));
  }

  // ---- the one press ------------------------------------------------------------------------------

  /** First press asks, second press sends the note. */
  protected async approve(
    member: CampaignMemberProgressDto,
    criterion: CampaignCriterionProgressDto,
  ): Promise<void> {
    if (this.pending() !== criterion.id) {
      this.pending.set(criterion.id);
      this.fail(criterion.id, null);
      return;
    }
    const note = this.noteOf(criterion.id).trim();
    this.pending.set(null);
    this.inFlight.set(criterion.id);
    this.fail(criterion.id, null);
    try {
      await this.api.approve(
        this.campaignId(),
        member.membershipId,
        criterion.id,
        note || undefined,
      );
      this.notes.update((notes) => ({ ...notes, [criterion.id]: '' }));
      await this.load(true);
    } catch (error) {
      this.fail(criterion.id, refusal(error));
    } finally {
      this.inFlight.set(null);
    }
  }

  private fail(criterionId: string, message: string | null): void {
    this.failures.update((failures) => {
      const next = { ...failures };
      if (message) {
        next[criterionId] = message;
      } else {
        delete next[criterionId];
      }
      return next;
    });
  }
}

/** The service's own words on a 409 ("already approved by …"); status and message otherwise. */
function refusal(error: unknown): string {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const stated = statusOf(error) === 409 ? serverMessage(body) : null;
  return stated ?? `That did not work — ${describeError(error)}.`;
}
