import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import type { ProjectDto } from '../api/dto';
import { ProjectsStore } from '../api/projects-store';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * The project the first path segment names.
 *
 * <p><b>The segment is the slug</b>, everywhere on this platform: `/qits/`,
 * `/qits/services/qits-ci/`, and so on every application host. A slug is readable, it is what a
 * person is asked to type and paste, and it is what the reserved-slug list on the service keeps
 * free of routed segments. The API is the other vocabulary — `GET /projects/api/projects/{id}/…`
 * resolves ids — so this service is the one place the two meet, and every page reads {@link
 * projectId} for a request and {@link projectSlug} for a link.
 *
 * <p><b>A project id in the segment still works, and is corrected rather than served.</b> Every
 * address this application wrote before the slug convention spelled the id, so a bookmark, a chat
 * message and a fragment link all carry them — and answering them with a 404 would break links
 * that are only *old*. The id is resolved, the page renders, and the URL is replaced with the same
 * address spelled with the slug: `replaceUrl`, because the id form is not a place worth having in
 * the back button.
 *
 * <p>Read off the router rather than off an `ActivatedRoute` parameter, deliberately: the shell,
 * the pages and the sub-menu all ask the same question, and only some of them have a route to ask.
 * A single answer is also what keeps the redirect from firing once per page that reads it.
 */
@Injectable({ providedIn: 'root' })
export class ProjectParam {
  private readonly router = inject(Router);
  private readonly store = inject(ProjectsStore);

  /**
   * The URL as a signal — Angular 21.2 has only a string getter and a stream. The seed matters as
   * much as the stream: a reader landing directly on a project URL gets no `NavigationEnd` before
   * the first render.
   */
  private readonly url = signal(this.router.url);

  private readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** The first path segment, as the address spells it — a slug, or a legacy id. */
  readonly segment = computed(() => firstSegment(this.url()));

  /**
   * The project on screen: pending while the list is in flight, and an error for a segment naming
   * no project — which is a 404 the pages draw rather than an empty page pretending to work.
   */
  private readonly current = computed<Loadable<ProjectDto>>(() => {
    const segment = this.segment();
    const state = this.projects();
    if (!segment) return { kind: 'error', status: 404, message: 'no project in the address' };
    if (state.kind !== 'ready') return state as Loadable<ProjectDto>;
    const matched =
      state.value.find((project) => project.slug === segment) ??
      state.value.find((project) => project.id === segment);
    return matched
      ? ready(matched)
      : { kind: 'error', status: 404, message: `No project '${segment}'.` };
  });

  /** The project the address names — the whole state, for a page that draws all three of them. */
  currentProject(): Signal<Loadable<ProjectDto>> {
    return this.current;
  }

  /** The id every API call takes. Empty until the list has answered, so callers guard on it. */
  readonly projectId = computed(() => {
    const state = this.current();
    return state.kind === 'ready' ? state.value.id : '';
  });

  /**
   * The slug every link is spelled with. The raw segment until the list answers, so a link drawn
   * on the first paint still points at the address the reader is already on.
   */
  readonly projectSlug = computed(() => {
    const state = this.current();
    return state.kind === 'ready' ? state.value.slug : this.segment();
  });

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.url.set(this.router.url);
        this.correctLegacyId();
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    void this.load();
  }

  /** Read the shared list, then correct an address that arrived spelling an id. */
  private async load(): Promise<void> {
    try {
      this.projects.set(ready(await this.store.projects()));
    } catch (error) {
      this.projects.set(failed(error));
    }
    this.correctLegacyId();
  }

  /**
   * An id in the first segment becomes the slug, in place.
   *
   * Only the first segment is rewritten — the rest of the path, the query and the fragment travel
   * untouched, so a deep link into an epic or a tab lands where it was going.
   */
  private correctLegacyId(): void {
    const state = this.current();
    if (state.kind !== 'ready') return;
    const segment = this.segment();
    if (!segment || segment === state.value.slug) return;
    void this.router.navigateByUrl(replaceFirstSegment(this.url(), state.value.slug), {
      replaceUrl: true,
    });
  }
}

/** The first path segment of a router URL, decoded, or empty for the root. */
export function firstSegment(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const first = path.split('/').filter((segment) => segment.length > 0)[0];
  if (!first) return '';
  try {
    return decodeURIComponent(first);
  } catch {
    return first;
  }
}

/** The same URL with its first segment swapped — query and fragment kept exactly as they were. */
export function replaceFirstSegment(url: string, segment: string): string {
  const [path, rest] = splitAtQuery(url);
  const segments = path.split('/').filter((part) => part.length > 0);
  segments[0] = encodeURIComponent(segment);
  return `/${segments.join('/')}${rest}`;
}

function splitAtQuery(url: string): readonly [string, string] {
  const at = url.search(/[?#]/);
  return at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at)];
}
