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
import type {
  ReleaseAutomationDto,
  ReleaseAutomationFailureDto,
  ReleaseRequestDto,
} from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { NONE, shortSha } from '../ui/format';
import { describeError, serverMessage, statusOf } from '../ui/loadable';
import { Viewer } from '../ui/viewer';

/** The states a repository's own operator may press Re-run on — a run that is not already live. */
const AUTOMATION_RERUNNABLE_STATES: ReadonlySet<string> = new Set(['FAILED', 'UNKNOWN', 'FRESH']);

/**
 * The release-request automations of one request (qits-978), one row each, with Re-run on the states
 * a fresh run means something for and Waive for whoever may press it.
 *
 * <p><b>One component, two hosts.</b> The gates panel draws it inside its AUTOMATIONS line and the
 * pipeline panel draws it under the `QA_PUBLISH` · `AUTOMATIONS` gate (qits-1116). It used to live
 * inline in the gates panel alone, and the pipeline panel — which every current service answers with
 * — therefore drew a red AUTOMATIONS gate with nothing under it saying which automation failed or
 * what to press. A second copy of the rows would drift; one component cannot.
 *
 * <p><b>A failed row says why, where the service says so.</b> `failure` names the step, the image it
 * ran in and its exit code, and carries the tail of its log, which is drawn as it was printed. A
 * failed row without one — a service build older than the field, or a run with nothing kept — still
 * carries the link to its run and the Re-run, so it is never a dead end.
 *
 * <p><b>The rows are drawn; the gate's own name is the host's.</b> Each host marks the gate in its own
 * way, so this component draws only what sits under the name.
 *
 * <p>An anchor whose href this platform cannot spell is dropped, never drawn dead. The run link is
 * composed with **no scope**: qits-ci serves `runs/:runId` at its own root.
 */
@Component({
  selector: 'app-release-automations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    @if (automations().length === 0) {
      <span class="decided">— nothing applies to this repository</span>
    } @else {
      <ul class="automation-rows">
        @for (row of automations(); track row.kind) {
          <li class="automation-row" [class.red]="automationFailed(row)">
            <div class="line">
              <span class="label">{{ row.label }}</span>
              <span class="state">{{ automationSentence(row) }}</span>
              @if (automationHref(row); as href) {
                <a class="run" [href]="href">the run in CI</a>
              }
              @if (canRerunAutomation(row)) {
                <qits-button
                  variant="ghost"
                  size="sm"
                  [busy]="isRerunning(row.kind)"
                  [disabled]="isRerunning(row.kind)"
                  (pressed)="rerunAutomation(row)"
                >
                  Re-run
                </qits-button>
              }
              @if (rerunMessage(row.kind); as message) {
                <span class="rerun-message">{{ message }}</span>
              }
            </div>
            @if (failureOf(row); as failure) {
              <p class="failure-step">{{ failureLine(failure) }}</p>
              @if (failure.excerpt) {
                <pre class="excerpt">{{ failure.excerpt }}</pre>
              }
            }
          </li>
        }
      </ul>
    }

    @if (admin()) {
      <div class="waive">
        @if (!waiving()) {
          <qits-button variant="ghost" size="sm" (pressed)="startWaive()">
            Waive for this fold
          </qits-button>
        } @else {
          <input
            class="waive-reason"
            type="text"
            [value]="waiveReason()"
            (input)="waiveReasonTyped($event)"
            placeholder="Why this fold is waived"
            [attr.aria-label]="'A reason for waiving automations on ' + request().summary"
          />
          <qits-button
            variant="primary"
            size="sm"
            [busy]="waiveBusy()"
            [disabled]="waiveBusy() || !waiveReason().trim()"
            (pressed)="confirmWaive()"
          >
            Confirm waive
          </qits-button>
          <qits-button variant="ghost" size="sm" [disabled]="waiveBusy()" (pressed)="cancelWaive()">
            Cancel
          </qits-button>
          <span class="fold">of {{ fold() }}</span>
        }
      </div>
      @if (waiveMoved(); as moved) {
        <p class="moved" role="alert">{{ moved }}</p>
      }
      @if (waiveFailure(); as failure) {
        <p class="failed" role="alert">That waiver was not recorded — {{ failure }}.</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
      min-width: 14rem;
      font-size: 0.85rem;
    }
    .automation-rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .line {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .label {
      font-weight: 600;
      color: #111827;
    }
    .state {
      color: #047857;
    }
    .automation-row.red .state {
      color: #b91c1c;
    }
    .run {
      font-size: 0.8rem;
      color: #1d4ed8;
    }
    .run:hover {
      text-decoration: underline;
    }
    .rerun-message {
      font-size: 0.8rem;
      color: #92400e;
    }
    .failure-step {
      margin: 0.15rem 0 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #b91c1c;
      overflow-wrap: anywhere;
    }
    .excerpt {
      margin: 0.2rem 0 0;
      max-height: calc(6 * 1.35em + 0.7rem);
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.35;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: #111827;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      padding: 0.35rem 0.45rem;
    }
    .decided {
      color: #047857;
    }
    .waive {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.45rem;
    }
    .waive-reason {
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
export class ReleaseAutomations {
  private readonly api = inject(ReleaseRequestsApi);

  private readonly appLinks = inject(QitsAppLinks);

  private readonly viewer = inject(Viewer);

  readonly request = input.required<ReleaseRequestDto>();

  /** The whole request as the service answered a waiver, for the host to put in place of its own. */
  readonly decided = output<ReleaseRequestDto>();

  protected readonly none = NONE;

  /** The rows as the service reported them; absent and null both draw as the empty answer. */
  protected readonly automations = computed<readonly ReleaseAutomationDto[]>(
    () => this.request().automations ?? [],
  );

  /**
   * **Whether this browser session may press the automations waiver** — the same assumption the
   * approve and decline verbs are offered on, read through {@link Viewer}.
   */
  protected readonly admin = this.viewer.admin;

  /** The fold this component is drawn about, abbreviated — what the waiver will name. */
  protected readonly fold = computed(() => {
    const sha = this.request().mergedSha;
    return sha ? shortSha(sha) : this.none;
  });

  protected automationFailed(row: ReleaseAutomationDto): boolean {
    return row.state === 'FAILED';
  }

  /**
   * The row's own sentence — the label is drawn beside it, never repeated in it. Three of the
   * states carry their detail in a shape of their own (qits-1001's own examples): `FRESH` in
   * parentheses, `COMMITTED` after a semicolon, `FAILED` after a colon. Every other state, known or
   * not, is the bare word with its detail, if any, set off by a dash.
   */
  protected automationSentence(row: ReleaseAutomationDto): string {
    const word = (row.state || 'unknown').toLowerCase().replace(/_/g, ' ');
    const detail = row.detail?.trim() || null;
    if (!detail) {
      return word;
    }
    switch (row.state) {
      case 'FRESH':
        return `${word} (${detail})`;
      case 'COMMITTED':
        return `${word}; ${detail}`;
      case 'FAILED':
        return `${word}: ${detail}`;
      default:
        return `${word} — ${detail}`;
    }
  }

  /** The run link, composed exactly as the CI verdict's is: `runs/:runId`, no scope. */
  protected automationHref(row: ReleaseAutomationDto): string | undefined {
    return row.runId
      ? this.appLinks.href('qits-ci', `runs/${encodeURIComponent(row.runId)}`)
      : undefined;
  }

  /** The failure to draw under a row: only a `FAILED` row's, and only where the service sent one. */
  protected failureOf(row: ReleaseAutomationDto): ReleaseAutomationFailureDto | null {
    return row.state === 'FAILED' ? (row.failure ?? null) : null;
  }

  /**
   * `step 2 · maven-base:latest · exit 1` — the step, the image by its short name, and the exit code
   * where there is one. The registry and the path in front of the image are noise beside a log
   * excerpt: the name and tag are what a reader recognises.
   */
  protected failureLine(failure: ReleaseAutomationFailureDto): string {
    const parts = [`step ${failure.stepIndex}`, imageShortName(failure.image)];
    if (failure.exitCode !== null && failure.exitCode !== undefined) {
      parts.push(`exit ${failure.exitCode}`);
    }
    return parts.join(' · ');
  }

  /** Re-run is offered on exactly the states a fresh run can mean something for. */
  protected canRerunAutomation(row: ReleaseAutomationDto): boolean {
    return AUTOMATION_RERUNNABLE_STATES.has(row.state);
  }

  /** The kind currently in flight, so only its own button shows busy. */
  protected readonly rerunBusyKind = signal<string | null>(null);

  protected isRerunning(kind: string): boolean {
    return this.rerunBusyKind() === kind;
  }

  /** Per-kind messages a rerun attempt left behind — "one is already running", or a real failure. */
  protected readonly rerunMessages = signal<Readonly<Record<string, string>>>({});

  protected rerunMessage(kind: string): string | null {
    return this.rerunMessages()[kind] ?? null;
  }

  /**
   * Run one automation again, now — the forwarded door. A 409 means one is already in flight for
   * this (request, kind), which is drawn calmly rather than retried; the row itself updates on the
   * page's own poll once the run settles.
   */
  protected async rerunAutomation(row: ReleaseAutomationDto): Promise<void> {
    const request = this.request();
    this.rerunBusyKind.set(row.kind);
    this.setRerunMessage(row.kind, null);
    try {
      await this.api.rerunAutomation(request.repoId, request.id, row.kind);
    } catch (error) {
      this.setRerunMessage(
        row.kind,
        statusOf(error) === 409 ? 'one is already running' : describeError(error),
      );
    } finally {
      this.rerunBusyKind.set(null);
    }
  }

  private setRerunMessage(kind: string, message: string | null): void {
    this.rerunMessages.update((current) => {
      const next = { ...current };
      if (message) {
        next[kind] = message;
      } else {
        delete next[kind];
      }
      return next;
    });
  }

  /** Whether the waiver's reason field is open — the house's first-press-asks shape. */
  protected readonly waiving = signal(false);

  protected readonly waiveReason = signal('');

  protected readonly waiveBusy = signal(false);

  /** The fold moved under the reader, said as that rather than as an error. */
  protected readonly waiveMoved = signal<string | null>(null);

  protected readonly waiveFailure = signal<string | null>(null);

  protected startWaive(): void {
    this.waiving.set(true);
    this.waiveReason.set('');
    this.waiveMoved.set(null);
    this.waiveFailure.set(null);
  }

  protected cancelWaive(): void {
    this.waiving.set(false);
    this.waiveReason.set('');
  }

  protected waiveReasonTyped(event: Event): void {
    this.waiveReason.set((event.target as HTMLInputElement).value);
  }

  /**
   * Send the waiver — the sha this component was RENDERED with, exactly as an approval sends, and
   * for the same reason: that is the fold the reader looked at and judged.
   */
  protected async confirmWaive(): Promise<void> {
    const reason = this.waiveReason().trim();
    if (!reason) {
      return;
    }
    const request = this.request();
    const fold = request.mergedSha ?? '';
    this.waiveBusy.set(true);
    this.waiveMoved.set(null);
    this.waiveFailure.set(null);
    try {
      const answered = await this.api.waiveAutomations(request.repoId, request.id, fold, reason);
      this.waiving.set(false);
      this.waiveReason.set('');
      this.decided.emit(answered);
    } catch (error) {
      this.viewer.noteRefusal(error);
      this.refusedWaive(error, fold);
    } finally {
      this.waiveBusy.set(false);
    }
  }

  /**
   * What a refused waiver is drawn as — an approval's own shape: a 409 naming a moved fold is calmly
   * that, and any other refusal is the service's own sentence.
   */
  private refusedWaive(error: unknown, fold: string): void {
    if (statusOf(error) !== 409) {
      this.waiveFailure.set(describeError(error));
      return;
    }
    const message = error instanceof HttpErrorResponse ? serverMessage(error.error) : null;
    const now = foldNamedBy(message, fold);
    this.waiveMoved.set(
      now
        ? `The fold changed while this was being read — this request is on ${shortSha(now)} now, ` +
            `not ${fold ? shortSha(fold) : this.none}. Nothing was waived; look at the new fold.`
        : (message ?? 'The service would not take that waiver.'),
    );
  }
}

/** `registry.example:5000/qits/build-images/maven-base:latest` → `maven-base:latest`. */
function imageShortName(image: string): string {
  const trimmed = (image ?? '').trim();
  return trimmed.split('/').pop() || trimmed;
}

/**
 * The sha a refusal names, or nothing — any commit-shaped token that is not the one that was sent,
 * rather than the service's exact wording, which is prose and may be reworded.
 */
function foldNamedBy(message: string | null, sent: string): string | null {
  for (const match of message?.matchAll(/\b[0-9a-f]{7,64}\b/g) ?? []) {
    if (match[0] !== sent) {
      return match[0];
    }
  }
  return null;
}
