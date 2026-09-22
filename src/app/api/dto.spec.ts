import {
  COMPONENT_TYPES,
  COMPONENTS_DIRECTORY,
  componentDirectory,
  normalizeArchetype,
  type RepositoryArchetype,
} from './dto';

/**
 * The taxonomy, asserted rather than assumed. This is the kind of thing that stays correct-looking
 * while being wrong: a directory that disagrees with the server's derivation sends a create request
 * to the wrong group.
 */
describe('normalizeArchetype', () => {
  it('leaves every current value alone', () => {
    for (const type of COMPONENT_TYPES) {
      expect(normalizeArchetype(type.archetype)).toBe(type.archetype);
    }
    expect(normalizeArchetype('PROJECT')).toBe('PROJECT');
    expect(normalizeArchetype('FORK')).toBe('FORK');
  });

  /** A value this build has never heard of passes through, so the page can show it as unknown. */
  it('passes an unrecognised value through untouched', () => {
    expect(normalizeArchetype('WIDGET' as RepositoryArchetype)).toBe('WIDGET');
  });

  /**
   * A row can carry no archetype at all now: under the component layout no directory states a
   * kind. Defaulting one here would be a guess that decides which applications the platform files
   * under the repository, so the null is kept.
   */
  it('keeps a row that has no archetype without one', () => {
    expect(normalizeArchetype(null)).toBeNull();
  });
});

describe('componentDirectory', () => {
  it('mounts a component under the layout’s own first segment', () => {
    expect(componentDirectory('qits-ci')).toBe('components/qits-ci');
    expect(COMPONENTS_DIRECTORY).toBe('components');
  });
});

describe('COMPONENT_TYPES', () => {
  it('names the seven placeable archetypes and their wrapper directories, in display order', () => {
    expect(COMPONENT_TYPES.map((type) => type.archetype)).toEqual([
      'SERVICE',
      'DAEMON',
      'LIBRARY',
      'APP',
      'FRONTEND',
      'CLI',
      'IMAGE',
    ]);
    expect(COMPONENT_TYPES.map((type) => type.directory)).toEqual([
      'services',
      'daemons',
      'libs',
      'apps',
      'frontends',
      'cli',
      'images',
    ]);
  });

  /**
   * `apps` is asserted on its own as well as in the list, because the list is the kind of thing a
   * merge re-orders without anyone noticing and the two facts it carries are load-bearing
   * separately.
   *
   * <p>The **word** is what every address of an `APP` repository is spelled with —
   * `/<project>/apps/<name>` — and it is the same word the deployer, the edge and the chrome key a
   * slot on, so a typo here is a page that renders under one host and 404s under the next.
   *
   * <p>The **position** is the platform's order, not a preference: after the libraries and before
   * the frontends, matching `DeploymentSpecParser.SLOTS`, `EdgeRoutes.SLOTS` and
   * `QITS_NAV_SLOTS`.
   */
  it('files an app between the libraries and the frontends, where the platform files it', () => {
    const directories = COMPONENT_TYPES.map((type) => type.directory);

    expect(directories.indexOf('apps')).toBe(directories.indexOf('libs') + 1);
    expect(directories.indexOf('apps')).toBe(directories.indexOf('frontends') - 1);
  });

  /**
   * An app is a standalone web application — its own server, its own image, its own deployment —
   * where a frontend is a microfrontend a service carries. Two rows, two labels, and the singular
   * is what the "New <singular>" affordance says.
   */
  it('gives the app its own words, distinct from the frontend’s', () => {
    expect(COMPONENT_TYPES.find((type) => type.archetype === 'APP')).toEqual({
      archetype: 'APP',
      directory: 'apps',
      label: 'Apps',
      singular: 'app',
    });
    expect(COMPONENT_TYPES.find((type) => type.archetype === 'FRONTEND')).toEqual({
      archetype: 'FRONTEND',
      directory: 'frontends',
      label: 'Frontends',
      singular: 'frontend',
    });
  });
});
