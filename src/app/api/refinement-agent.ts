import { Injectable, inject, signal } from '@angular/core';
import {
  CommandsApi,
  type AgentLaunchMode,
  type AgentSurface,
  type AgentType,
  type AgentWorktreeStart,
  type AgentWorktreeStarted,
} from './commands-api';
import type { RefinementDto } from './refinements-api';

/** What a refining caller decides about a start; the room supplies everything else. */
export interface RefinementAgentLaunch {
  readonly mode: AgentLaunchMode;
  readonly surface: AgentSurface;
  readonly harness?: AgentType;
  readonly sessionId?: string;
  readonly instruction?: string;
}

/** The entity facts a start seeds the session name from. All optional: a start works without them. */
export interface RefinementEntityFacts {
  readonly id: string;
  readonly qualifiedId: string | null;
  readonly title?: string;
  readonly status?: string | null;
  readonly blocked?: boolean;
}

/**
 * The one agent a refinement room's container runs, and the address everything about it hangs off.
 *
 * Since qits-1152 the workspace daemon serves no checkout-wide `POST /agents`, `/files`,
 * `/detection` or `/component-map`: each agent has its own worktree under
 * `/agent-worktrees/{agentId}`, and nothing answers until that agent was started. A room has exactly
 * one agent, so the room's panels keep addressing the container by the refinement's row id and this
 * resolves the agent from it.
 *
 * The rooms are learnt from the listing the refining page reads — {@link observe} is called before
 * the rows are published, so a panel never asks for a room this has not seen — and kept in a plain
 * map rather than a signal for the same reason {@link ../refining/agent-activity-memory} is: nothing
 * renders off it. {@link started} is the one signal, the ping a worktree's readers re-read on.
 *
 * A stop-gap until epic qits-770 moves the room to the project desk.
 */
@Injectable({ providedIn: 'root' })
export class RefinementAgent {
  private readonly commands = inject(CommandsApi);

  private readonly rooms = new Map<number, { entityId: string; branch: string }>();
  private readonly entities = new Map<string, RefinementEntityFacts>();
  private readonly starts = signal<ReadonlyMap<number, number>>(new Map());

  /** Learn the rooms a listing names. Called on every listing read, before it is published. */
  observe(rows: readonly RefinementDto[]): void {
    for (const row of rows) {
      const entityId = row.entityId ?? row.epicId ?? '';
      if (entityId) {
        this.rooms.set(row.id, { entityId, branch: row.branch ?? '' });
      }
    }
  }

  /** Learn what the page resolved about an entity, for {@link start} to seed the session with. */
  describe(entity: RefinementEntityFacts): void {
    this.entities.set(entity.id, entity);
  }

  /** The agent a room runs: qits-1285 — a room's one agent is named by its entity's id. */
  agentId(refinementId: number): string {
    const room = this.rooms.get(refinementId);
    if (!room) {
      throw new Error(`No refinement room ${refinementId} is known on this page.`);
    }
    return room.entityId;
  }

  /** The proxy-relative path of one of the room's agent's own routes. */
  path(refinementId: number, route: string): string {
    return `/agent-worktrees/${encodeURIComponent(this.agentId(refinementId))}${route}`;
  }

  /**
   * How many starts this page has seen succeed for the room. Read by the worktree's readers, which
   * answered 404 until the first one.
   */
  started(refinementId: number): number {
    return this.starts().get(refinementId) ?? 0;
  }

  /** What `POST /agent-worktrees` is sent for this room. */
  body(refinementId: number, launch: RefinementAgentLaunch): AgentWorktreeStart {
    const agentId = this.agentId(refinementId);
    const branch = this.rooms.get(refinementId)?.branch ?? '';
    const entity = this.entities.get(agentId);
    return {
      agentId,
      workId: entity?.qualifiedId || agentId,
      wrapperBranch: branch,
      entityId: agentId,
      mode: launch.mode,
      surface: launch.surface,
      ...(launch.harness ? { harness: launch.harness } : {}),
      ...(launch.sessionId ? { sessionId: launch.sessionId } : {}),
      ...(launch.instruction ? { instruction: launch.instruction } : {}),
      ...(entity?.title ? { entityTitle: entity.title } : {}),
      ...(entity?.status ? { entityStatus: entity.status } : {}),
      ...(entity?.blocked !== undefined ? { entityBlocked: entity.blocked } : {}),
    };
  }

  /**
   * Start the room's agent, or find it running. Refusals — `409 not-signed-in` among them — reach the
   * caller unchanged.
   */
  async start(refinementId: number, launch: RefinementAgentLaunch): Promise<AgentWorktreeStarted> {
    const started = await this.commands.startAgentWorktree(
      refinementId,
      this.body(refinementId, launch),
    );
    this.starts.update((starts) =>
      new Map(starts).set(refinementId, (starts.get(refinementId) ?? 0) + 1),
    );
    return started;
  }
}
