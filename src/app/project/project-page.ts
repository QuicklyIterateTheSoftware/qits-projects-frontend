import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsAppLinks } from '@qits/ui-components';
import { ProjectsApi } from '../api/projects-api';
import { ProjectParam } from '../nav/project-param';
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
 * <p>The name itself still **costs nothing** — it comes from the shared project list `ProjectParam`
 * has already read to resolve the address's slug. The epics are this page's own read; the overview
 * owns it, along with its loading, empty and failed states.
 *
 * <p>The refinement agent sits between the two, and it sits there **dormant**: the panel is one
 * collapsed row until somebody asks for it, so arriving here still costs exactly the epics read.
 * Its place is deliberate — the agent is what changes the plan below it, so it reads as the way in
 * to that plan rather than as a tool parked at the bottom of the page.
 *
 * <p><b>The ad-hoc workspace link is the page's own second read.</b> It offers a disposable
 * checkout of the project's wrapper and every submodule under it — the local development loop, in a
 * workspace — and this page has to know there IS a wrapper before offering it, which is what the
 * components read is for. A project without one shows no link rather than a link that answers
 * nothing.
 *
 * <p>It is a plain `href` and not a `routerLink`, because qits-workspaces is another Angular
 * application on a host of its own: `workspaces.<env>.<domain>/<slug>/`, which the library composes
 * from the navigation the edge answers. An edge that names no workspaces application gives no
 * address, and the page then draws no link — there is nothing left to guess with, now that every
 * service has a host of its own.
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
      @if (workspacesUrl(); as url) {
        <a class="adhoc" [href]="url">Ad-hoc workspace</a>
      }
    </p>

    <app-refinement-panel [projectId]="projectId()" />

    <app-epics-overview [projectId]="projectId()" [projectSlug]="projectSlug()" />
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
  private readonly api = inject(ProjectsApi);
  private readonly param = inject(ProjectParam);
  private readonly appLinks = inject(QitsAppLinks);

  /** The id every request takes, and the slug every link is spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  private readonly project = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value : undefined;
  });

  /** The project's display name, once the shared list has answered. The address until then. */
  protected readonly heading = computed(() => this.project()?.name ?? this.param.segment());

  protected readonly description = computed(() => this.project()?.description ?? '');

  private readonly wrapperRepositoryId = signal<string | null>(null);

  /**
   * The workspaces application, scoped to this project — where its wrapper's ad-hoc workspace is.
   *
   * Null twice over: until the components read says the project has a wrapper at all, because an
   * application with nothing to branch is offered no link; and where the platform names no
   * workspaces application, because there is then no address to write.
   */
  protected readonly workspacesUrl = computed(() => {
    const wrapper = this.wrapperRepositoryId();
    if (!wrapper) return null;
    return this.appLinks.href('qits-workspaces', '', { project: this.projectSlug() }) ?? null;
  });

  constructor() {
    // Keyed on the project, because the picker re-uses this instance for another one.
    effect(() => {
      const projectId = this.projectId();
      this.wrapperRepositoryId.set(null);
      if (projectId) {
        void this.loadWrapper(projectId);
      }
    });
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
