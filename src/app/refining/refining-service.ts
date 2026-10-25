import { Injectable, inject } from '@angular/core';
import { EntitiesApi } from '../api/entities-api';
import { RefinementsApi, type RefinementDto } from '../api/refinements-api';
import { flattenEntities, nodeByNumber, type EntityNode } from '../project/entity-nodes';

/**
 * Finding and opening the refinement room of an entity — an epic's, a ticket's (qits-395) or a
 * campaign's (epic qits-770).
 *
 * <p><b>Both doors are the entity's own.</b> `POST /work/{q}/refinement` is find-or-create and
 * `GET` the same path is find-only (`q` the qualified id, or the id); the service opens the room as
 * a session of the project's front desk and settles two racing opens with a unique constraint.
 * Nothing here composes a branch or matches one: a room is found by the entity it names.
 *
 * <p>{@link find} deliberately never creates — it is the room page's own resolve, which renders "no
 * room yet" as an offer rather than eagerly opening one on every visit.
 */
@Injectable({ providedIn: 'root' })
export class RefiningService {
  private readonly entities = inject(EntitiesApi);
  private readonly refinements = inject(RefinementsApi);

  /** The entity's room, or null. Never creates. `ref` is its qualified id (or its id). */
  find(ref: string): Promise<RefinementDto | null> {
    return this.refinements.findFor(ref);
  }

  /**
   * Find the entity's room or make one — an epic's, a ticket's or a campaign's. 409 unless it is
   * REPORTED, or for a feature or a task.
   */
  open(ref: string): Promise<RefinementDto> {
    return this.refinements.openFor(ref);
  }

  /**
   * The project's nodes, and the one a number names — the room is addressed by the entity's number,
   * like its page, and there is no read by number (see {@link flattenEntities}).
   */
  async resolve(
    projectId: string,
    number: number,
  ): Promise<{ readonly node: EntityNode | null; readonly nodes: readonly EntityNode[] }> {
    // Campaigns too: a campaign has a room of its own since epic qits-770.
    const nodes = flattenEntities(await this.entities.list(projectId));
    return { node: nodeByNumber(nodes, number), nodes };
  }
}
