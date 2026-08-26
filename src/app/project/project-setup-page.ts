import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  COMPONENT_TYPES,
  normalizeArchetype,
  type PlaceableArchetype,
  type RepositoryDto,
  type WrapperDto,
} from '../api/dto';
import { ProjectsApi, type ProjectComponents } from '../api/projects-api';
import { ProjectParam } from '../nav/project-param';
import { Async } from '../ui/async';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { BackupPanel } from './backup-panel';
import { ComponentCard } from './component-card';
import { ProjectRepositoryStatus } from './project-repository-status';

/** The bucket for anything the six groups do not name — visible, and never a "New" affordance. */
export const OTHER_GROUP = 'OTHER';

/** What "no row is undeclared" is, before the first answer arrives. */
const EMPTY: ReadonlySet<string> = new Set<string>();

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
 * <p>The project comes from the address rather than from a selection held anywhere, so this page
 * is a bookmark and a back button as much as it is a click. The fetch is keyed on it: choosing
 * another project in the picker re-uses this component instance with a new first segment, which is
 * why the read lives in an effect rather than in the constructor.
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
  private readonly param = inject(ProjectParam);

  /** The id every request takes. Empty until the project list has resolved the address. */
  protected readonly projectId = this.param.projectId;

  /**
   * The project's slug — what the clone urls on this page are spelled with, and what every link
   * out of it names.
   *
   * It is the address's own first segment once the shared project list has answered, so it costs
   * no request of its own; until then it is the raw segment, which is a correct url either way —
   * qits-projects resolves that path by id as well as by slug.
   */
  protected readonly projectSlug = this.param.projectSlug;

  protected readonly components = signal<Loadable<ProjectComponents>>(LOADING);

  protected readonly repositories = computed<readonly RepositoryDto[]>(() => {
    const state = this.components();
    return state.kind === 'ready' ? state.value.repositories : [];
  });

  /**
   * The ids of the rows no wrapper entry names — the server's own verdict, carried as it came.
   *
   * The page does not recompute it from {@link wrapper}. The panel above does compare the two, but
   * that comparison drives a summary sentence; this drives a delete button, and a button that
   * deleted a repository on a rule this client guessed at is a different class of mistake.
   */
  protected readonly undeclared = computed<ReadonlySet<string>>(() => {
    const state = this.components();
    return state.kind === 'ready' ? state.value.undeclared : EMPTY;
  });

  protected readonly wrapper = computed<WrapperDto | null>(() => {
    const state = this.components();
    return state.kind === 'ready' ? state.value.wrapper : null;
  });

  protected readonly groups = computed(() => groupComponents(this.repositories()));

  /** True once there is an answer, so the groups are only drawn over real data. */
  protected readonly loaded = computed(() => this.components().kind === 'ready');

  /** Which repository's delete is in flight, or null. One at a time; it is a rare, heavy move. */
  protected readonly deleting = signal<string | null>(null);

  /** The last delete failure, and which card it belongs on. */
  protected readonly deleteFailure = signal<{ id: string; message: string } | null>(null);

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
    // A failure belongs to the list it was reported against, so a hop or a retry retires it.
    this.deleteFailure.set(null);
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

  /** Why this card's delete failed, or null — so a failure sits on the row it is about. */
  protected deleteMessage(repositoryId: string): string | null {
    const failure = this.deleteFailure();
    return failure && failure.id === repositoryId ? failure.message : null;
  }

  /**
   * Delete one repository, then read the list again.
   *
   * The re-read is the whole point of doing this here rather than in the card: the row is gone on
   * the server and the groups, the drift sentence and the backup summary are all drawn from the
   * same answer. Splicing it out locally would leave four things agreeing with a guess.
   */
  protected async remove(repositoryId: string): Promise<void> {
    this.deleting.set(repositoryId);
    this.deleteFailure.set(null);
    try {
      await this.api.deleteRepository(repositoryId);
      await this.refresh();
    } catch (error) {
      this.deleteFailure.set({ id: repositoryId, message: describeError(error) });
    } finally {
      this.deleting.set(null);
    }
  }

  private async read(projectId: string): Promise<void> {
    try {
      this.components.set(ready(await this.api.components(projectId)));
    } catch (error) {
      this.components.set(failed(error));
    }
  }
}
