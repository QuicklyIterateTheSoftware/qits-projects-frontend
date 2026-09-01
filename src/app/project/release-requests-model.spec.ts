import type { ReleaseRequestDto } from '../api/dto';
import {
  canWithdraw,
  hasOpenRequests,
  isSettled,
  releaseDetail,
  releaseStateBadge,
} from './release-requests-model';

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-1',
    repoName: 'qits-ci',
    branch: 'adhoc-changes',
    commitSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    version: null,
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
      for (const state of ['PENDING', 'READY', 'REJECTED', 'FAILED', 'RELEASING']) {
        expect(canWithdraw(request({ state }))).toBe(true);
      }
    });

    it('does not offer what would answer 409', () => {
      expect(canWithdraw(request({ state: 'RELEASED' }))).toBe(false);
      expect(canWithdraw(request({ state: 'WITHDRAWN' }))).toBe(false);
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
});
