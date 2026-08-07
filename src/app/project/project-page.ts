import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import type { ProjectDto } from '../api/dto';
import { ProjectsStore } from '../api/projects-store';

/**
 * A project: its name, and the way in to setting it up.
 *
 * <p><b>Deliberately almost empty, and it is the emptiness that is the change.</b> This address
 * used to carry everything — the project repository's state, the six component groups, the
 * reconcile — and all of that is configuration, which is touched rarely. So the page a reader
 * arrives at most often was the page they needed least, and there was nowhere to put what a project
 * is mostly *for*. That work moved to `project-setup`, and this is now the space it left.
 *
 * <p>What fills it comes later. Until then it says which project is on screen and offers one
 * action, which is more honest than padding it with a summary of the page next door.
 *
 * <p>It makes **no request of its own**: the name comes from the shared project list the
 * sub-navigation has already read, so arriving here costs nothing.
 */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>{{ heading() }}</h1>
    @if (description(); as description) {
      <p class="description">{{ description }}</p>
    }

    <p class="actions">
      <a class="setup" routerLink="project-setup">Project setup</a>
    </p>
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
      margin: 1rem 0 0;
    }
    /* An anchor rather than a qits-button: it is a navigation, and a button that navigates loses
       the middle click, the context menu and the status bar a link gives for free. */
    .setup {
      display: inline-block;
      padding: 0.4rem 0.9rem;
      font-weight: 600;
      color: #111827;
      background: #fff;
      border: 1px solid #6b7280;
      border-radius: 999px;
      text-decoration: none;
    }
    .setup:hover {
      background: #f3f4f6;
    }
  `,
})
export class ProjectPage {
  private readonly store = inject(ProjectsStore);
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

  constructor() {
    void this.loadProjects();
  }

  private async loadProjects(): Promise<void> {
    try {
      this.projects.set(await this.store.projects());
    } catch {
      // The heading falls back to the id. A page that could not name its project is still a page,
      // and the one action on it works either way.
    }
  }
}
