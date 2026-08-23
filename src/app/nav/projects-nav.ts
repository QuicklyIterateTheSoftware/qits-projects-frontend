import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ProjectDto } from '../api/dto';
import { ProjectsStore } from '../api/projects-store';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { ProjectRouteScope } from './project-route-scope';

/**
 * Where to go inside the project the chrome is scoped to, as the sub-menu under this application's
 * entry in the platform navigation.
 *
 * <p><b>The picker that used to head this block now lives in the chrome's top-left slot</b>, where
 * the wordmark was — see `QitsMainLayout`. It moved because it is not this application's control:
 * every resource on the platform belongs to a project, so which project is open is the outermost
 * fact about a page in any SPA, not a sub-menu of one of them. What stays here is what is genuinely
 * local — the two places inside a project that *this* app serves.
 *
 * <p>Which project that is comes from {@link ProjectRouteScope}, the same service the chrome reads,
 * so the pill above and the links below can never name two different projects.
 *
 * <p>The links are <b>guarded to ids that are really in the list</b>. A URL naming a project that
 * does not exist shows no links rather than two that lead to pages with nothing behind them — and
 * the picker above is showing its options in that state, which is the right thing to offer.
 *
 * <p>Declared by the shell, not by a page: `RouterOutlet` destroys the outgoing component after
 * creating the incoming one, so a declaration inside a page would be torn down and rebuilt on every
 * hop, in a menu that did not itself change.
 */
@Component({
  selector: 'app-projects-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (projects().kind === 'error') {
      <p class="hint error" role="alert">Could not load projects.</p>
    } @else if (selected(); as projectId) {
      <ul class="links">
        <li><a [routerLink]="['/', projectId]">Overview</a></li>
        <li><a [routerLink]="['/', projectId, 'project-setup']">Project setup</a></li>
      </ul>
    }
  `,
  styles: `
    /* The layout contributes a bare block and no opinions, so every rule this menu needs is here.
       It renders inside a 240px column that already scrolls and pads, hence no padding of its own. */
    :host {
      display: block;
      min-width: 0;
    }
    .links {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .links a {
      display: block;
      padding: 4px 10px 4px 18px;
      font-size: 13px;
      color: #374151;
      text-decoration: none;
      border-radius: 6px;
      overflow-wrap: anywhere;
    }
    .links a:hover {
      background: #f3f4f6;
      color: #111827;
    }
    .hint {
      margin: 6px 10px;
      font-size: 12px;
      color: #6b7280;
    }
    .error {
      color: #b91c1c;
    }
  `,
})
export class ProjectsNav {
  private readonly store = inject(ProjectsStore);
  private readonly scope = inject(ProjectRouteScope);

  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** The project on screen — or nothing, for a URL naming one this list does not contain. */
  protected readonly selected = computed(() => {
    const id = this.scope.projectId();
    const state = this.projects();
    if (!id || state.kind !== 'ready') return undefined;
    return state.value.some((project) => project.id === id) ? id : undefined;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.projects.set(LOADING);
    try {
      this.projects.set(ready(await this.store.projects()));
    } catch (error) {
      this.projects.set(failed(error));
    }
  }
}
