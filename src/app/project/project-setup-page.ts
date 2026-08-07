import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import {
  COMPONENT_TYPES,
  normalizeArchetype,
  type PlaceableArchetype,
  type RepositoryDto,
  type WrapperDto,
} from '../api/dto';
import { ProjectsApi, type ProjectComponents } from '../api/projects-api';
import { Async } from '../ui/async';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { BackupPanel } from './backup-panel';
import { ComponentCard } from './component-card';
import { ProjectRepositoryStatus } from './project-repository-status';

/** The bucket for anything the six groups do not name — visible, and never a "New" affordance. */
export const OTHER_GROUP = 'OTHER';

/** One heading on the setup page and the repositories under it. */
export interface ComponentGroup {
  /** The archetype, or {@link OTHER_GROUP}. */
  readonly key: string;
  readonly label: string;
  /** What one of them is called, for “New <singular>”. Empty for the other bucket. */
  readonly singular: string;
  /** What a "New …" link prefills the create page with. Null for the other bucket. */
  readonly archetype: PlaceableArchetype | null;
  readonly repositories: readonly RepositoryDto[];
}

/**
 * The project's repositories, arranged the way its wrapper directory is.
 *
 * Three rules, and each of them exists because the alternative loses a repository:
 *
 * - **The six groups are always drawn, empty or not.** An empty group is the create affordance —
 *   "this project has no daemons yet, and here is how it gets one" — so hiding it would make the
 *   only way to add the first daemon a URL somebody had to know.
 * - **`PROJECT` is excluded.** The wrapper is not a component of itself; it is drawn above, as the
 *   project's configuration.
 * - **Anything else lands in a visible other bucket** — a fork, a template, an archetype this build
 *   has never heard of. Dropping them would be a page that quietly under-reports what the project
 *   holds; the bucket says "these exist and they are in no group", which is true.
 */
export function groupComponents(repositories: readonly RepositoryDto[]): readonly ComponentGroup[] {
  const normalised = repositories.map((repository) => ({
    repository,
    archetype: normalizeArchetype(repository.archetype),
  }));

  const groups: ComponentGroup[] = COMPONENT_TYPES.map((type) => ({
    key: type.archetype,
    label: type.label,
    singular: type.singular,
    archetype: type.archetype,
    repositories: normalised
      .filter((entry) => entry.archetype === type.archetype)
      .map((entry) => entry.repository),
  }));

  const placeable = new Set<string>(COMPONENT_TYPES.map((type) => type.archetype));
  const other = normalised
    .filter((entry) => entry.archetype !== 'PROJECT' && !placeable.has(entry.archetype))
    .map((entry) => entry.repository);

  return other.length === 0
    ? groups
    : [
        ...groups,
        { key: OTHER_GROUP, label: 'Other', singular: '', archetype: null, repositories: other },
      ];
}

/**
 * Setting a project up: the state of its project repository, and its components grouped by what
 * they are.
 *
 * <p><b>This is everything the project page used to be</b>, moved behind its own route. What it
 * holds is configuration — reconciling membership, re-asserting a dns record, adding a repository —
 * and configuration is touched rarely. Leaving it on the project's own address made the page a
 * reader arrives at most often the page they need least, and left nowhere to put what a project is
 * mostly *for*.
 *
 * <p>The id comes from the route rather than from a selection held anywhere, so this page is a
 * bookmark and a back button as much as it is a click. The fetch is keyed on it: choosing another
 * project in the sub-navigation re-uses this component instance with a new parameter, which is why
 * the read lives in an effect rather than in the constructor.
 */
@Component({
  selector: 'app-project-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, BackupPanel, ComponentCard, ProjectRepositoryStatus, RouterLink],
  templateUrl: './project-setup-page.html',
  styleUrl: './project-setup-page.css',
})
export class ProjectSetupPage {
  private readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  protected readonly projectId = computed(() => this.params().get('projectId') ?? '');

  protected readonly components = signal<Loadable<ProjectComponents>>(LOADING);

  protected readonly repositories = computed<readonly RepositoryDto[]>(() => {
    const state = this.components();
    return state.kind === 'ready' ? state.value.repositories : [];
  });

  protected readonly wrapper = computed<WrapperDto | null>(() => {
    const state = this.components();
    return state.kind === 'ready' ? state.value.wrapper : null;
  });

  protected readonly groups = computed(() => groupComponents(this.repositories()));

  /** True once there is an answer, so the groups are only drawn over real data. */
  protected readonly loaded = computed(() => this.components().kind === 'ready');

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      if (projectId) {
        void this.load(projectId);
      }
    });
  }

  /** Read the components, blanking what is on screen first — arrival, a project hop, a retry. */
  protected async load(projectId = this.projectId()): Promise<void> {
    this.components.set(LOADING);
    await this.read(projectId);
  }

  /**
   * Read them again **without** blanking the page.
   *
   * This is what the reconcile triggers, and the difference matters: dropping to a loading state
   * would destroy the panel whose outcome report the reader is at that moment reading. The rows
   * behind it are a moment stale for one round trip, which is a smaller lie than taking the answer
   * away.
   */
  protected refresh(): Promise<void> {
    return this.read(this.projectId());
  }

  private async read(projectId: string): Promise<void> {
    try {
      this.components.set(ready(await this.api.components(projectId)));
    } catch (error) {
      this.components.set(failed(error));
    }
  }
}
