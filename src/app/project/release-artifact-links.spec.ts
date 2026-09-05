import type { ReleaseArtifactDto } from '../api/dto';
import { releaseArtifactLinks } from './release-artifact-links';

function artifact(overrides: Partial<ReleaseArtifactDto> = {}): ReleaseArtifactDto {
  return { type: 'docker', name: 'qits/qits-ci', version: '2026.904.161524', ...overrides };
}

/**
 * Where a published artifact can be looked at.
 *
 * <p>Every case here is a coordinate the platform composes differently from the one before it, which
 * is the entire reason this is a function rather than a template expression: the image registry
 * addresses an application, maven addresses a colon-separated coordinate, npm addresses an escaped
 * package name, docs address a versioned site — and the SBOM of any of them is filed somewhere else
 * again. Asserting them as strings is what makes a wrong one a failing test rather than a 404
 * somebody finds later.
 */
describe('releaseArtifactLinks', () => {
  /**
   * The declaration carries the registry scope in front of the application (`qits/qits-ci`), and
   * the image browser addresses the application — so the scope comes off exactly once.
   */
  it('addresses an image by its application, and its SBOM by its full name', () => {
    expect(releaseArtifactLinks(artifact())).toEqual([
      { label: 'qits/qits-ci', app: 'qits-artifacts', path: 'repositories/qits/images/qits-ci' },
      {
        label: 'SBOM',
        app: 'qits-artifacts',
        path: 'artifacts/sboms/docker/qits/qits-ci/-/2026.904.161524',
        wire: true,
      },
    ]);
  });

  /** A name outside the registry scope is left whole rather than trimmed by guess. */
  it('leaves an image name that is not under the platform scope alone', () => {
    expect(releaseArtifactLinks(artifact({ name: 'vendor/thing' }))[0].path).toBe(
      'repositories/qits/images/vendor/thing',
    );
  });

  it('addresses a maven coordinate and its SBOM', () => {
    expect(
      releaseArtifactLinks(artifact({ type: 'maven', name: 'eu.wohlben.qits:qits-ci-domain' })),
    ).toEqual([
      {
        label: 'eu.wohlben.qits:qits-ci-domain',
        app: 'qits-artifacts',
        path: 'repositories/maven/maven-packages/eu.wohlben.qits:qits-ci-domain',
      },
      {
        label: 'SBOM',
        app: 'qits-artifacts',
        path: 'artifacts/sboms/maven/eu.wohlben.qits:qits-ci-domain/-/2026.904.161524',
        wire: true,
      },
    ]);
  });

  /**
   * The one coordinate that is escaped: a scoped package's `@` and slash are part of the NAME, and a
   * path that spelled them raw would address a package under a directory that does not exist.
   */
  it('escapes an npm package name, which is a name and not a path', () => {
    expect(releaseArtifactLinks(artifact({ type: 'npm', name: '@qits/ui-components' }))).toEqual([
      {
        label: '@qits/ui-components',
        app: 'qits-artifacts',
        path: 'repositories/npm/packages/%40qits%2Fui-components',
      },
    ]);
  });

  it('addresses a docs site at the version it was published under', () => {
    expect(releaseArtifactLinks(artifact({ type: 'docs', name: 'qits-ci' }))).toEqual([
      { label: 'qits-ci', app: 'qits-docs', path: 'read/qits-ci/-/2026.904.161524' },
    ]);
  });

  /**
   * The userflow bundle is the same address as a docs site, and its version is the FOLD's sha — the
   * QA pipeline runs per release request and publishes at `$QITS_CI_SHA`. Nothing here composes a
   * version, which is what lets the two differ without a special case.
   */
  it('addresses a userflow bundle at whatever version the service handed it', () => {
    expect(
      releaseArtifactLinks(
        artifact({
          type: 'userflows',
          name: '@userflows/qits-ci',
          version: '20c377ee71fabe6f32429d1506989efecec7798b',
        }),
      ),
    ).toEqual([
      {
        label: '@userflows/qits-ci',
        app: 'qits-docs',
        path: 'read/@userflows/qits-ci/-/20c377ee71fabe6f32429d1506989efecec7798b',
      },
    ]);
  });

  /**
   * A kind with no address here answers a label and nothing else, which the page draws as a name.
   * Guessing an address for a word this build has never seen is the one thing that would be worse
   * than saying nothing.
   */
  it('names a daemon and an unknown kind, and offers no address for either', () => {
    expect(releaseArtifactLinks(artifact({ type: 'daemon', name: 'qits-ci-daemon' }))).toEqual([
      { label: 'qits-ci-daemon' },
    ]);
    expect(releaseArtifactLinks(artifact({ type: 'something-new', name: 'a-thing' }))).toEqual([
      { label: 'a-thing' },
    ]);
  });
});
