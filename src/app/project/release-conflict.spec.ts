import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ConflictedPathDto, MergeConflictDto, ReleaseRequestDto } from '../api/dto';
import { ReleaseConflict } from './release-conflict';

const HEAD_SHA = '9f1c2b3d4e5f60718293a4b5c6d7e8f901234567';
const OURS = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const THEIRS = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** A file conflict as the service has always reported one — the original four fields and no more. */
function file(overrides: Partial<ConflictedPathDto> = {}): ConflictedPathDto {
  return {
    path: 'pom.xml',
    head: 'refs/heads/adhoc-changes',
    headSha: HEAD_SHA,
    reason: 'content',
    ...overrides,
  };
}

function conflict(paths: readonly ConflictedPathDto[]): MergeConflictDto {
  return { target: 'release/r1', conflicts: paths };
}

function request(paths: readonly ConflictedPathDto[]): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-1',
    repoName: 'qits-qits',
    backingBranch: 'release/r1',
    sources: [{ kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false }],
    mergedSha: null,
    state: 'CONFLICTED',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: conflict(paths),
    version: null,
    releasedSha: null,
    mergedToMainAt: null,
    retryable: false,
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
  };
}

/**
 * What a fold could not answer, drawn where the request is.
 *
 * <p>Three things are worth pinning and none of them is the markup. **A submodule is drawn as its
 * two pins**, because a gitlink conflict is a disagreement about a sha and the word `content` says
 * nothing about it. **A row that does not say what kind it is is drawn exactly as it was** — that is
 * every conflict recorded before the service grew the fields, and every answer from a service build
 * behind this one, so it is the case that has to keep working rather than the new one. **The closing
 * line says an attempt was already made**, because what is listed is the residue of one.
 */
describe('ReleaseConflict', () => {
  let fixture: ComponentFixture<ReleaseConflict>;

  function mount(paths: readonly ConflictedPathDto[]): void {
    fixture = TestBed.createComponent(ReleaseConflict);
    fixture.componentRef.setInput('request', request(paths));
    fixture.detectChanges();
  }

  function panel(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return panel().querySelector('.conflict')?.textContent ?? '';
  }

  function rows(): string[] {
    return [...panel().querySelectorAll('.path')].map((row) => row.textContent ?? '');
  }

  it('draws both pins of a submodule the two sides want at different commits', () => {
    mount([
      file({
        path: 'components/qits-ci/qits-ci-service',
        kind: 'gitlink',
        base: null,
        ours: OURS,
        theirs: THEIRS,
      }),
    ]);

    const row = rows()[0];
    expect(row).toContain('components/qits-ci/qits-ci-service');
    // Each side named with the ref that wants it, in the panel's own `ref · sha` idiom.
    expect(row).toContain('release/r1 · 1111111');
    expect(row).toContain('adhoc-changes · 2222222');
    expect(row).toContain('submodule');
    // `headSha` is a commit in the wrapper and says nothing about which pin is wanted.
    expect(row).not.toContain('9f1c2b3');
    expect(row).not.toContain('content');
  });

  it('carries the whole sha of each pin, as every short sha on these pages does', () => {
    mount([file({ path: 'webui', kind: 'gitlink', ours: OURS, theirs: THEIRS })]);

    const titles = [...panel().querySelectorAll('.head')].map((side) => side.getAttribute('title'));
    expect(titles).toEqual([`release/r1 at ${OURS}`, `refs/heads/adhoc-changes at ${THEIRS}`]);
  });

  /**
   * The compatibility case, and the one that matters most: a stored conflict written before the
   * service said any of this has only the original four fields, and must read exactly as it did.
   */
  it('draws a row with none of the new fields precisely as it drew it before', () => {
    mount([file()]);

    const row = rows()[0];
    expect(row).toContain('pom.xml');
    expect(row).toContain('adhoc-changes · 9f1c2b3');
    expect(row).toContain('content');
    expect(panel().querySelector('.head')?.getAttribute('title')).toBe(
      `refs/heads/adhoc-changes at ${HEAD_SHA}`,
    );
  });

  it('draws a file the service does name the kind of the same way', () => {
    mount([file({ kind: 'file', base: HEAD_SHA, ours: OURS, theirs: THEIRS })]);

    const row = rows()[0];
    expect(row).toContain('pom.xml');
    expect(row).toContain('adhoc-changes · 9f1c2b3');
    expect(row).toContain('content');
    expect(row).not.toContain('1111111');
  });

  /**
   * Half a pair says less than the old rendering does — a gitlink deleted on one side has one sha
   * and no disagreement to draw — so the row falls back rather than draws a blank beside a dot.
   */
  it('falls back for a gitlink that carries only one of the two pins', () => {
    mount([file({ path: 'webui', kind: 'gitlink', ours: OURS, theirs: null })]);

    const row = rows()[0];
    expect(row).toContain('adhoc-changes · 9f1c2b3');
    expect(row).toContain('content');
    expect(row).not.toContain('1111111');
  });

  it('says the listed paths are what an attempt could not answer, and what to do with them', () => {
    mount([file()]);

    const now = panel().querySelector('.what-now')?.textContent ?? '';
    expect(now).toContain('automatic resolution could not answer');
    expect(now).toContain('push');
    // There is deliberately no manual resolve door on this panel.
    expect(panel().querySelector('button')).toBeNull();
  });

  it('draws nothing at all when the request carries no conflict', () => {
    fixture = TestBed.createComponent(ReleaseConflict);
    fixture.componentRef.setInput('request', { ...request([]), conflict: null });
    fixture.detectChanges();

    expect(text()).toBe('');
  });
});
