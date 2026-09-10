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

/**
 * The badge one word draws as: the word a person reads, and the tone that colours it.
 *
 * <p>Named for the state because that is what it was invented for, and shared with the priority
 * badge rather than copied: the two are the same shape answering the same question — which word, in
 * which colour — and a second identical interface would be two names for one fact.
 */
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

/**
 * The states the service refuses to change a request in, and the whole of what it refuses.
 *
 * <p>One set for both verbs, because the service has one rule: withdrawing an ask and re-declaring
 * what one of its branches is worth are both changes to a request, and both are answered by the same
 * `requireOpenForChange` — RELEASED and WITHDRAWN are done and everything else is still open.
 * Spelling the refusal once here is what keeps the two buttons and the 409 from drifting apart, and
 * what keeps a state added on the service side offerable with no edit on this side.
 */
const CLOSED_TO_CHANGE: ReadonlySet<string> = new Set(['RELEASED', 'WITHDRAWN']);

/**
 * How urgent a participating branch is, **lowest first** — the service's own order, which is the
 * whole of what makes "the highest of them" a meaningful answer, and the order the select draws.
 *
 * <p>The word travels as a plain string on both DTOs, the way the state does, so a vocabulary that
 * grew on the service side still arrives and is still drawn. That is also why
 * {@link priorityOptions} folds a word this build has never heard of into the list rather than
 * dropping it: a select that silently replaced the stored value with the first thing it knows would
 * change a branch's priority because somebody opened the page.
 *
 * <p><b>Nothing is reordered by any of this yet.</b> The value is recorded on the branch, carried
 * down the chain and shown; the build queue is untouched, which is a later feature.
 */
export const RELEASE_PRIORITIES: readonly string[] = [
  'LOWEST',
  'LOW',
  'MEDIUM',
  'HIGH',
  'HIGHER',
  'BLOCKING',
];

/**
 * How each priority is drawn.
 *
 * <p><b>Only what is above the default gets a colour.</b> `MEDIUM` is what a branch has when nobody
 * said anything, and the two below it are somebody standing aside — none of the three is news, so
 * all three are neutral and the badge's job is left to the two that mean "look at this" and the one
 * that means "everything else waits". A colour on every row would make the escalated ones invisible,
 * which is the one thing this badge exists to prevent.
 */
const PRIORITY_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  LOWEST: 'neutral',
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'warning',
  HIGHER: 'warning',
  BLOCKING: 'danger',
};

/**
 * Whether the approval gate on this request is still open — nobody has judged the fold it is on now.
 *
 * <p>**`approvalRequired` is the only thing that turns this on**, and it is optional: a service build
 * older than the field answers `undefined`, which reads as "no approval gate" and draws nothing
 * anywhere. That is the ordinary state of affairs on the day this SPA ships, since it is released
 * before the service that grew the field.
 *
 * <p>A missing `approvalState` on a request that *does* require approval is read as `WAITING` rather
 * than as "unknown, say nothing": the request needs a person by the service's own answer, and the
 * failure mode of guessing the other way is a wrapper release that waits for somebody with no
 * affordance on the page to be that somebody. Every word that is neither of the two decisions is
 * therefore outstanding — including one this build has never heard of, on the same argument.
 *
 * <p>It is a question about the request's **current fold** and needs no sha to ask, because the
 * service derives the three decision fields at that fold: a push that re-folds the request answers
 * `WAITING` again on its own, with nothing to clear here.
 */
export function approvalOutstanding(request: ReleaseRequestDto): boolean {
  if (request.approvalRequired !== true) {
    return false;
  }
  const word = request.approvalState;
  return word !== 'APPROVED' && word !== 'DECLINED';
}

/**
 * Whether this request is **stopped on a person**: it is pending, its repository's releases have to
 * be approved, and the fold it is on has not been judged.
 *
 * <p>The state is in the reading and it is `PENDING` alone. A `READY` request has passed both gates
 * by construction, and every settled state has stopped for a reason of its own that a second sentence
 * about approval would only argue with — a `REJECTED` request whose fold was declined says *rejected*,
 * which is the truth a reader needs, and its decline is drawn beneath it by the gates panel.
 *
 * <p>This is what the badge is drawn from, and it is worth a name of its own rather than being
 * inlined there: the panel asks the same question to decide whether to offer the two buttons, and
 * "the badge says a person is needed" and "a person is offered the decision" drifting apart is
 * exactly the bug that would not be noticed.
 */
export function awaitingApproval(request: ReleaseRequestDto): boolean {
  return request.state === 'PENDING' && approvalOutstanding(request);
}

/**
 * What one request's state is drawn as. An unknown word is shown **as itself**, in the neutral tone —
 * the same three-valued honesty the runtime badge on the refining page uses, and the reason `state`
 * is typed as a plain string.
 *
 * <p><b>It takes the request rather than the word, because one state now draws two ways.</b> A
 * `PENDING` request is ordinarily the platform working — the gates are being asked, nothing is
 * needed from anybody — and that is `info`. A pending request whose repository's releases have to be
 * approved and whose fold nobody has judged is not that: it will sit there for ever unless a person
 * opens it and says yes, and a list that drew it identically to the one the build gate is still
 * chewing on would hide the only row on the page that is waiting for its reader.
 *
 * <p>`warning` rather than a fourth shade of blue, for that reason and no other: the tone here means
 * "this one is on you", which is what it means on `REJECTED` and `CONFLICTED` too — a state that has
 * stopped and needs somebody. It is deliberately not `danger`, which is reserved for the platform
 * itself having failed; nothing is wrong with a release waiting to be approved.
 */
export function releaseStateBadge(request: ReleaseRequestDto): ReleaseStateBadge {
  if (awaitingApproval(request)) {
    return { label: 'awaiting approval', tone: 'warning' };
  }
  const state = request.state;
  return {
    label: (state || 'unknown').toLowerCase(),
    tone: STATE_TONES[state] ?? 'neutral',
  };
}

/**
 * The states in which "nobody is watching this" is a *problem* rather than a fact about who asked.
 *
 * <p>A machine-asked request that is PENDING or READY is the ordinary night: the bump was made, the
 * gate is working, nothing is wrong with nobody watching it. The three below have stopped and will
 * not start again on their own — a red gate re-arms on a push, a conflict on a push, a
 * non-retryable failure on a push — so a machine's request in one of them is a repository that has
 * quietly stopped moving with no reader at the end of it. That pair is what the badge says.
 */
const UNATTENDED_AND_BLOCKED: ReadonlySet<string> = new Set(['REJECTED', 'CONFLICTED', 'FAILED']);

/**
 * The badge for a request **nobody is waiting on that has stopped**, or nothing at all.
 *
 * <p>Drawn beside the state rather than instead of it, because it answers a different question:
 * `rejected` says what happened and this says who, if anybody, is going to answer it. `warning`
 * rather than `danger` for the reason `REJECTED` itself is a warning — the platform is working and
 * a push clears it — and the ticket the service files is what actually puts it in front of a
 * person; this is the same fact where somebody is already looking.
 */
export function unattendedBadge(request: ReleaseRequestDto): ReleaseStateBadge | null {
  return request.unattended === true && UNATTENDED_AND_BLOCKED.has(request.state)
    ? { label: 'nobody watching', tone: 'warning' }
    : null;
}

/** The sentence the badge carries as its title — the whole of why it is drawn. */
export const UNATTENDED_TITLE =
  'A machine asked for this release, so nobody is waiting on it. It has stopped and will only ' +
  'move again when somebody pushes a fix.';

/**
 * What one priority is drawn as, or **nothing at all** where there is no priority.
 *
 * <p>The null is the whole of the care here. A missing value is not `MEDIUM`: it is either a source
 * that has none to have — the implicit released tags are derived rows the service never stores a
 * priority on — or an answer from a service build older than the field, which is every answer on the
 * day this SPA ships, because the SPA is released before the service that grew the field. Drawing
 * the default for either would be inventing a fact about somebody's release.
 *
 * <p>A word this build has never heard of is drawn **as itself**, in the neutral tone — the same
 * three-valued honesty {@link releaseStateBadge} keeps, and the reason both are plain strings.
 */
export function releasePriorityBadge(
  priority: string | null | undefined,
): ReleaseStateBadge | null {
  const word = priority?.trim();
  if (!word) {
    return null;
  }
  return { label: word.toLowerCase(), tone: PRIORITY_TONES[word] ?? 'neutral' };
}

/**
 * What a select over one source's priority offers: the six the service stores, plus whatever that
 * source is *already* set to if this build has never heard of it.
 *
 * <p>The tail is not decoration. A `<select>` shows its first option when its value matches none of
 * them, so a request carrying a word from a newer service would be drawn as `LOWEST` and one
 * inattentive change would post that back — a downgrade nobody asked for, caused by opening a page.
 */
export function priorityOptions(current: string | null | undefined): readonly string[] {
  const word = current?.trim();
  return word && !RELEASE_PRIORITIES.includes(word)
    ? [...RELEASE_PRIORITIES, word]
    : RELEASE_PRIORITIES;
}

/**
 * Whether a source's priority can still be re-declared on this request.
 *
 * <p>The same negative as {@link canWithdraw} and the same reason: the service refuses to change a
 * RELEASED or WITHDRAWN request and nothing else, so a control offered on anything else is offered
 * exactly where the service will take it. A release that has already gone out keeps its priority
 * visible — the control is drawn and disabled rather than removed, because what a branch was worth
 * is part of the record.
 */
export function canSetPriority(request: ReleaseRequestDto): boolean {
  return !CLOSED_TO_CHANGE.has(request.state);
}

/**
 * Whether this participant is one a person can put a priority on: the named branches, never the
 * released tags the service adds underneath. Those are derived rows that are never persisted, so
 * they carry no priority and the endpoint knows nothing about them.
 */
export function canPrioritiseSource(source: ReleaseRequestSourceDto): boolean {
  return !source.implicit;
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
  return !CLOSED_TO_CHANGE.has(request.state);
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
