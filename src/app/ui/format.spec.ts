import { basename, isGitSafeName, repositoryLabel, wrapperDirectory } from './format';

describe('repositoryLabel', () => {
  it('prefers the registered name', () => {
    expect(repositoryLabel({ id: 'r1', name: 'qits-ci', url: 'https://x/other.git' })).toBe(
      'qits-ci',
    );
  });

  /** Rows written before release A added `name`; the url basename is what the old SPAs derived. */
  it('falls back to the url basename', () => {
    expect(
      repositoryLabel({ id: 'r1', name: '', url: 'ssh://git@example/QuicklyIterate/qits-ci.git' }),
    ).toBe('qits-ci');
  });

  /** A repository born blank on the platform host has no url at all, so the id is all there is. */
  it('falls back to the id when there is neither', () => {
    expect(repositoryLabel({ id: 'r1', name: '', url: null })).toBe('r1');
  });
});

describe('basename', () => {
  it('strips the .git suffix and every path or scheme separator', () => {
    expect(basename('https://github.com/QuicklyIterate/qits-ci.git')).toBe('qits-ci');
    expect(basename('../qits-ci.git')).toBe('qits-ci');
  });

  it('is empty for no url', () => {
    expect(basename(null)).toBe('');
  });
});

describe('wrapperDirectory', () => {
  it('is the first segment of the path', () => {
    expect(wrapperDirectory({ path: 'services/qits-ci' })).toBe('services');
  });

  it('is empty for a path with no directory, which is a path no archetype names', () => {
    expect(wrapperDirectory({ path: 'qits-ci' })).toBe('');
  });
});

describe('isGitSafeName', () => {
  it('accepts what the git host can serve and the wrapper can spell', () => {
    expect(isGitSafeName('qits-ci')).toBe(true);
    expect(isGitSafeName('qits_ci.2')).toBe(true);
  });

  it('rejects a name that would produce a submodule entry resolving nowhere', () => {
    expect(isGitSafeName('')).toBe(false);
    expect(isGitSafeName('a name')).toBe(false);
    expect(isGitSafeName('libs/qits-ci')).toBe(false);
    expect(isGitSafeName('-qits')).toBe(false);
    expect(isGitSafeName('.hidden')).toBe(false);
    expect(isGitSafeName('qits-ci.git')).toBe(false);
  });
});
