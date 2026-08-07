import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { QitsPicker, type QitsPickerOption } from '@qits/ui-components';
import type { ProjectDto } from '../api/dto';
import { ProjectsStore } from '../api/projects-store';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * Which project is being looked at, as the sub-menu under this application's entry in the platform
 * navigation — and the two places to go once one is chosen.
 *
 * <p><b>The picker is the whole navigation of this app.</b> Everything below `/projects/` is
 * addressed by project id, so choosing one is not a filter over a page — it *is* the page, and the
 * URL says so. That is why selection is derived from the router rather than held here: a reader
 * arriving on a deep link, pressing back, or being redirected by the landing page must all leave
 * the pill showing the project actually on screen. A local `selected` field would be a second
 * source of truth for something the URL already states, and the two would drift on the back button.
 *
 * <p>The selection is <b>guarded to ids that are really in the list</b>. A URL naming a project
 * that does not exist leaves the picker open on its options instead of showing a pill for a project
 * nobody can visit — and the picker would draw no label for it anyway, because it has no option to
 * take one from.
 *
 * <p>Declared by the shell, not by a page: `RouterOutlet` destroys the outgoing component after
 * creating the incoming one, so a declaration inside a page would be torn down and rebuilt on every
 * hop, in a menu that did not itself change.
 */
@Component({
  selector: 'app-projects-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsPicker, RouterLink],
  template: `
    @switch (projects().kind) {
      @case ('loading') {
        <p class="hint">Loading projects…</p>
      }
      @case ('error') {
        <p class="hint error" role="alert">Could not load projects.</p>
      }
      @default {
        <qits-picker
          [options]="options()"
          [value]="selected()"
          (valueChange)="onProject($event)"
          ariaLabel="Project"
          placeholder="Pick a project"
          emptyLabel="No projects yet"
        />

        @if (selected(); as projectId) {
          <ul class="links">
            <li><a [routerLink]="['/', projectId]">Components</a></li>
            <li><a [routerLink]="['/', projectId, 'repositories', 'new']">New repository</a></li>
          </ul>
        }
      }
    }
  `,
  styles: `
    /* The layout contributes a bare block and no opinions, so every rule this menu needs is here.
       It renders inside a 240px column that already scrolls and pads, hence no padding of its own. */
    :host {
      display: block;
      min-width: 0;
      padding: 4px 0 8px;
    }
    .links {
      list-style: none;
      margin: 6px 0 0;
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
  private readonly router = inject(Router);

  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /**
   * The URL, as a signal, because Angular 21.2 has no signal-valued `Router.url` — only a string
   * getter and `currentNavigation`, which is null once a navigation has finished. So the events are
   * filtered to `NavigationEnd` and the getter read at each one.
   *
   * <p>The seed matters as much as the stream: a reader who lands directly on a project URL gets no
   * `NavigationEnd` before the first render.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The first path segment, which is where every route in this app puts the project id. */
  private readonly routeProjectId = computed(() => {
    const path = this.url().split('#')[0].split('?')[0];
    const first = path.split('/').filter(Boolean)[0];
    return first ? decodeURIComponent(first) : undefined;
  });

  protected readonly options = computed<QitsPickerOption<string>[]>(() => {
    const state = this.projects();
    return state.kind === 'ready'
      ? state.value.map((project) => ({ value: project.id, label: project.name }))
      : [];
  });

  /** The project on screen — or nothing, for a URL naming one this list does not contain. */
  protected readonly selected = computed(() => {
    const id = this.routeProjectId();
    return id && this.options().some((option) => option.value === id) ? id : undefined;
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

  /** Choosing a project goes to it; clearing the picker goes back to the landing page. */
  protected onProject(projectId: string | undefined): void {
    void this.router.navigate(projectId ? ['/', projectId] : ['/']);
  }
}
