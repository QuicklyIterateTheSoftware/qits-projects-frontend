import { basename, cloneUrl, isGitSafeName, repositoryLabel, wrapperDirectory } from './format';

describe('repositoryLabel', () => {
  it('prefers the registered name', () => {
    expect(repositoryLabel({ id: 'r1', name: 'qits-ci', backupUrl: 'https://x/other.git' })).toBe(
      'qits-ci',
    );
  });

  /** Rows written before release A added `name`; the twin is named after the same thing. */
  it('falls back to the backup url’s basename', () => {
    expect(
      repositoryLabel({
        id: 'r1',
        name: '',
        backupUrl: 'ssh://git@example/QuicklyIterate/qits-ci.git',
      }),
    ).toBe('qits-ci');
  });

  /** A row with no backup configured has neither, so the id is all there is. */
  it('falls back to the id when there is neither', () => {
    expect(repositoryLabel({ id: 'r1', name: '', backupUrl: null })).toBe('r1');
  });
});

/**
 * The clone address is a *rule*, not a field, so this is where the rule is pinned. A wrapper's
 * relative `../<name>.git` has to resolve to the same place, which is what makes a project cloned
 * from GitHub and one cloned from the platform the same project.
 */
describe('cloneUrl', () => {
  it('is the git host’s name-addressed route under the browser’s own origin', () => {
    expect(cloneUrl('https://qits.example', 'qits', 'qits-ci')).toBe(
      'https://qits.example/artifacts/git/qits/qits-ci.git',
    );
  });

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(cloneUrl('http://localhost:8080/', 'qits', 'qits-ci')).toBe(
      'http://localhost:8080/artifacts/git/qits/qits-ci.git',
    );
  });

  it('escapes a project id or a name that would otherwise change the path', () => {
    expect(cloneUrl('https://qits.example', 'a/b', 'c d')).toBe(
      'https://qits.example/artifacts/git/a%2Fb/c%20d.git',
    );
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
