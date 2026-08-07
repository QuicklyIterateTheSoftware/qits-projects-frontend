import { Injectable, inject } from '@angular/core';
import type { ProjectDto } from './dto';
import { ProjectsApi } from './projects-api';

/**
 * The project list, read once per application instance and shared.
 *
 * Two things want it at the same moment and they are not in the same component tree: the
 * sub-navigation's picker lives in the shell, the landing page lives in the outlet, and both are
 * built during the first render. Without a single flight that is two `GET /projects/api/projects`
 * on every load — and worse, two answers that can disagree, so the picker could offer an id the
 * landing page has already decided does not exist.
 *
 * `providedIn: 'root'` is what makes "once" mean once: one instance per `EnvironmentInjector`, so
 * two specs — or two server renders — never share a cache.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsStore {
  private readonly api = inject(ProjectsApi);

  private pending: Promise<readonly ProjectDto[]> | null = null;

  /**
   * Every project. The first call issues the request, every later one gets the same promise.
   *
   * A **failed** read is not cached: the promise is dropped when it rejects, so a retry is a real
   * retry rather than the same rejection handed out forever.
   */
  projects(): Promise<readonly ProjectDto[]> {
    return (this.pending ??= this.api.projects().catch((error) => {
      this.pending = null;
      throw error;
    }));
  }

  /** Drop the cache, so the next caller reads again. Creating a project means this too. */
  forget(): void {
    this.pending = null;
  }
}
