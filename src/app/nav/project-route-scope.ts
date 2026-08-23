import { computed, inject, Injectable, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import type { QitsProjectScope } from '@qits/ui-components';

/**
 * Which project the chrome's picker shows while the reader is in *this* application, and where a
 * pick goes — the platform contract `QITS_PROJECT_SCOPE`, answered from the URL.
 *
 * <p><b>Everything below `/projects/` is addressed by project id</b>, so choosing one is not a
 * filter over a page: it *is* the page, and the URL already says which. That is why the selection
 * is derived rather than held. A reader arriving on a deep link, pressing back, or being redirected
 * by the landing page must all leave the picker showing the project actually on screen; a stored
 * field would be a second source of truth for something the address states, and the two would drift
 * on the back button.
 *
 * <p>This replaces the library's `?project=` default, which is for applications whose own addresses
 * do not name a project yet. Here one is a *path segment*, so `?project=` would be a second, weaker
 * spelling of a fact the path already carries.
 *
 * <p>An id naming no project is passed through unchanged. `QitsPicker` resolves a value against its
 * options and falls back to showing the list when nothing matches, so a stale link lands a reader
 * on the choices rather than on a pill with no label — the guard is the picker's, and duplicating
 * it here would need the project list this service deliberately does not read.
 */
@Injectable({ providedIn: 'root' })
export class ProjectRouteScope implements QitsProjectScope {
  private readonly router = inject(Router);

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
  readonly projectId: Signal<string | undefined> = computed(() => {
    const path = this.url().split('#')[0].split('?')[0];
    const first = path.split('/').filter(Boolean)[0];
    return first ? decodeURIComponent(first) : undefined;
  });

  /** Choosing a project goes to it; clearing the picker goes back to the landing page. */
  select(projectId: string | undefined): void {
    void this.router.navigate(projectId ? ['/', projectId] : ['/']);
  }
}
