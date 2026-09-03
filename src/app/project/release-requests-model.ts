import type { QitsBadgeTone } from '@qits/ui-components';
import type { MergeConflictDto, ReleaseRequestDto, ReleaseRequestSourceDto } from '../api/dto';
import { NONE, shortSha } from '../ui/format';

/**
 * How long a release-request page waits before reading its list again — and it only ever waits
 * while something on screen is still moving.
 *
 * <p><b>This is the one poll in this application, and the exception is argued rather than assumed.</b>
 * The standing rule here is that nothing polls: a page with an SSE channel must not also put a
 * traffic floor under a project nobody is changing. These pages have no channel — release requests
 * are settled by the build gate and by a sweep, on threads with no hint stream in front of them —
 * and the thing a reader came to watch is a row that changes minutes after they pressed something
 * somewhere else. A page that only ever answered the question once would be a page people reload.
 *
 * <p>What keeps the rule's *reason* intact is the gate on the timer, not the interval: the tick is
 * scheduled only while {@link hasOpenRequests} holds, so a list with nothing moving in it costs
 * exactly one read for as long as the page is open, and there is no floor under anything nobody is
 * changing. Six seconds is under the settle window a request with no verdict waits (PT30S), so a
 * state change is on screen well inside the step that caused it.
 *
 * <p>Each tick is scheduled **after** the previous read answered, never on a fixed interval: a
 * service having a slow minute must not be handed a queue of overlapping reads.
 *
 * <p>It lives beside the model rather than in either page because both of them poll on it: the
 * repository's list and the project's are the same surface at two scopes, and an interval that could
 * differ between them would be two answers to one question.
 */
export const RELEASE_REQUESTS_POLL_MS = 6000;

/** The badge one state draws as: the word a person reads, and the tone that colours it. */
export interface ReleaseStateBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

/**
 * How each stored state is drawn.
 *
 * <p>The two refusals are deliberately **not** both `danger`. `REJECTED` is a build that went red —
 * the platform working, and the request re-arms itself on the next push — so it is a warning. A
 * `FAILED` release is the door itself not going through, which is the one a person has to act on.
 * `WITHDRAWN` is neutral rather than either: nothing went wrong, somebody decided.
 *
 * <p>`CONFLICTED` joins `REJECTED` as a warning on the same argument: the sources disagreeing about
 * content is not the platform breaking, and the thing that clears it is a push. The conflict panel
 * under the row is what makes it actionable, so the badge does not have to shout.
 *
 * <p>A state this build has never heard of is **not** in the table, and {@link releaseStateBadge}
 * draws it as itself rather than guessing a tone — the service's DTO says the vocabulary may grow,
 * and a wrong colour is worse than no colour.
 */
const STATE_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  PENDING: 'info',
  READY: 'info',
  RELEASED: 'success',
  REJECTED: 'warning',
  CONFLICTED: 'warning',
  FAILED: 'danger',
  WITHDRAWN: 'neutral',
};

/**
 * The states that have stopped moving on their own, which is what {@link hasOpenRequests} — and
 * through it the page's whole request budget — is decided on.
 *
 * <p>`REJECTED` is in this set even though the request can move again: it re-arms on a **push**,
 * not on the passage of time, so a page watching a rejected request would be a poll waiting for
 * something that only a person elsewhere can cause. `FAILED` is conditional and is handled in
 * {@link isSettled} instead — a retryable failure is one the sweep is still working on.
 *
 * <p><b>`CONFLICTED` is in this set although the service counts it as open</b>, and the two are
 * answering different questions. The service's open set is what a worklist should *show*, and a
 * conflicted request is absolutely still waiting on somebody. This set is what is worth *polling*
 * for, and the service's own sweep deliberately does not re-fold a conflicted request: a conflict is
 * a fact about content that answers the same on every knock, so nothing but a push can change it —
 * exactly the `REJECTED` argument. The row is shown and not watched.
 */
const SETTLED_STATES: ReadonlySet<string> = new Set([
  'RELEASED',
  'REJECTED',
  'CONFLICTED',
  'WITHDRAWN',
]);

/** The states the service itself refuses to withdraw, and the whole of what it refuses. */
const WITHDRAWAL_REFUSED: ReadonlySet<string> = new Set(['RELEASED', 'WITHDRAWN']);

/**
 * What one state is drawn as. An unknown word is shown **as itself**, in the neutral tone — the
 * same three-valued honesty the runtime badge on the refining page uses, and the reason `state` is
 * typed as a plain string.
 */
export function releaseStateBadge(state: string): ReleaseStateBadge {
  return {
    label: (state || 'unknown').toLowerCase(),
    tone: STATE_TONES[state] ?? 'neutral',
  };
}

/**
 * Whether this request has finished moving by itself.
 *
 * <p>A `FAILED` request is settled only when it is **not** retryable: the sweep keeps retrying the
 * retryable ones, so that row really is still in flight. An unknown state counts as *unsettled* on
 * purpose — a word this build does not know is far more likely to be a new in-flight step than a
 * new terminal one, and the cost of being wrong is one page-lifetime of polling rather than a
 * screen that never updates.
 */
export function isSettled(request: ReleaseRequestDto): boolean {
  if (request.state === 'FAILED') {
    return !request.retryable;
  }
  return SETTLED_STATES.has(request.state);
}

/**
 * Whether anything on screen is still moving — the page polls while this is true and stops when it
 * is not, which is what keeps a repository whose requests all landed weeks ago costing exactly one
 * read for as long as the page is open.
 */
export function hasOpenRequests(requests: readonly ReleaseRequestDto[]): boolean {
  return requests.some((request) => !isSettled(request));
}

/**
 * Whether the Withdraw button is offered.
 *
 * <p>It mirrors the service's own refusal exactly — RELEASED and WITHDRAWN and nothing else —
 * rather than listing the states that *are* withdrawable. Stating it as the negative is what keeps
 * a state added on the service side offerable here without an edit, and it is the same rule the
 * 409 enforces, so the button and the answer cannot drift apart.
 */
export function canWithdraw(request: ReleaseRequestDto): boolean {
  return !WITHDRAWAL_REFUSED.has(request.state);
}

/**
 * The sentence under a row, or nothing.
 *
 * <p>`detail` is what the service says about a request that is neither simply pending nor simply
 * released, and it is the only field that ever carries a reason. A `RELEASED` request whose detail
 * survived from an earlier attempt is still worth showing — it is why the release took two goes —
 * so nothing is filtered by state here; the null is the filter.
 */
export function releaseDetail(request: ReleaseRequestDto): string | null {
  const detail = request.detail?.trim();
  return detail ? detail : null;
}

/**
 * What is being folded into this request, named branches first and the implicit released tags after.
 *
 * <p>The order is this SPA's and is the only re-sorting it does anywhere, because the two kinds are
 * not a sequence: the named branches are what somebody asked for and the tags are what the platform
 * added underneath, so a tag landing between two branches would read as a choice nobody made.
 *
 * <p>A request answered without the field at all is an empty list rather than a crash — this SPA is
 * deployed independently of the service and a template that iterated `undefined` would take the
 * whole page down over a field.
 */
export function releaseSources(request: ReleaseRequestDto): readonly ReleaseRequestSourceDto[] {
  const sources = request.sources ?? [];
  return [...sources].sort((left, right) => Number(left.implicit) - Number(right.implicit));
}

/**
 * `refs/heads/main` → `main`, `refs/tags/2026.903.1` → `2026.903.1`, anything else as it stands.
 *
 * <p>Only the conflict's `head` needs it: a source already carries the spelling a person uses, but
 * the git host's conflict record names the participant by the ref it was given, and `refs/heads/`
 * in front of every line of a conflict list is six words of noise on the one screen somebody is
 * reading carefully. An unrecognised shape is left whole rather than trimmed by guess.
 */
export function refName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|tags)\//, '');
}

/**
 * The tooltip one source carries: the fully qualified ref, and — for the implicit ones — the
 * sentence that explains why it is on a request nobody put it on.
 */
export function sourceTitle(source: ReleaseRequestSourceDto): string {
  return source.implicit
    ? `${source.ref} — a release of this repository that has not reached main yet, added automatically`
    : source.ref;
}

/**
 * The fold's sha, abbreviated, or the em dash where there is no fold yet.
 *
 * <p>The dash is the point. `mergedSha` is null until the first fold lands, and on a conflicted
 * request whose first fold never did — "nothing is gated yet", which is a different sentence from
 * "nothing to release" and must not be drawn as an absent row.
 */
export function mergedShaLabel(request: ReleaseRequestDto): string {
  return request.mergedSha ? shortSha(request.mergedSha) : NONE;
}

/**
 * The conflict to draw under a row, or nothing.
 *
 * <p>Keyed on the conflict being *there* rather than on the state being `CONFLICTED`: the service
 * clears it with the first fold that succeeds, so the field is already the honest condition, and
 * keying on the word would hide a conflict the moment a state this build has not heard of arrived
 * carrying one. A conflict with no paths in it is nothing to show.
 */
export function releaseConflict(request: ReleaseRequestDto): MergeConflictDto | null {
  const conflict = request.conflict;
  return conflict && conflict.conflicts?.length ? conflict : null;
}
