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
import type { ProjectDto } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { ProjectsStore } from '../api/projects-store';
import { RefinementPanel } from './agent/refinement-panel';
import { EpicsOverview } from './epics-overview';

/**
 * A project: its name, the way in to setting it up, and the epics it is being changed by.
 *
 * <p>This address used to carry everything — the project repository's state, the six component
 * groups, the reconcile — and all of that is configuration, which is touched rarely. So the page a
 * reader arrives at most often was the page they needed least, and there was nowhere to put what a
 * project is mostly *for*. That work moved to `project-setup`, and the epics are what fills the
 * space it left: the plan a project is being changed by is the thing worth arriving at.
 *
 * <p>The name itself still **costs nothing** — it comes from the shared project list the
 * sub-navigation has already read. The epics are this page's own read; the overview owns it, along
 * with its loading, empty and failed states.
 *
 * <p>The refinement agent sits between the two, and it sits there **dormant**: the panel is one
 * collapsed row until somebody asks for it, so arriving here still costs exactly the epics read.
 * Its place is deliberate — the agent is what changes the plan below it, so it reads as the way in
 * to that plan rather than as a tool parked at the bottom of the page.
 *
 * <p><b>The ad-hoc workspace link is the page's own second read.</b> It offers a disposable
 * checkout of the project's wrapper and every submodule under it — the local development loop, in a
 * workspace — and qits-workspaces addresses that by repository id, so the components read is what
 * this page has to make to know the id and to know there is a wrapper at all. A project without one
 * has nothing to branch, and shows no link rather than a link that answers nothing. It is a plain
 * `href` and not a `routerLink`: `/workspaces/` is another application behind the same gateway.
 */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EpicsOverview, RefinementPanel, RouterLink],
  template: `
    <h1>{{ heading() }}</h1>
    @if (description(); as description) {
      <p class="description">{{ description }}</p>
    }

    <p class="actions">
      <a class="setup" routerLink="project-setup">Project setup</a>
      @if (adhocWorkspaceUrl(); as url) {
        <a class="adhoc" [href]="url">Ad-hoc workspace</a>
      }
    </p>

    <app-refinement-panel [projectId]="projectId()" />

    <app-epics-overview [projectId]="projectId()" />
  `,
  styles: `
    :host {
      display: block;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .description {
      margin: 0 0 1rem;
      color: #374151;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      margin: 1rem 0 0;
    }
    /* Anchors rather than qits-buttons: these are navigations, and a button that navigates loses
       the middle click, the context menu and the status bar a link gives for free. */
    .actions a {
      display: inline-block;
      padding: 0.4rem 0.9rem;
      font-weight: 600;
      color: #111827;
      background: #fff;
      border: 1px solid #6b7280;
      border-radius: 999px;
      text-decoration: none;
    }
    .actions a:hover {
      background: #f3f4f6;
    }
    /* Quieter than setup: it leaves this application, and it is the rarer of the two errands. */
    .adhoc {
      color: #374151;
      border-color: #d1d5db;
    }
  `,
})
export class ProjectPage {
  private readonly store = inject(ProjectsStore);
  private readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  protected readonly projectId = computed(() => this.params().get('projectId') ?? '');

  private readonly projects = signal<readonly ProjectDto[]>([]);

  private readonly project = computed(() => {
    const id = this.projectId();
    return this.projects().find((project) => project.id === id);
  });

  /** The project's display name, once the shared list has answered. The id until then. */
  protected readonly heading = computed(() => this.project()?.name ?? this.projectId());

  protected readonly description = computed(() => this.project()?.description ?? '');

  private readonly wrapperRepositoryId = signal<string | null>(null);

  /** The workspaces app's create form, preselected on this project's wrapper. Null without one. */
  protected readonly adhocWorkspaceUrl = computed(() => {
    const wrapper = this.wrapperRepositoryId();
    return wrapper ? `/workspaces/?repository=${encodeURIComponent(wrapper)}` : null;
  });

  constructor() {
    void this.loadProjects();
    // Keyed on the route, because the sub-navigation re-uses this instance for another project.
    effect(() => {
      const projectId = this.projectId();
      this.wrapperRepositoryId.set(null);
      if (projectId) {
        void this.loadWrapper(projectId);
      }
    });
  }

  private async loadProjects(): Promise<void> {
    try {
      this.projects.set(await this.store.projects());
    } catch {
      // The heading falls back to the id. A page that could not name its project is still a page,
      // and the one action on it works either way.
    }
  }

  private async loadWrapper(projectId: string): Promise<void> {
    try {
      const components = await this.api.components(projectId);
      // Only set it if the answer is still about the project on screen.
      if (this.projectId() === projectId) {
        this.wrapperRepositoryId.set(components.wrapper?.repositoryId ?? null);
      }
    } catch {
      // No link. A read that failed says nothing about whether the project has a wrapper, and a
      // link to a create that cannot be preselected is worse than the errand staying in the
      // workspaces app's own picker.
    }
  }
}
