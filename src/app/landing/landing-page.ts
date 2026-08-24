import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ProjectDto } from '../api/dto';
import { ProjectsStore } from '../api/projects-store';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * `/` itself: which project, when the URL does not say.
 *
 * <p><b>Auto-select lives here, not in the sub-navigation.</b> One project is the shape of this
 * platform today, and a picker that is the only thing on screen is a question with one possible
 * answer. But the redirect is a *navigation*, and a navigation issued from the shell would fire on
 * every route this app has — including a deep link that already named a different project. Here it
 * can only fire where it is meant to: on the one URL that has not chosen yet.
 *
 * <p>It replaces the history entry rather than adding one. Without `replaceUrl` the back button
 * lands on `/`, which immediately redirects forward again — a page the reader cannot leave.
 *
 * <p>Every address it writes is spelled with the project's **slug**, which is what the platform's
 * URL grammar names a project by on every host — see `nav/project-param.ts`.
 */
@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, RouterLink],
  template: `
    <h1>Projects</h1>

    <app-async
      [state]="projects()"
      loadingLabel="Loading the projects"
      errorLabel="Could not load the projects"
      (retry)="reload()"
    />

    @if (loaded(); as projects) {
      @if (projects.length === 0) {
        <app-empty message="No projects yet." />
        <p class="hint">
          A project is its wrapper repository. Import one, or create a project, and its components
          appear here.
        </p>
      } @else if (projects.length > 1) {
        <p class="hint">Select a project in the navigation to see its components.</p>
        <ul class="projects">
          @for (project of projects; track project.id) {
            <li>
              <a [routerLink]="['/', project.slug]">{{ project.name }}</a>
              @if (project.description) {
                <span class="note">{{ project.description }}</span>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .hint {
      color: #6b7280;
    }
    .projects {
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
    }
    .projects li {
      padding: 0.35rem 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .note {
      margin-left: 0.5rem;
      color: #6b7280;
    }
  `,
})
export class LandingPage {
  private readonly store = inject(ProjectsStore);
  private readonly router = inject(Router);

  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** The list, or nothing while it is still a state rather than an answer. */
  protected readonly loaded = computed(() => {
    const state = this.projects();
    return state.kind === 'ready' ? state.value : undefined;
  });

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.projects.set(LOADING);
    try {
      const projects = await this.store.projects();
      this.projects.set(ready(projects));
      if (projects.length === 1) {
        await this.router.navigate(['/', projects[0].slug], { replaceUrl: true });
      }
    } catch (error) {
      this.projects.set(failed(error));
    }
  }
}
