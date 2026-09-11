import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks, QitsButton } from '@qits/ui-components';
import type { CommitBuildStatusDto, ReleaseGateDto, ReleaseRequestDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { NONE, formatInstant, formatRelativeTime, shortSha } from '../ui/format';
import { describeError, serverMessage, statusOf } from '../ui/loadable';
import { approvalOutstanding, awaitingApproval } from './release-requests-model';

/** One verdict with the address this platform can actually spell for it, or none. */
interface DrawnVerdict {
  readonly build: CommitBuildStatusDto;
  readonly href?: string;
}

/** Which of the two decisions a press is about — the same shape for the confirm and the flight. */
type Decision = 'approve' | 'decline';

/**
 * What is standing between this release request and its release, one line per gate.
 *
 * <p><b>The gates a repository CONFIGURES, and no others.</b> A release request is held by every
 * quality gate its repository declares — a CI recipe, `manual-review: true`, a deployments manifest —
 * and by nothing else, so this panel draws the set the service reports rather than a fixed pair of
 * lines. Three states a reader can now see that did not exist before: **waiting on a build**,
 * **waiting on a person**, and **waiting on nothing**, which is a repository that configured no gate
 * and should read as releasable rather than as unfinished.
 *
 * <p><b>`UNKNOWN` is drawn as "could not read this repository's configuration" and never as
 * pending.</b> A gate quietly in progress and a configuration nobody could read are different things
 * to whoever is looking at the page, and only one of them is anybody's to wait for. The request is
 * held either way, so the sentence says which — and says that nothing refused it.
 *
 * <p><b>Why one panel for two unlike things.</b> A release request is held by a build and — on a
 * repository whose releases are approved — by a person, and the two are the same question to whoever
 * is looking at the page: *why has this not gone out*. Drawing the verdicts in one place and the
 * approval in another would make a reader answer it twice, and would leave the commonest case (green
 * build, nobody has said yes) looking exactly like the one nobody has to do anything about.
 *
 * <p><b>The deployment gate is answered after the tag, so it is never a wait in front of one.</b> It
 * is drawn because "released, waiting on its deployment" is a real state today that this page showed
 * nothing for: a release is a tag, and `main` is finalized when the deployment goes live.
 *
 * <p><b>The approval line is drawn only where the service says approval is required</b>, and the ask
 * only while the decision is actually outstanding. On an ordinary repository this panel is the CI
 * line alone and there is no approve affordance anywhere on the page — which is not decoration: the
 * service answers 409 to approving what has no gate, so a button offered there would be a button that
 * exists only to be refused. That check is `approvalRequired`, which is absent on every answer from a
 * service build older than the field, and absence reads as "no gate".
 *
 * <p><b>"No verdict yet" is a sentence, never an empty area.</b> An empty verdict list has one cause
 * — no terminal run has announced this fold — and it is a different fact from a red build and from a
 * fold nothing gates. A panel that drew nothing there would be read as "fine".
 *
 * <p><b>A non-gating verdict is shown and said to be non-gating.</b> A repository runs pipelines that
 * have nothing to do with releasing; a red one of those is worth seeing and is not why the release is
 * stuck, and hiding it would be as wrong as letting it look like the blocker.
 *
 * <p><b>The decision names the fold this panel was RENDERED with.</b> An approval is a statement
 * about content, so the sha travels with it, and a push that landed while the page was open is
 * answered 409 naming the fold the request is on now. That refusal is drawn here, calmly, as what it
 * is — the fold moved under the reader — and the panel goes back to unapproved rather than reporting
 * an error: nothing failed, and the right next act is to look at the new fold and decide again.
 *
 * <p><b>An anchor whose href this platform cannot spell is dropped, never drawn dead</b> — the
 * established rule. The run link is composed with **no scope**: qits-ci serves `runs/:runId` at its
 * own root and under no repository-scoped address, so spelling the project and the repository into it
 * would compose a URL that 404s.
 */
@Component({
  selector: 'app-release-gates-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <section class="panel gates">
      <h2>Gates</h2>

      @if (unknown()) {
        <p class="unknown" role="alert">
          This repository's gate configuration could not be read, so which gates apply is not known.
          The request is held — nothing has refused it — and the service retries on its own.
        </p>
      } @else if (nothingToWaitOn()) {
        <p class="no-gates">
          This repository configures no quality gate, so a release waits on nothing but somebody
          pressing release.
        </p>
      }

      @if (showCi()) {
      <div class="gate ci">
        <span class="name">CI</span>
        @if (verdicts().length === 0) {
          <span class="none">No verdict yet — no build of this fold has announced one.</span>
        } @else {
          <ul class="verdicts">
            @for (drawn of verdicts(); track drawn.build.runId) {
              <li class="verdict" [class.red]="!passed(drawn.build)">
                <span class="status">{{ word(drawn.build) }}</span>
                @if (drawn.build.gating) {
                  <span class="gating">gating</span>
                } @else {
                  <span class="not-gating">not gating — does not block this release</span>
                }
                <span class="branch">{{ drawn.build.branch }}</span>
                <span class="when" [title]="instant(drawn.build.finishedAt)">
                  {{ ago(drawn.build.finishedAt) }}
                </span>
                @if (drawn.href) {
                  <a class="run" [href]="drawn.href">the run in CI</a>
                }
              </li>
            }
          </ul>
        }
      </div>
      }

      @if (deployment(); as deployment) {
        <div class="gate deployment">
          <span class="name">{{ deployed() ? '✓ Deployment' : 'Deployment' }}</span>
          @if (deployed()) {
            <span class="decided">— live, and main carries this release</span>
          } @else if (released()) {
            <span class="waiting">— released, waiting on its deployment to go live</span>
          } @else {
            <span class="waiting">— answered after the tag, never before it</span>
          }
        </div>
      }

      @if (request().approvalRequired) {
        <div class="gate approval" [class.declined]="declined()">
          <span class="name">{{ approvalName() }}</span>
          @if (outstanding()) {
            <span class="waiting">— waiting for a person</span>
          } @else {
            <span class="decided" [title]="instant(request().approvedAt ?? null)">
              — {{ decision() }}
            </span>
          }
          @if (request().approvalNote; as note) {
            <p class="note">{{ note }}</p>
          }
        </div>

        @if (askable()) {
          <div class="ask">
            <input
              class="note-field"
              type="text"
              [value]="note()"
              (input)="noteTyped($event)"
              placeholder="A note (optional)"
              [attr.aria-label]="'A note on the decision about ' + request().summary"
            />
            <qits-button
              variant="primary"
              size="sm"
              [busy]="inFlight() === 'approve'"
              [disabled]="inFlight() !== null"
              (pressed)="press('approve')"
            >
              {{ pending() === 'approve' ? 'Confirm approve?' : 'Approve release' }}
            </qits-button>
            <qits-button
              variant="ghost"
              size="sm"
              [busy]="inFlight() === 'decline'"
              [disabled]="inFlight() !== null"
              (pressed)="press('decline')"
            >
              {{ pending() === 'decline' ? 'Confirm decline?' : 'Decline release' }}
            </qits-button>
            <span class="fold">of {{ fold() }}</span>
          </div>
        }

        @if (moved(); as moved) {
          <p class="moved" role="alert">{{ moved }}</p>
        }
        @if (failure(); as failure) {
          <p class="failed" role="alert">That decision was not recorded — {{ failure }}.</p>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .panel {
      margin-top: 0.9rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.4rem;
      background: #fff;
      padding: 0.6rem 0.75rem;
    }
    h2 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .gate {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.3rem 0.5rem;
      font-size: 0.85rem;
    }
    .gate + .gate {
      margin-top: 0.35rem;
      padding-top: 0.35rem;
      border-top: 1px solid #f3f4f6;
    }
    .name {
      min-width: 5rem;
      font-weight: 600;
      color: #111827;
    }
    .none,
    .waiting {
      color: #6b7280;
    }
    .no-gates {
      margin: 0 0 0.35rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .unknown {
      margin: 0 0 0.35rem;
      font-size: 0.85rem;
      color: #92400e;
    }
    .verdicts {
      list-style: none;
      margin: 0;
      padding: 0;
      flex: 1;
      min-width: 14rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .verdict {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .status {
      font-weight: 600;
      color: #047857;
    }
    .verdict.red .status {
      color: #b91c1c;
    }
    .gating,
    .not-gating,
    .branch,
    .when {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .branch {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
    }
    .run {
      font-size: 0.8rem;
      color: #1d4ed8;
    }
    .run:hover {
      text-decoration: underline;
    }
    .decided {
      color: #047857;
    }
    .approval.declined .decided {
      color: #92400e;
    }
    .note {
      flex-basis: 100%;
      margin: 0.15rem 0 0;
      color: #374151;
      overflow-wrap: anywhere;
    }
    .approval.declined {
      border-radius: 0.3rem;
      border: 1px solid #fcd34d;
      background: #fffbeb;
      padding: 0.3rem 0.45rem;
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
    .fold {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #6b7280;
    }
    .moved {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #92400e;
      overflow-wrap: anywhere;
    }
    .failed {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #b91c1c;
    }
  `,
})
export class ReleaseGatesPanel {
  private readonly api = inject(ReleaseRequestsApi);

  private readonly appLinks = inject(QitsAppLinks);

  readonly request = input.required<ReleaseRequestDto>();

  /**
   * The verdicts for this request's fold, **read by the host**. The panel takes them rather than
   * fetching them because the read is keyed on the fold and the page is what knows when the fold
   * moved — the same division the commits already have, and what keeps a panel redrawn by a six-second
   * poll from putting a request behind every tick.
   */
  readonly builds = input.required<readonly CommitBuildStatusDto[]>();

  /** The whole request as the service answered the decision, for the host to put in place of its own. */
  readonly decided = output<ReleaseRequestDto>();

  protected readonly none = NONE;
  protected readonly ago = (iso: string | null) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;

  /** The verdicts as drawn: newest first, which is the service's order and not this SPA's. */
  protected readonly verdicts = computed<readonly DrawnVerdict[]>(() =>
    this.builds().map((build) => ({
      build,
      // No scope: qits-ci serves `runs/:runId` at its own root and under no project address.
      href: this.appLinks.href('qits-ci', `runs/${encodeURIComponent(build.runId)}`),
    })),
  );

  /**
   * The gate set as the service reports it, or `undefined` from a service older than the field.
   *
   * <p>**`undefined` and `[]` are not the same answer and the whole panel turns on it.** An empty
   * array is a repository that configures no gate — releasable at once, and it should read that way
   * rather than looking unfinished. `undefined` is a service that does not report gates at all, where
   * the only honest thing to draw is what this panel drew before the field existed: the CI line and,
   * where `approvalRequired` says so, the approval one.
   */
  private readonly gates = computed(() => this.request().gates);

  /** One gate of the set, or null — `undefined` from an older service answers null for every kind. */
  private gate(kind: string): ReleaseGateDto | null {
    return this.gates()?.find((gate) => gate.kind === kind) ?? null;
  }

  /**
   * The configuration could not be read. Reported as every kind at `UNKNOWN`, never as an empty
   * list, and it is deliberately **not** drawn as a gate quietly in progress: nothing is pending,
   * because nothing is known.
   */
  protected readonly unknown = computed(() =>
    (this.gates() ?? []).some((gate) => gate.state === 'UNKNOWN'),
  );

  /** A repository that configures nothing. The third of the three new states a reader can see. */
  protected readonly nothingToWaitOn = computed(() => this.gates()?.length === 0);

  /**
   * Whether the CI line is drawn at all. An older service answers no gate set, and its requests are
   * all CI-gated by construction, so absence keeps the line.
   */
  protected readonly showCi = computed(
    () => !this.unknown() && (this.gates() === undefined || this.gate('CI') !== null),
  );

  protected readonly deployment = computed(() => (this.unknown() ? null : this.gate('DEPLOYMENT')));

  protected readonly deployed = computed(() => this.deployment()?.state === 'PASSED');

  protected readonly released = computed(() => this.request().state === 'RELEASED');

  protected readonly outstanding = computed(() => approvalOutstanding(this.request()));

  protected readonly declined = computed(() => this.request().approvalState === 'DECLINED');

  /**
   * The gate's own name, with the mark a decided gate carries in front of it. The tick and the cross
   * are on the *name* rather than beside the sentence so that the two gates line up down the left
   * edge and a reader can see which one is answered without reading either.
   */
  protected readonly approvalName = computed(() => {
    if (this.outstanding()) {
      return 'Approval';
    }
    return this.declined() ? '✗ Approval' : '✓ Approval';
  });

  /**
   * What was decided, by whom, and — for an approval — how long ago.
   *
   * <p>The decline deliberately does not carry the elapsed time. "declined 4m ago" invites the
   * reading that the decline is *stale* and might have expired, and it cannot: a decline stands until
   * a push re-folds the request, which is a change to content and not a passage of time. The exact
   * instant is on the tooltip for anybody who wants it.
   */
  protected readonly decision = computed(() => {
    const request = this.request();
    const who = request.approvedBy || NONE;
    return this.declined()
      ? `declined by ${who}`
      : `approved by ${who}, ${formatRelativeTime(request.approvedAt ?? null)}`;
  });

  /**
   * Whether the two buttons are offered — the decision being genuinely outstanding, and nothing
   * else. A concluded request keeps the *record* of what was decided and is offered no verb, which is
   * the same shape the withdraw keeps: the service refuses either way, and a control drawn to be
   * refused teaches a reader that this platform's buttons do not mean anything.
   */
  protected readonly askable = computed(() => awaitingApproval(this.request()));

  /** The fold this panel is drawn about, abbreviated — what the buttons will name. */
  protected readonly fold = computed(() => {
    const sha = this.request().mergedSha;
    return sha ? shortSha(sha) : this.none;
  });

  /** The button pressed once and asking to be pressed again — the house's confirmation. */
  protected readonly pending = signal<Decision | null>(null);

  protected readonly note = signal('');

  protected readonly inFlight = signal<Decision | null>(null);

  /** The fold moved under the reader, said as that rather than as an error. */
  protected readonly moved = signal<string | null>(null);

  protected readonly failure = signal<string | null>(null);

  protected passed(build: CommitBuildStatusDto): boolean {
    return build.status === 'SUCCESS';
  }

  /**
   * The verdict as a person reads it. qits-ci's vocabulary is open, so an unknown word is drawn as
   * itself with its underscores opened out — and treated as a refusal by {@link passed}, which is the
   * safe direction: a word this build has never heard of is far likelier to be a new way to fail than
   * a new way to succeed.
   */
  protected word(build: CommitBuildStatusDto): string {
    return (build.status || 'unknown').toLowerCase().replace(/_/g, ' ');
  }

  protected noteTyped(event: Event): void {
    this.note.set((event.target as HTMLInputElement).value);
  }

  /**
   * First press asks, second press sends — the same confirmation the withdraw uses, in the button
   * rather than in a browser dialog the page can neither style nor assert. Pressing the *other*
   * button while one is asking moves the question rather than answering it, which is why the pending
   * decision is a word and not a flag.
   */
  protected async press(decision: Decision): Promise<void> {
    if (this.pending() !== decision) {
      this.pending.set(decision);
      this.failure.set(null);
      this.moved.set(null);
      return;
    }
    // The sha this panel was RENDERED with, read before anything is awaited: that is the fold the
    // reader looked at and judged, and the difference between it and the row's current sha is the
    // whole reason the service takes one.
    const fold = this.request().mergedSha ?? '';
    const note = this.note();
    this.pending.set(null);
    this.inFlight.set(decision);
    this.failure.set(null);
    this.moved.set(null);
    const request = this.request();
    try {
      const answered =
        decision === 'approve'
          ? await this.api.approve(request.repoId, request.id, fold, note)
          : await this.api.decline(request.repoId, request.id, fold, note);
      this.note.set('');
      this.decided.emit(answered);
    } catch (error) {
      this.refused(error, fold);
    } finally {
      this.inFlight.set(null);
    }
  }

  /**
   * What a refusal is drawn as. **A 409 is not an error**: every one of them is the service saying
   * the request is not in the shape the reader thought it was, and the one that matters here — the
   * fold moved — is answered by looking at the new fold, not by retrying. So it is drawn in the
   * warning tone with the new sha named, the panel stays unapproved, and the page's own poll brings
   * the new fold in.
   *
   * <p>The new sha is taken out of the service's own sentence, which names it, and the sentence is
   * shown as it stands where no sha can be found — that covers the other four 409s (concluded,
   * already releasing, no fold at all, no gate on this repository) without pretending any of them is
   * a fold that moved.
   */
  private refused(error: unknown, fold: string): void {
    if (statusOf(error) !== 409) {
      this.failure.set(describeError(error));
      return;
    }
    const message = error instanceof HttpErrorResponse ? serverMessage(error.error) : null;
    const now = this.foldNamedBy(message, fold);
    this.moved.set(
      now
        ? `The fold changed while this was being read — this request is on ${shortSha(now)} now, ` +
            `not ${fold ? shortSha(fold) : this.none}. Nothing was decided; look at the new fold.`
        : (message ?? 'The service would not take that decision.'),
    );
  }

  /**
   * The sha the refusal names, or nothing. Matched as *any* commit-shaped token that is not the one
   * that was sent, rather than against the service's exact wording: the sentence is prose and this
   * SPA is deployed apart from the service that writes it, so keying on the phrasing would turn a
   * reworded message into a panel that says nothing.
   */
  private foldNamedBy(message: string | null, sent: string): string | null {
    for (const match of message?.matchAll(/\b[0-9a-f]{7,64}\b/g) ?? []) {
      if (match[0] !== sent) {
        return match[0];
      }
    }
    return null;
  }
}
