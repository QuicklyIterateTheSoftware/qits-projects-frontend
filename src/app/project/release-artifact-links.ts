import type { ReleaseArtifactDto } from '../api/dto';

/**
 * One addressable thing about a published artifact: what to call it, and — where this SPA can spell
 * one — which application serves it and at what path inside that application's scope.
 *
 * <p>`app`/`path` are absent together. That is not "no link yet": it is this build saying it has no
 * honest address for the artifact, which is the whole answer for a `daemon` (published as an image
 * the platform addresses by a name only its own deployment knows) and for a kind released after this
 * SPA was built. The caller draws the label and no anchor.
 */
export interface ReleaseArtifactLink {
  readonly label: string;
  /** The platform application that serves it — `qits-artifacts`, `qits-docs`. */
  readonly app?: string;
  /** The path inside that application, below whatever scope the caller resolves it against. */
  readonly path?: string;
  /**
   * The path is a WIRE route at the application's root, not a page of its SPA — the caller must
   * resolve it against no scope at all. An SBOM lives at `/artifacts/sboms/…` on the store's own
   * host; prefixing the project scope would spell an address nothing serves.
   */
  readonly wire?: true;
}

/** The docker image registry's own scope inside qits-artifacts — `qits/<application>`. */
const IMAGE_SCOPE = 'qits/';

/**
 * Where one published artifact can be looked at.
 *
 * <p><b>Pure, and it answers paths rather than URLs.</b> Turning a path into an href needs the
 * platform's navigation (`QitsAppLinks.href`), which is a runtime question — whether the application
 * has a host, what the environment's origin is — and an artifact kind's shape is not. Splitting them
 * is what lets every mapping below be asserted directly, and it is why an application this platform
 * does not serve drops out at the page rather than here.
 *
 * <p><b>An SBOM is a second entry and not a field.</b> The bill of materials is filed under its own
 * coordinate in qits-artifacts, at a path that has nothing to do with the package's own, so a caller
 * that wanted only the package would otherwise have to know to ignore half a record. Only the two
 * kinds that actually publish one carry it.
 *
 * <p>The type words are the release recipe's, forwarded by the service; `userflows` is the one the
 * service derives, and its `version` is the fold's sha rather than the release's calver, which is
 * why nothing here composes a version of its own.
 */
export function releaseArtifactLinks(artifact: ReleaseArtifactDto): readonly ReleaseArtifactLink[] {
  const { type, name, version } = artifact;
  switch (type) {
    case 'docker':
      return [
        // The image registry addresses an application, and the declaration carries the registry
        // scope in front of it: `qits/qits-projects` is the application `qits-projects`.
        {
          label: name,
          app: 'qits-artifacts',
          path: `repositories/qits/images/${application(name)}`,
        },
        {
          label: 'SBOM',
          app: 'qits-artifacts',
          path: `artifacts/sboms/docker/${name}/-/${version}`,
          wire: true,
        },
      ];
    case 'maven':
      return [
        { label: name, app: 'qits-artifacts', path: `repositories/maven/maven-packages/${name}` },
        {
          label: 'SBOM',
          app: 'qits-artifacts',
          path: `artifacts/sboms/maven/${name}/-/${version}`,
          wire: true,
        },
      ];
    case 'npm':
      // The one coordinate that is escaped: a scoped package is `@qits/ui-components`, and both the
      // `@` and the slash are part of the NAME rather than of the path.
      return [
        {
          label: name,
          app: 'qits-artifacts',
          path: `repositories/npm/packages/${encodeURIComponent(name)}`,
        },
      ];
    // A docs site and a userflow bundle are the same thing at the same address — a versioned site in
    // qits-docs. They are separate types only because one is declared and the other derived.
    case 'docs':
    case 'userflows':
      return [{ label: name, app: 'qits-docs', path: `read/${name}/-/${version}` }];
    default:
      return [{ label: name }];
  }
}

/** `qits/qits-projects` → `qits-projects`; anything not under the registry scope, as it stands. */
function application(name: string): string {
  return name.startsWith(IMAGE_SCOPE) ? name.slice(IMAGE_SCOPE.length) : name;
}
