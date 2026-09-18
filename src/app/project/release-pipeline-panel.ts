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
import { QitsButton } from '@qits/ui-components';
import type {
  CommitBuildStatusDto,
  ReleasePhaseDto,
  ReleasePipelineGateDto,
  ReleasePipelinePhase,
  ReleaseRequestDto,
} from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { NONE, formatInstant, formatRelativeTime, shortSha } from '../ui/format';
import { describeError, serverMessage, statusOf } from '../ui/loadable';
import { ReleaseGatesPanel } from './release-gates-panel';
import { approvalOutstanding, awaitingApproval, hasReleased } from './release-requests-model';

/** Which of the two decisions a press is about — the same shape for the confirm and the flight. */
type Decision = 'approve' | 'decline';

/**
 * One gate as it is drawn: the name with its mark, the sentence beside it, and the tone it carries.
 *
 * <p>`tone` is a word rather than a colour for the reason the chrome's badge takes one: it is the
 * *meaning* — waiting, passed, refused, unreadable — and the stylesheet is the one place that decides
 * what each looks like. It is also what keeps the panel's single most important rule enforceable in
 * one place: `waiting` and `failed` are different tones, so a `PENDING` gate cannot accidentally be
 * drawn in the refusal colour.
 */
interface DrawnGate {
  /** `<between>:<kind>`, which is unique in a pipeline and is what the `@for` tracks by. */
  readonly key: string;
  /** The gate's name with the mark in front of it — `✓ Publish`, `✗ Approval`, `CI`. */
  readonly name: string;
  readonly tone: 'waiting' | 'passed' | 'failed' | 'unknown';
  /** What this gate says, as a sentence beginning with the em dash the gates panel uses. */
  readonly sentence: string;
  /** The service's own words about this gate, or null where it had nothing to add. */
  readonly detail: string | null;
  /** Whether the two decision buttons hang under this line. True on at most one gate. */
  readonly asks: boolean;
}

/** One phase row and the gates drawn under it. See {@link ReleasePipelinePanel} for the rules. */
interface DrawnPhase {
  readonly phase: ReleasePipelinePhase;
  /** `P1 · QA` — the ordinal and the name, which is what the sketch of this panel reads as. */
  readonly label: string;
  /** `├` on every row but the last, `└` on the last. Pure decoration; hidden from assistive tech. */
  readonly glyph: string;
  /** `│` where the tree continues below this row's gates, empty under the last row. */
  readonly trunk: string;
  /** `✓ SUCCESS`, `● RUNNING`, `○ pending`, `✗ FAILED`, … — the mark and the word in one string. */
  readonly mark: string;
  readonly tone: 'pending' | 'running' | 'success' | 'failed' | 'unsettled';
  /** The sentence a state that is neither plainly good nor plainly bad needs. Null where none is. */
  readonly sentence: string | null;
  /** Whether the rerun control is offered on this row — see the class note for the rule. */
  readonly rerunnable: boolean;
  /** What a rerun of this phase is called out loud, for the button and for nothing else. */
  readonly rerunLabel: string;
  readonly gates: readonly DrawnGate[];
}

/**
 * The three phases, in the order they happen, with what each is called on screen and what running it
 * again is called out loud.
 *
 * <p>The button's sentence is spelled per phase rather than composed from the name because one of the
 * three names is an initialism: "the QA phase" is right and "the Publish phase" is not, and a label
 * built by lower-casing would get the first wrong while a label built by pasting would get the other
 * two wrong. Three strings cost nothing and read correctly.
 */
const PHASE_ORDER: readonly {
  readonly phase: ReleasePipelinePhase;
  readonly name: string;
  readonly rerunLabel: string;
}[] = [
  { phase: 'QA', name: 'QA', rerunLabel: 'Run the QA phase again' },
  { phase: 'PUBLISH', name: 'Publish', rerunLabel: 'Run the publish phase again' },
  { phase: 'DEPLOY', name: 'Deployment', rerunLabel: 'Run the deployment phase again' },
];

/** What a gate kind is called. A kind this build has never heard of is drawn as itself instead. */
const GATE_NAMES: Readonly<Record<string, string>> = {
  CI: 'CI',
  APPROVAL: 'Approval',
  PUBLISH: 'Publish',
  DEPLOYMENT: 'Deployment',
};

/**
 * **The one release pipeline of a request**: three phases in the order they happen, with each gate
 * drawn on the edge between the two phases it separates.
 *
 * <p><b>Why this replaces a list of gates.</b> What a reader had before was two pipelines that were
 * never drawn as one thing: a set of gates in front of the tag, and a publish line and a deployment
 * line beside them answered *after* it, with nothing on the page saying that the second half only
 * happens because the first passed. Every question somebody actually brings to this page — where is
 * this, what is it waiting on, what do I press — is a question about a *sequence*, and a list cannot
 * answer it. The phases are the sequence; the gates are the conditions on the steps between them.
 *
 * <p><b>Every expected phase is drawn before it exists, as pending.</b> A phase the service has not
 * reported yet is absent from `phases`, and absent is rendered exactly as present-and-`PENDING`: the
 * publish phase of a request that has not been tagged is `○ pending`, not missing. The alternative is
 * a panel that grows rows as a release proceeds, which would make a reader read each new row as
 * something that had just been *added* to the release rather than as something that had always been
 * in front of it — and would hide, at the one moment it matters, that the release is not over when
 * the tag is cut.
 *
 * <p><b>QA and PUBLISH are always expected; DEPLOY is drawn on evidence.</b> Every release runs the
 * first two by construction. A deployment is a thing a repository *configures*, so the row is drawn
 * where the service reported a DEPLOY phase or where the pipeline carries a gate of kind
 * `DEPLOYMENT`, and a library with no deployment shows two phase rows rather than three. Drawing a
 * pending deployment row for a repository that will never deploy would be the same mistake the old
 * panel made with its gate lines, and the whole reason the gate set exists.
 *
 * <p><b>An unmet gate reads as WAITING and is never drawn as failing.</b> This is the model's whole
 * point and the one rule worth stating twice. `PENDING` means the gate has not answered: the pipeline
 * is holding in front of it, nothing has refused anything, and the right reading is "this is going to
 * happen". `FAILED` means something said no. `UNKNOWN` means nobody could read what it says. Three
 * facts, three tones, and the tone is derived in one place — {@link gateTone} — precisely so that a
 * new kind of gate cannot arrive and quietly be coloured as a refusal because it has not answered
 * yet. A platform that drew waiting as failing would report every healthy pipeline on it as broken
 * for as long as it was running.
 *
 * <p><b>No rerun button on a succeeded phase, and that absence is the sentence.</b> The old panel's
 * failed publish line said to retry with `qits ci retry` and offered nothing to press, because "the
 * retry is qits-ci's door, keyed on a run id this DTO does not carry". Both halves of that have
 * changed: the pipeline carries the run id, and — far more importantly — the door is addressed by
 * `(repoId, releaseRequestId, phase)` rather than by a run id at all. So the button *can* be drawn
 * for every phase, which is exactly what makes its absence mean something: a phase that has succeeded
 * is offered no verb, and the row says what it produced instead. That is the same rule the approval
 * keeps — a decided gate holds the record and is offered nothing — and it is the rule that stops this
 * platform's buttons from being things that exist to be refused.
 *
 * <p><b>The rule for when the rerun IS offered.</b> A phase is rerunnable when it is not `SUCCESS`
 * and something was actually started for it: `FAILED`, `CANCELLED` and `UNKNOWN` always, `RUNNING`
 * always — a run in flight is by definition a run that started, and a wedged one is the commonest
 * reason anybody opens this page — and `PENDING` only where the phase carries a `runId`, which is a
 * phase something was claimed for that has not moved. A `PENDING` phase with no run id has not begun,
 * and there is nothing there to run a second time; it will start when the phase in front of it
 * passes its gate, and a button on it would promise otherwise.
 *
 * <p><b>The rerun is ONE press, deliberately unlike the approval's two.</b> The house's confirm shape
 * belongs to verbs that *decide*: approve, decline and withdraw each write a judgement onto a release
 * and each is answered by somebody else's work. A rerun decides nothing. It re-asks a question the
 * pipeline already asked, it cannot un-release anything, the worst case is one more run of a job that
 * was going to be run anyway, and it is very often pressed against a phase that is wedged — which is
 * the moment a second press is least welcome. Two presses are protection against a mistake with a
 * cost; this one has none worth guarding, and a confirmation that guards nothing teaches a reader to
 * click through the ones that do.
 *
 * <p><b>A rerun refusal is drawn in the row it was pressed in, calmly, and never as a toast</b> — the
 * established rule here, and the same reading the approval's 409 gets: the service saying the phase
 * has already succeeded, or has not been reached, or is running this moment is not a failure, it is a
 * page that went stale under its reader. Anything that is not a 409 is reported as the failure it is.
 *
 * <p><b>The approval lives on the `QA_PUBLISH` gate line, because that is what it is.</b> It is the
 * condition on the step from QA to publish, so the note field, the two-press confirm and the
 * `mergedSha`-of-the-rendered-fold body all sit under that one line. The fold that travels with the
 * decision is the fold this panel was **rendered** with, read before anything is awaited: an approval
 * is a statement about content, and a push that landed while the page was open is answered 409 naming
 * the fold the request is on now. That refusal is drawn as what it is — the fold moved under the
 * reader — and the gate goes back to waiting rather than reporting an error.
 *
 * <p><b>An absent pipeline delegates to the gate panel rather than re-implementing it.</b> A service
 * build older than the field answers no `pipeline`, and that must render exactly what it rendered
 * yesterday. The honest way to guarantee "exactly" is not to re-derive the old view here — a second
 * implementation drifts, and the day it drifts is a day nobody is looking — but to draw the *same
 * component*, which is what this panel does. The host is then one element with one wiring whichever
 * service build answered it, and the legacy path is unchanged by construction rather than by
 * assertion.
 *
 * <p><b>The tree glyphs are decoration and are hidden from the reading.</b> `├ │ └ ⟂ ·` and the
 * terminal `→` are what makes the sequence legible on screen, and they are noise — or worse, garble —
 * to anybody reading this panel through assistive technology, which is why every one of them is
 * `aria-hidden` and every row says what it is in words beside them.
 */
@Component({
  selector: 'app-release-pipeline-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, ReleaseGatesPanel],
  template: `
    @if (pipeline()) {
      <section class="panel pipeline">
        <header class="head">
          <h2>Release pipeline</h2>
          <span class="request-state">{{ request().state }}</span>
        </header>

        @for (phase of phases(); track phase.phase) {
          <div class="phase" [class]="'is-' + phase.tone">
            <span class="glyph" aria-hidden="true">{{ phase.glyph }}</span>
            <span class="name">{{ phase.label }}</span>
            <span class="mark">{{ phase.mark }}</span>
            @if (phase.rerunnable) {
              <qits-button
                variant="ghost"
                size="sm"
                [busy]="rerunning() === phase.phase"
                [disabled]="rerunning() !== null"
                (pressed)="rerun(phase.phase)"
              >
                <span class="rerun-glyph" aria-hidden="true">⟳</span>
                {{ phase.rerunLabel }}
              </qits-button>
            }
          </div>

          @if (phase.sentence) {
            <p class="phase-said">{{ phase.sentence }}</p>
          }

          @if (refusalFor(phase.phase); as refusal) {
            <p class="refused" role="alert">{{ refusal }}</p>
          }
          @if (failureFor(phase.phase); as failure) {
            <p class="failed" role="alert">That phase was not run again — {{ failure }}.</p>
          }

          @for (gate of phase.gates; track gate.key) {
            <div class="gate" [class]="'is-' + gate.tone">
              <span class="glyph" aria-hidden="true">{{ phase.trunk }}</span>
              <span class="glyph joint" aria-hidden="true">⟂</span>
              <span class="gate-name">{{ gate.name }}</span>
              <span class="gate-said">{{ gate.sentence }}</span>
              @if (gate.detail) {
                <p class="detail">{{ gate.detail }}</p>
              }
            </div>

            @if (gate.asks) {
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

              @if (moved(); as moved) {
                <p class="moved" role="alert">{{ moved }}</p>
              }
              @if (failure(); as failure) {
                <p class="failed" role="alert">That decision was not recorded — {{ failure }}.</p>
              }
            }
          }
        }

        <p class="terminal" [title]="instant(request().mergedToMainAt)">
          <span class="glyph" aria-hidden="true">→</span>
          <span class="gate-name">{{ terminalName() }}</span>
          <span class="gate-said">{{ terminalSentence() }}</span>
        </p>
      </section>
    } @else {
      <!--
        No pipeline: a service build older than the field, or one with none to report. The legacy
        view is drawn by the legacy component itself rather than re-derived here, so "unchanged" is
        guaranteed rather than asserted — and the host keeps one element and one wiring either way.
      -->
      <app-release-gates-panel
        [request]="request()"
        [builds]="builds()"
        (decided)="decided.emit($event)"
      />
    }
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
    .head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    h2 {
      flex: 1;
      min-width: 8rem;
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .request-state {
      font-size: 0.8rem;
      font-weight: 600;
      color: #6b7280;
    }
    .phase {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.3rem 0.5rem;
      font-size: 0.85rem;
    }
    .glyph {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #6b7280;
      white-space: pre;
    }
    .joint {
      margin-left: 1rem;
    }
    .name {
      min-width: 9rem;
      font-weight: 600;
      color: #111827;
    }
    .mark {
      font-weight: 600;
      color: #6b7280;
    }
    .phase.is-success .mark {
      color: #047857;
    }
    .phase.is-failed .mark {
      color: #b91c1c;
    }
    .phase.is-running .mark {
      color: #1d4ed8;
    }
    .phase.is-unsettled .mark {
      color: #92400e;
    }
    .phase-said {
      margin: 0.1rem 0 0 1rem;
      font-size: 0.85rem;
      color: #92400e;
      overflow-wrap: anywhere;
    }
    .gate {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.3rem 0.4rem;
      margin-top: 0.15rem;
      font-size: 0.85rem;
    }
    .gate-name {
      min-width: 6rem;
      font-weight: 600;
      color: #111827;
    }
    .gate-said {
      flex: 1;
      min-width: 12rem;
      color: #6b7280;
    }
    .gate.is-passed .gate-said {
      color: #047857;
    }
    .gate.is-failed .gate-said {
      color: #b91c1c;
    }
    .gate.is-unknown .gate-said {
      color: #92400e;
    }
    .detail {
      flex-basis: 100%;
      margin: 0.15rem 0 0 1.4rem;
      color: #374151;
      overflow-wrap: anywhere;
    }
    .terminal {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.3rem 0.4rem;
      margin: 0.4rem 0 0;
      padding-top: 0.35rem;
      border-top: 1px solid #f3f4f6;
      font-size: 0.85rem;
    }
    .rerun-glyph {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ask {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.45rem 0 0 1.4rem;
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
    .moved,
    .refused {
      margin: 0.35rem 0 0 1.4rem;
      border-radius: 0.3rem;
      border: 1px solid #fcd34d;
      background: #fffbeb;
      padding: 0.3rem 0.45rem;
      font-size: 0.85rem;
      color: #92400e;
      overflow-wrap: anywhere;
    }
    .failed {
      margin: 0.35rem 0 0 1.4rem;
      font-size: 0.85rem;
      color: #b91c1c;
    }
  `,
})
export class ReleasePipelinePanel {
  private readonly api = inject(ReleaseRequestsApi);

  readonly request = input.required<ReleaseRequestDto>();

  /**
   * The verdicts for this request's fold, **read by the host** — the gates panel's contract, kept
   * word for word because it is delegated to with exactly these.
   *
   * <p>The panel takes them rather than fetching them because the read is keyed on the fold and the
   * page is what knows when the fold moved — the same division the commits already have, and what
   * keeps a panel redrawn by a six-second poll from putting a request behind every tick.
   */
  readonly builds = input.required<readonly CommitBuildStatusDto[]>();

  /**
   * The whole request as the service answered it, for the host to put in place of its own row.
   *
   * <p>One output for three verbs — an approval, a decline and a rerun — because all three answer the
   * same thing: the request, whole, with its pipeline already recomputed. The host swaps its row in
   * and asks for nothing further, which is exactly what it does today; a second output per verb would
   * be three wirings for one act.
   */
  readonly decided = output<ReleaseRequestDto>();

  protected readonly none = NONE;
  protected readonly instant = formatInstant;

  /**
   * The pipeline the service reported, or null for one that reported none.
   *
   * <p>`undefined` and `null` are folded together here on purpose, and it is the one place they are:
   * a service too old to have the field and a service that had no pipeline to give are two causes of
   * one fact — there is no pipeline to draw — and every reader below wants that fact rather than its
   * provenance. What follows from it is the delegation, which is the same answer for both.
   */
  protected readonly pipeline = computed(() => this.request().pipeline ?? null);

  /** The phases as the service reported them, by name, so an absent one can be told from a pending one. */
  private readonly reported = computed(() => {
    const byPhase = new Map<ReleasePipelinePhase, ReleasePhaseDto>();
    for (const phase of this.pipeline()?.phases ?? []) {
      byPhase.set(phase.phase, phase);
    }
    return byPhase;
  });

  private readonly gates = computed<readonly ReleasePipelineGateDto[]>(
    () => this.pipeline()?.gates ?? [],
  );

  /**
   * Whether the deployment row is drawn at all.
   *
   * <p>Two pieces of evidence, either of which is enough: the service reported a `DEPLOY` phase, or
   * the pipeline carries a gate of kind `DEPLOYMENT`. The second is what makes the row appear before
   * the pipeline has got anywhere near it — a repository that deploys says so in its configuration
   * long before there is a deployment to report — and the first is what keeps the row where a service
   * reports the phase and nothing else. Neither alone is the answer, and their absence is: a
   * repository that deploys nothing shows two phase rows, and drawing it a third that will never
   * happen would be inventing a wait.
   */
  protected readonly deploys = computed(
    () => this.reported().has('DEPLOY') || this.gates().some((gate) => gate.kind === 'DEPLOYMENT'),
  );

  /** The tag is cut — what turns the after-the-tag phases from "later" into "now". Both states count. */
  protected readonly released = computed(() => hasReleased(this.request()));

  protected readonly outstanding = computed(() => approvalOutstanding(this.request()));

  protected readonly declined = computed(() => this.request().approvalState === 'DECLINED');

  /**
   * Whether the two decision buttons are offered — the decision being genuinely outstanding on a
   * repository that requires one, and nothing else.
   *
   * <p>The same reading the gates panel keeps, and kept for the same reason: the service answers 409
   * to approving what has no gate or what has already concluded, so a control offered anywhere else
   * would be a control that exists to be refused.
   */
  protected readonly askable = computed(
    () => this.request().approvalRequired === true && awaitingApproval(this.request()),
  );

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

  /** The phase whose rerun is in flight, so exactly one button is busy and the rest are inert. */
  protected readonly rerunning = signal<ReleasePipelinePhase | null>(null);

  /**
   * The calm refusal of a rerun, and the phase it belongs to — held as a pair because it is drawn
   * **in the row it was pressed in**. A message with no phase on it would have to be drawn somewhere
   * general, which is the toast this panel does not have.
   */
  private readonly refusal = signal<{
    readonly phase: ReleasePipelinePhase;
    readonly message: string;
  } | null>(null);

  /** The same pair for a rerun that genuinely failed, kept apart so a 409 is never reported as one. */
  private readonly rerunFailure = signal<{
    readonly phase: ReleasePipelinePhase;
    readonly message: string;
  } | null>(null);

  /**
   * Every phase row, in order, drawn whether or not the service has reported it.
   *
   * <p>The list is composed from {@link PHASE_ORDER} rather than from the answer, which is what makes
   * "drawn before it exists" true: a phase the service has not got to is materialised as `PENDING`
   * with no run behind it. The one row that is conditional is the deployment — see {@link deploys}.
   */
  protected readonly phases = computed<readonly DrawnPhase[]>(() => {
    const expected = PHASE_ORDER.filter(
      (entry) => entry.phase !== 'DEPLOY' || this.deploys(),
    );
    return expected.map((entry, index) => {
      const last = index === expected.length - 1;
      const reported = this.reported().get(entry.phase) ?? null;
      const state = reported?.state ?? 'PENDING';
      return {
        phase: entry.phase,
        label: `P${index + 1} · ${entry.name}`,
        glyph: last ? '└' : '├',
        trunk: last ? ' ' : '│',
        mark: this.phaseMark(state),
        tone: this.phaseTone(state),
        sentence: this.phaseSentence(state),
        rerunnable: this.rerunnable(state, reported?.runId ?? null),
        rerunLabel: entry.rerunLabel,
        gates: this.gatesUnder(entry.phase, last),
      } satisfies DrawnPhase;
    });
  });

  /** The refusal to draw in one row, or nothing. */
  protected refusalFor(phase: ReleasePipelinePhase): string | null {
    const refusal = this.refusal();
    return refusal && refusal.phase === phase ? refusal.message : null;
  }

  /** The genuine failure to draw in one row, or nothing. */
  protected failureFor(phase: ReleasePipelinePhase): string | null {
    const failure = this.rerunFailure();
    return failure && failure.phase === phase ? failure.message : null;
  }

  /**
   * The terminal line's name, marked exactly as a gate's is: a tick once the tag is on `main`, and
   * the bare word while it is not. It is drawn from `mergedToMainAt` rather than from the
   * `DEPLOY_FINALIZED` gate because that instant **is** the end of the lifecycle — the gate says what
   * is still in the way of it.
   */
  protected readonly terminalName = computed(() =>
    this.request().mergedToMainAt ? '✓ FINALIZED' : 'FINALIZED',
  );

  /**
   * What the terminal line says: when the release finished, or what the last gate is holding it on,
   * or — before the tag — the plain fact that the merge to `main` is what ends this.
   */
  protected readonly terminalSentence = computed(() => {
    const at = this.request().mergedToMainAt;
    if (at) {
      return `— the tag is on main and this release is finished, ${formatRelativeTime(at)}`;
    }
    return this.released()
      ? '— released, waiting for the tag to reach main'
      : '— the tag reaches main once everything this release promised has happened';
  });

  /**
   * The gates drawn under one phase row.
   *
   * <p>`QA_PUBLISH` sits under QA and `PUBLISH_DEPLOY` under publish, which is the edge each names.
   * `DEPLOY_FINALIZED` sits under the deployment row where there is one and under the **last drawn
   * row** where there is not: a repository that deploys nothing can still be gated on its way out,
   * and a gate with no row to hang under would simply vanish — which is the one outcome a panel about
   * what is holding a release must never produce.
   */
  private gatesUnder(phase: ReleasePipelinePhase, last: boolean): readonly DrawnGate[] {
    const edges = new Set<ReleasePipelineGateDto['between']>();
    if (phase === 'QA') edges.add('QA_PUBLISH');
    if (phase === 'PUBLISH') edges.add('PUBLISH_DEPLOY');
    if (phase === 'DEPLOY' || last) edges.add('DEPLOY_FINALIZED');
    return this.gates()
      .filter((gate) => edges.has(gate.between))
      .map((gate) => this.drawGate(gate));
  }

  /** One gate, with its mark, its tone and the sentence its kind and state come to. */
  private drawGate(gate: ReleasePipelineGateDto): DrawnGate {
    const tone = this.gateTone(gate.state);
    const name = this.gateName(gate.kind);
    const asks = gate.kind === 'APPROVAL' && gate.between === 'QA_PUBLISH' && this.askable();
    return {
      key: `${gate.between}:${gate.kind}`,
      name: this.markedName(name, tone),
      tone,
      sentence: this.gateSentence(gate, tone),
      detail: gate.detail?.trim() || null,
      asks,
    };
  }

  /**
   * What a gate's state means, in four words and no more.
   *
   * <p><b>`PENDING` answers `waiting` and nothing else does.</b> The mapping is here, once, so that
   * the panel's central rule is a single line of code rather than a habit spread over a template: a
   * gate that has not answered is not a refusal, and a word this build has never heard of is
   * `unknown` — drawn in the tone of "nobody could read this" rather than guessed into either a pass
   * or a no. Guessing green would say a release is clear when nobody knows; guessing red would report
   * a healthy repository as broken. Neither is honest, and the third answer is.
   */
  private gateTone(state: string): DrawnGate['tone'] {
    switch (state) {
      case 'PASSED':
        return 'passed';
      case 'FAILED':
        return 'failed';
      case 'PENDING':
        return 'waiting';
      default:
        return 'unknown';
    }
  }

  /**
   * The gate's name with its mark **in front of it**, which is the gates panel's own placement and
   * not a detail: the tick and the cross are on the name rather than beside the sentence so that
   * every gate lines up down one edge and a reader can see which are answered without reading any of
   * them. A gate that has not answered carries no mark at all — a waiting gate is not a third symbol,
   * it is the absence of a verdict.
   */
  private markedName(name: string, tone: DrawnGate['tone']): string {
    if (tone === 'passed') {
      return `✓ ${name}`;
    }
    return tone === 'failed' ? `✗ ${name}` : name;
  }

  /** The gate's name. A kind this build has never heard of is drawn as itself, opened out. */
  private gateName(kind: string): string {
    return GATE_NAMES[kind] ?? (kind || 'gate').replace(/_/g, ' ');
  }

  /**
   * What one gate says, in the gates panel's own vocabulary — deliberately the same words, because a
   * second wording for the same fact would be the split this panel exists to end.
   *
   * <p>Every `waiting` sentence is phrased as a wait and none of them as a problem; the approval's
   * decided line is the gates panel's `decision`, which carries the decline as well as the approval
   * and deliberately leaves the elapsed time off the decline.
   */
  private gateSentence(gate: ReleasePipelineGateDto, tone: DrawnGate['tone']): string {
    if (gate.kind === 'APPROVAL' && (tone === 'passed' || tone === 'failed')) {
      return `— ${this.decision()}`;
    }
    if (tone === 'unknown') {
      return gate.state === 'UNKNOWN' || !gate.state
        ? '— what this gate says could not be read. The request is held, and nothing has refused it.'
        : `— ${gate.state.toLowerCase().replace(/_/g, ' ')}`;
    }
    const waiting = tone === 'waiting';
    switch (gate.kind) {
      case 'CI':
        return waiting
          ? '— waiting on a build of this fold'
          : tone === 'passed'
            ? '— every build of this fold is green'
            : '— a build of this fold went red. That is content: a push onto a ' +
              'participating branch re-folds the request and asks again.';
      case 'APPROVAL':
        return '— waiting for a person';
      case 'PUBLISH':
        return waiting
          ? this.released()
            ? '— released, waiting on the release pipeline of this tag'
            : '— answered after the tag, never before it'
          : tone === 'passed'
            ? '— the release pipeline of this tag is green'
            : '— the release pipeline of this tag failed. That is the environment rather than a ' +
              'refusal, and this request stays open until it goes green.';
      case 'DEPLOYMENT':
        return waiting
          ? this.released()
            ? '— released, waiting on its deployment to go live'
            : '— answered after the tag, never before it'
          : tone === 'passed'
            ? '— live, and main carries this release'
            : '— the deployment of this release did not go live, and this request stays open ' +
              'until it does.';
      default:
        return waiting
          ? '— waiting on this gate; nothing has refused the release'
          : tone === 'passed'
            ? '— answered, and it passed'
            : '— this gate refused the release';
    }
  }

  /**
   * What was decided, by whom, and — for an approval — how long ago. The gates panel's sentence,
   * carried over whole, including the reason the decline has no elapsed time on it: "declined 4m ago"
   * invites the reading that the decline is stale and might have expired, and it cannot — a decline
   * stands until a push re-folds the request, which is a change to content and not a passage of time.
   */
  private decision(): string {
    const request = this.request();
    const who = request.approvedBy || NONE;
    return this.declined()
      ? `declined by ${who}`
      : `approved by ${who}, ${formatRelativeTime(request.approvedAt ?? null)}`;
  }

  /** The mark and the word one phase state is drawn as. */
  private phaseMark(state: ReleasePhaseDto['state']): string {
    switch (state) {
      case 'SUCCESS':
        return '✓ SUCCESS';
      case 'RUNNING':
        return '● RUNNING';
      case 'FAILED':
        return '✗ FAILED';
      case 'CANCELLED':
        return '✗ CANCELLED';
      case 'UNKNOWN':
        return '○ UNKNOWN';
      default:
        return '○ pending';
    }
  }

  private phaseTone(state: ReleasePhaseDto['state']): DrawnPhase['tone'] {
    switch (state) {
      case 'SUCCESS':
        return 'success';
      case 'RUNNING':
        return 'running';
      case 'FAILED':
        return 'failed';
      case 'CANCELLED':
      case 'UNKNOWN':
        return 'unsettled';
      default:
        return 'pending';
    }
  }

  /**
   * The sentence a phase whose mark cannot speak for itself needs.
   *
   * <p>`SUCCESS`, `RUNNING`, `FAILED` and `pending` are each one word a reader already knows what to
   * do with. `CANCELLED` and `UNKNOWN` are not: the first is a phase that stopped without answering
   * and the second is a phase whose answer nobody could read, and a reader shown either as a bare
   * word would have to guess whether the release had been refused. It has not been, in both cases,
   * and the sentence says so out loud — which is the same care the old panel took over an `UNKNOWN`
   * gate configuration.
   */
  private phaseSentence(state: ReleasePhaseDto['state']): string | null {
    if (state === 'CANCELLED') {
      return (
        'This phase was cancelled before it answered. Nothing refused the release, and nothing ' +
        'happens here until it is run again.'
      );
    }
    if (state === 'UNKNOWN') {
      return (
        'What this phase came to could not be read, so nothing about it is known. The request is ' +
        'held — nothing has refused it — and running the phase again is what settles it.'
      );
    }
    return null;
  }

  /** See the class note: not `SUCCESS`, and something was actually started for it. */
  private rerunnable(state: ReleasePhaseDto['state'], runId: string | null): boolean {
    if (state === 'SUCCESS') {
      return false;
    }
    return state !== 'PENDING' || runId !== null;
  }

  protected noteTyped(event: Event): void {
    this.note.set((event.target as HTMLInputElement).value);
  }

  /**
   * Run one phase again — **one press**, for the reason the class note argues at length: a rerun
   * decides nothing, so it is not one of the verbs the house's two-press confirm is for.
   *
   * <p>The refusal and the failure of any *previous* press are cleared first, so what is on screen is
   * always about the press that is in flight rather than about one the reader has already answered.
   */
  protected async rerun(phase: ReleasePipelinePhase): Promise<void> {
    if (this.rerunning() !== null) {
      return;
    }
    this.refusal.set(null);
    this.rerunFailure.set(null);
    this.rerunning.set(phase);
    const request = this.request();
    try {
      this.decided.emit(await this.api.rerun(request.repoId, request.id, phase));
    } catch (error) {
      if (statusOf(error) === 409) {
        const message = error instanceof HttpErrorResponse ? serverMessage(error.error) : null;
        this.refusal.set({
          phase,
          message:
            message ??
            'The service would not run that phase again. Nothing changed; the page may have gone ' +
              'stale under you.',
        });
      } else {
        this.rerunFailure.set({ phase, message: describeError(error) });
      }
    } finally {
      this.rerunning.set(null);
    }
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
   * What a refusal of a decision is drawn as. **A 409 is not an error**: every one of them is the
   * service saying the request is not in the shape the reader thought it was, and the one that
   * matters here — the fold moved — is answered by looking at the new fold, not by retrying. So it is
   * drawn in the warning tone with the new sha named, the gate stays unapproved, and the page's own
   * poll brings the new fold in.
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
