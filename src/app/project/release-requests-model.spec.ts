import type { ReleaseRequestDto, ReleaseRequestSourceDto } from '../api/dto';
import {
  RELEASE_PRIORITIES,
  canPrioritiseSource,
  canSetPriority,
  canWithdraw,
  hasOpenRequests,
  isSettled,
  mergedShaLabel,
  priorityOptions,
  refName,
  releaseConflict,
  releaseDetail,
  releasePriorityBadge,
  releaseSources,
  releaseStateBadge,
  sourceTitle,
  unattendedBadge,
} from './release-requests-model';

function source(overrides: Partial<ReleaseRequestSourceDto> = {}): ReleaseRequestSourceDto {
  return {
    kind: 'BRANCH',
    name: 'main',
    ref: 'refs/heads/main',
    implicit: false,
    ...overrides,
  };
}

const TAG = source({
  kind: 'RELEASED_TAG',
  name: '2026.903.1',
  ref: 'refs/tags/2026.903.1',
  implicit: true,
});

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-1',
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [source(), source({ name: 'adhoc-changes', ref: 'refs/heads/adhoc-changes' })],
    mergedSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: null,
    version: null,
    releasedSha: null,
    mergedToMainAt: null,
    retryable: false,
    createdAt: '2026-09-01T13:34:59.888123Z',
    updatedAt: '2026-09-01T13:34:59.888123Z',
    ...overrides,
  };
}

/**
 * The reading of a release request, apart from any component — which is where every decision that
 * costs requests or offers a destructive button actually lives.
 */
describe('release-requests-model', () => {
  describe('unattendedBadge', () => {
    /** The pairing is the whole point: who asked, AND whether it has stopped. */
    it('marks a machine-asked request that has stopped', () => {
      expect(unattendedBadge(request({ unattended: true, state: 'REJECTED' }))).toEqual({
        label: 'nobody watching',
        tone: 'warning',
      });
      expect(unattendedBadge(request({ unattended: true, state: 'CONFLICTED' }))).not.toBeNull();
      expect(unattendedBadge(request({ unattended: true, state: 'FAILED' }))).not.toBeNull();
    });

    /**
     * A bump that is pending is the ordinary night. Nobody watching it is not a problem until it
     * has stopped, and a badge on every healthy robot request is a badge nobody reads.
     */
    it('says nothing about a machine request that is still moving', () => {
      expect(unattendedBadge(request({ unattended: true, state: 'PENDING' }))).toBeNull();
      expect(unattendedBadge(request({ unattended: true, state: 'READY' }))).toBeNull();
      expect(unattendedBadge(request({ unattended: true, state: 'RELEASED' }))).toBeNull();
    });

    /** A person's rejected request is one a person is answering; it needs no marking. */
    it('says nothing about a request somebody is waiting on', () => {
      expect(unattendedBadge(request({ unattended: false, state: 'REJECTED' }))).toBeNull();
    });

    /** An answer from a service older than the field is "not unattended", never `undefined`. */
    it('treats a missing field as attended', () => {
      expect(unattendedBadge(request({ state: 'REJECTED' }))).toBeNull();
    });
  });

  describe('releaseStateBadge', () => {
    it('gives each stored state a tone, and tells the two refusals apart', () => {
      expect(releaseStateBadge('PENDING')).toEqual({ label: 'pending', tone: 'info' });
      expect(releaseStateBadge('READY')).toEqual({ label: 'ready', tone: 'info' });
      expect(releaseStateBadge('RELEASED')).toEqual({ label: 'released', tone: 'success' });
      // A red build is the platform working and the request re-arms itself; a failed release is
      // the one a person has to do something about.
      expect(releaseStateBadge('REJECTED').tone).toBe('warning');
      expect(releaseStateBadge('FAILED').tone).toBe('danger');
      expect(releaseStateBadge('WITHDRAWN').tone).toBe('neutral');
    });

    /** Sources disagreeing about content is not the platform breaking, and a push clears it. */
    it('colours a conflict like a rejection rather than like a failure', () => {
      expect(releaseStateBadge('CONFLICTED')).toEqual({ label: 'conflicted', tone: 'warning' });
    });

    it('draws a state this build has never heard of as itself, in no colour at all', () => {
      expect(releaseStateBadge('RELEASING')).toEqual({ label: 'releasing', tone: 'neutral' });
      expect(releaseStateBadge('')).toEqual({ label: 'unknown', tone: 'neutral' });
    });
  });

  describe('isSettled', () => {
    it('counts the three that have stopped moving, and rejected is one of them', () => {
      expect(isSettled(request({ state: 'RELEASED' }))).toBe(true);
      expect(isSettled(request({ state: 'WITHDRAWN' }))).toBe(true);
      // A rejection re-arms on a push, not on the passage of time — so waiting for it is waiting
      // for a person elsewhere, which is not something to spend requests on.
      expect(isSettled(request({ state: 'REJECTED' }))).toBe(true);
    });

    /**
     * The one place this SPA's reading differs from the service's own "open" word, and it is
     * deliberate: the service's sweep does not re-fold a conflicted request, because a conflict
     * answers the same on every knock. Only a push changes it, so the row is shown and not watched.
     */
    it('counts a conflict as settled, although the service lists it as open', () => {
      expect(isSettled(request({ state: 'CONFLICTED' }))).toBe(true);
    });

    it('counts the two the gates and the worker are still working on', () => {
      expect(isSettled(request({ state: 'PENDING' }))).toBe(false);
      expect(isSettled(request({ state: 'READY' }))).toBe(false);
    });

    it('splits FAILED on retryable, because the sweep is still trying one of them', () => {
      expect(isSettled(request({ state: 'FAILED', retryable: true }))).toBe(false);
      expect(isSettled(request({ state: 'FAILED', retryable: false }))).toBe(true);
    });

    /**
     * The deliberate default, and the one that costs something: a word this build does not know is
     * far likelier to be a new in-flight step than a new terminal one, so it is watched. Being
     * wrong costs one page-lifetime of polling; the other way round costs a screen that never
     * updates and says nothing about it.
     */
    it('treats an unknown state as still moving', () => {
      expect(isSettled(request({ state: 'RELEASING' }))).toBe(false);
    });
  });

  describe('hasOpenRequests', () => {
    it('is false for a repository whose asks have all concluded — the whole point of the gate', () => {
      expect(
        hasOpenRequests([
          request({ id: 'a', state: 'RELEASED' }),
          request({ id: 'b', state: 'REJECTED' }),
          request({ id: 'c', state: 'WITHDRAWN' }),
        ]),
      ).toBe(false);
    });

    it('is false for an empty list, so nothing is watched for a repository nobody has released', () => {
      expect(hasOpenRequests([])).toBe(false);
    });

    it('is true when one row of many is still in flight', () => {
      expect(
        hasOpenRequests([
          request({ id: 'a', state: 'RELEASED' }),
          request({ id: 'b', state: 'PENDING' }),
        ]),
      ).toBe(true);
    });
  });

  /**
   * Stated as the negative on purpose: the service refuses RELEASED and WITHDRAWN and nothing
   * else, so spelling the same two words here is what keeps the button and the 409 from drifting
   * apart — and keeps a state added on the service side offerable with no edit.
   */
  describe('canWithdraw', () => {
    it('offers everything the service does not refuse', () => {
      for (const state of ['PENDING', 'READY', 'REJECTED', 'CONFLICTED', 'FAILED', 'RELEASING']) {
        expect(canWithdraw(request({ state }))).toBe(true);
      }
    });

    it('does not offer what would answer 409', () => {
      expect(canWithdraw(request({ state: 'RELEASED' }))).toBe(false);
      expect(canWithdraw(request({ state: 'WITHDRAWN' }))).toBe(false);
    });
  });

  describe('releasePriorityBadge', () => {
    /**
     * Only what is above the default is coloured. A tone on every row would make the escalated ones
     * invisible, which is the one thing this badge exists to prevent.
     */
    it('leaves the default and everything under it uncoloured', () => {
      expect(releasePriorityBadge('LOWEST')).toEqual({ label: 'lowest', tone: 'neutral' });
      expect(releasePriorityBadge('LOW')).toEqual({ label: 'low', tone: 'neutral' });
      expect(releasePriorityBadge('MEDIUM')).toEqual({ label: 'medium', tone: 'neutral' });
    });

    it('warns above the default and shouts at the top of it', () => {
      expect(releasePriorityBadge('HIGH')).toEqual({ label: 'high', tone: 'warning' });
      expect(releasePriorityBadge('HIGHER')).toEqual({ label: 'higher', tone: 'warning' });
      expect(releasePriorityBadge('BLOCKING')).toEqual({ label: 'blocking', tone: 'danger' });
    });

    /**
     * The null is the point, and it is not `MEDIUM`. An implicit tag has no priority to have and a
     * service build older than the field answers none at all — which is every answer on the day this
     * SPA ships, because it is released before the service. Drawing the default would invent a fact.
     */
    it('draws nothing at all where there is no priority', () => {
      expect(releasePriorityBadge(undefined)).toBeNull();
      expect(releasePriorityBadge(null)).toBeNull();
      expect(releasePriorityBadge('  ')).toBeNull();
    });

    it('draws a word this build has never heard of as itself, in no colour at all', () => {
      expect(releasePriorityBadge('URGENT')).toEqual({ label: 'urgent', tone: 'neutral' });
    });
  });

  describe('RELEASE_PRIORITIES', () => {
    /** Lowest first: the service's own order, which is what makes "the highest of them" mean this. */
    it('is the six the service stores, weakest first', () => {
      expect(RELEASE_PRIORITIES).toEqual(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHER', 'BLOCKING']);
    });
  });

  describe('priorityOptions', () => {
    it('offers the six, in the service’s order', () => {
      expect(priorityOptions('MEDIUM')).toEqual(RELEASE_PRIORITIES);
      expect(priorityOptions(undefined)).toEqual(RELEASE_PRIORITIES);
    });

    /**
     * A select shows its first option when its value matches none of them, so a word from a newer
     * service would be drawn as LOWEST and one inattentive change would post that back — a downgrade
     * caused by opening a page. The stored word is offered instead.
     */
    it('folds a stored word this build has never heard of into the list', () => {
      expect(priorityOptions('URGENT')).toEqual([...RELEASE_PRIORITIES, 'URGENT']);
    });
  });

  /**
   * The same negative as {@link canWithdraw}, from the same set, because the service has one rule:
   * a RELEASED or WITHDRAWN request refuses every change, and everything else is open.
   */
  describe('canSetPriority', () => {
    it('offers everything the service does not refuse', () => {
      for (const state of ['PENDING', 'READY', 'REJECTED', 'CONFLICTED', 'FAILED', 'RELEASING']) {
        expect(canSetPriority(request({ state }))).toBe(true);
      }
    });

    it('does not offer what would answer 409', () => {
      expect(canSetPriority(request({ state: 'RELEASED' }))).toBe(false);
      expect(canSetPriority(request({ state: 'WITHDRAWN' }))).toBe(false);
    });
  });

  describe('canPrioritiseSource', () => {
    /** The derived rows are never persisted, so the endpoint knows nothing about them. */
    it('is the named branches, never the tags the service added underneath', () => {
      expect(canPrioritiseSource(source())).toBe(true);
      expect(canPrioritiseSource(TAG)).toBe(false);
    });
  });

  describe('releaseDetail', () => {
    it('is the sentence when there is one, and nothing when there is not', () => {
      expect(releaseDetail(request({ detail: 'The build went red' }))).toBe('The build went red');
      expect(releaseDetail(request({ detail: null }))).toBeNull();
      expect(releaseDetail(request({ detail: '   ' }))).toBeNull();
    });

    /** Not filtered by state: a released request's detail is why it took two goes. */
    it('shows a detail that survived onto a released request', () => {
      expect(releaseDetail(request({ state: 'RELEASED', detail: 'Retried once' }))).toBe(
        'Retried once',
      );
    });
  });

  describe('releaseSources', () => {
    /**
     * The named branches are what somebody asked for; the tags are what the platform added
     * underneath. Interleaving them would read as a choice nobody made.
     */
    it('puts the branches somebody named before the tags the service added', () => {
      const sources = releaseSources(
        request({
          sources: [TAG, source({ name: 'adhoc-changes', ref: 'refs/heads/adhoc-changes' })],
        }),
      );

      expect(sources.map((entry) => entry.name)).toEqual(['adhoc-changes', '2026.903.1']);
    });

    it('keeps the order the service gave within each kind, so main stays where it was put', () => {
      const sources = releaseSources(
        request({
          sources: [source(), source({ name: 'b', ref: 'refs/heads/b' }), TAG],
        }),
      );

      expect(sources.map((entry) => entry.name)).toEqual(['main', 'b', '2026.903.1']);
    });

    /** A field a service build has not sent must not be able to take a whole page down. */
    it('is empty rather than a crash for a request answered without the field', () => {
      const answered = { ...request(), sources: undefined } as unknown as ReleaseRequestDto;
      expect(releaseSources(answered)).toEqual([]);
    });

    it('says on the implicit ones why they are there, and states the ref on all of them', () => {
      expect(sourceTitle(source())).toBe('refs/heads/main');
      expect(sourceTitle(TAG)).toContain('refs/tags/2026.903.1');
      expect(sourceTitle(TAG)).toContain('has not reached main yet');
    });
  });

  describe('mergedShaLabel', () => {
    it('abbreviates the fold the gates evaluate', () => {
      expect(mergedShaLabel(request())).toBe('20c377e');
    });

    /**
     * The dash is the point: "nothing is gated yet" is a different sentence from "nothing to
     * release", and a row that simply left the fact out would say neither.
     */
    it('is the em dash where no fold has landed yet', () => {
      expect(mergedShaLabel(request({ mergedSha: null }))).toBe('—');
    });
  });

  describe('refName', () => {
    it('strips the two prefixes git spells and leaves anything else whole', () => {
      expect(refName('refs/heads/feature/x')).toBe('feature/x');
      expect(refName('refs/tags/2026.903.1')).toBe('2026.903.1');
      expect(refName('refs/remotes/origin/main')).toBe('refs/remotes/origin/main');
      expect(refName('main')).toBe('main');
    });
  });

  describe('releaseConflict', () => {
    const conflict = {
      target: 'release/r1',
      conflicts: [
        {
          path: 'pom.xml',
          head: 'refs/tags/2026.903.1',
          headSha: '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567',
          reason: 'content',
        },
      ],
    };

    it('is the conflict when the read carries one', () => {
      expect(releaseConflict(request({ state: 'CONFLICTED', conflict }))).toBe(conflict);
    });

    it('is nothing when there is none, or when there is one with no paths in it', () => {
      expect(releaseConflict(request())).toBeNull();
      expect(
        releaseConflict(request({ state: 'CONFLICTED', conflict: { ...conflict, conflicts: [] } })),
      ).toBeNull();
    });

    /**
     * Keyed on the field and not on the word: the service clears it with the first fold that
     * succeeds, so its presence is already the honest condition — and a state this build has not
     * heard of that carried one would still be drawn.
     */
    it('does not ask what the state is called', () => {
      expect(releaseConflict(request({ state: 'RECONCILING', conflict }))).toBe(conflict);
    });
  });
});
