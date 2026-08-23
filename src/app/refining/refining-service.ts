import { Injectable, inject } from '@angular/core';
import { ProjectsApi } from '../api/projects-api';
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import type { EpicNode } from '../project/epics-model';

/**
 * Starting and finding the refinement an epic is refined in.
 *
 * <p><b>qits-projects owns the whole flow now.</b> A refinement used to be an ordinary
 * qits-workspaces workspace the browser created against the wrapper repository, with the
 * `refining/` branch prefix as a convention only this SPA knew — which is why refining branches
 * leaked into the workspaces overview. The find/create, the branch cut, the adopt-existing dance
 * and the preamble all moved server-side, keyed by the epic: {@link open} is one idempotent POST,
 * and two racing opens are settled by the server's unique constraint rather than by client
 * choreography.
 *
 * <p>{@link find} deliberately never creates — it is the page's own resolve, which renders "no
 * refinement yet" as an offer rather than eagerly cutting a branch on every visit.
 */
@Injectable({ providedIn: 'root' })
export class RefiningService {
  private readonly projects = inject(ProjectsApi);
  private readonly refinements = inject(RefinementsApi);

  /** The epic's live refinement, or null. A list read, so peers come for free elsewhere. */
  async find(projectId: string, epicId: string): Promise<RefinementDto | null> {
    const rows = await this.refinements.list(projectId);
    return rows.find((row) => row.epicId === epicId) ?? null;
  }

  /** Find the epic's refinement or make one — the server cuts or adopts the branch either way. */
  async open(node: EpicNode): Promise<RefinementDto> {
    return this.refinements.open(node.epic.id);
  }

  /** The same flow, from a slug alone — what the refining page's own create offer presses. */
  async openBySlug(projectId: string, epicSlug: string): Promise<RefinementDto> {
    return this.open(await this.node(projectId, epicSlug));
  }

  /**
   * One epic of a project, with its features and their tasks, found by slug.
   *
   * The slug and not the id, because the slug is what the URL carries: it is the immutable git-safe
   * identity the branch name is composed from, so a refining page addressed by it names the same
   * branch the epics overview would.
   */
  async node(projectId: string, epicSlug: string): Promise<EpicNode> {
    const epics = await this.projects.epics(projectId);
    const epic = epics.find((candidate) => candidate.slug === epicSlug);
    if (!epic) {
      throw new Error(`this project has no epic called “${epicSlug}”`);
    }
    const features = await this.projects.features(epic.id);
    return {
      epic,
      features: await Promise.all(
        features.map(async (feature) => ({
          feature,
          tasks: await this.projects.tasks(feature.id),
        })),
      ),
    };
  }
}
