import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ProjectsApi } from '../api/projects-api';
import type { WorkspaceDto } from '../api/workspaces-dto';
import { WorkspacesApi } from '../api/workspaces-api';
import { refiningBranch, type EpicNode } from '../project/epics-model';

/** The characters a workspace label may hold, per qits-workspaces' own validation. */
const LABEL_ALLOWED = /[^A-Za-z0-9_-]+/g;

/** The label cap, server-side. */
const LABEL_MAX_LENGTH = 64;

/**
 * Where the wrapper repository's `.gitmodules` says the plan lives — nothing, in Phase A: the refining
 * branch is cut from the repository's main branch, and a blank `parent` is how the service is told to
 * use it.
 *
 * Blank rather than the literal `"main"`: the wrapper's default branch is qits-projects'
 * `Repository.mainBranch` and no repository on this platform promises to call it `main`. Sending a
 * guess would fork from a ref that may not exist; sending nothing makes the service answer the question
 * it already knows the answer to.
 */
const PARENT_IS_REPOSITORY_DEFAULT = '';

/** The project's wrapper repository, in the two facts a refining flow needs from it. */
export interface RefiningWrapper {
  /** The row id qits-workspaces scopes a workspace by. */
  readonly repositoryId: string;
  /** Its default branch — what a refining branch is cut from, and what decides the door home. */
  readonly mainBranch: string;
}

/**
 * Starting and finding the workspace an epic is refined in.
 *
 * <p><b>The workspace is looked up, never stored.</b> The refining workspace of an epic *is* the ACTIVE
 * workspace whose `branch` is `refining/<epicSlug>` in the project's wrapper repository. There is no
 * column joining the two and no field to keep in step — a discarded workspace simply stops matching,
 * and the same press that opened one opens a fresh one. That is the whole reason this is a small service
 * rather than state on a page: two callers (the epic card's button and the refining page's own resolve)
 * have to reach the identical answer, and any cached association between them could disagree.
 *
 * <p><b>The browser is the integrator.</b> qits-projects does not call qits-workspaces and must not
 * start — the service arrow runs one way — so this class reads both services from the page,
 * same-origin through the gateway. Nothing on either server changed to make refining possible.
 *
 * <p><b>The create is what creates the branch.</b> `POST /workspaces/api/workspaces` with
 * `adoptExisting: false` pushes the new ref through the git host itself. There is deliberately no
 * second mechanism here: a client that created the branch first and then adopted it would be racing
 * the service for the same ref, and would have to invent an error story for losing.
 */
@Injectable({ providedIn: 'root' })
export class RefiningService {
  private readonly projects = inject(ProjectsApi);
  private readonly workspaces = inject(WorkspacesApi);

  /**
   * The project's wrapper repository: which one it is, and what its default branch is called.
   *
   * <p>Read from the repositories listing, which **already carries both** — `GET …/repositories`
   * answers `{entries, wrapper}`, and drift is the difference between the two, so the service returns
   * them together. Re-deriving the wrapper's name as `<slug>-<slug>` and asking for it by name would be
   * a second, guessable copy of a fact the first read already stated, and would be wrong for any
   * project whose wrapper is not named by that convention.
   *
   * <p>Both facts come from that one read for the same reason: the id is what a create is scoped by and
   * the default branch is what decides the door home, and asking twice would be two moments for one
   * repository. `mainBranch` is empty when no row matches the wrapper — which the merge panel reads as
   * "no default branch known" and answers with the integrate door, the safe reading.
   *
   * <p>A project with **no wrapper** is refused rather than worked around. It is not a project that
   * happens to be empty: it is a project with nothing to cut a branch on, so there is no plausible
   * answer to invent, and the sentence says so.
   */
  async wrapper(projectId: string): Promise<RefiningWrapper> {
    const components = await this.projects.components(projectId);
    if (!components.wrapper) {
      throw new Error(
        'this project has no wrapper repository, so there is nothing to cut a refining branch on',
      );
    }
    const repositoryId = components.wrapper.repositoryId;
    const row = components.repositories.find((entry) => entry.id === repositoryId);
    return { repositoryId, mainBranch: row?.mainBranch ?? '' };
  }

  /**
   * The live refining workspace for this epic, or null.
   *
   * The listing answers ACTIVE workspaces only, so a match *is* a live workspace and an absence is
   * either "never started" or "discarded" — which are the same thing to every caller here, because both
   * are answered by starting one.
   */
  async find(repositoryId: string, epicSlug: string): Promise<WorkspaceDto | null> {
    const branch = refiningBranch(epicSlug);
    const workspaces = await this.workspaces.workspaces(repositoryId);
    return workspaces.find((entry) => entry.branch === branch) ?? null;
  }

  /**
   * Find the epic's refining workspace or make one, and answer it either way.
   *
   * <p>Three steps and two of them are error recovery, which is the honest shape of a create against a
   * branch namespace two people can reach at once:
   *
   * <ol>
   *   <li>The listing already has one → that is the answer, and no request is made.
   *   <li>Create with `adoptExisting: false`, which cuts the branch. A **409** here means the branch is
   *       already there without an active workspace — the state a discard leaves behind, since a
   *       discard resolves the workspace and does not delete the ref.
   *   <li>Retry once with `adoptExisting: true`, taking over that branch. A **409** on *this* attempt
   *       means somebody else's create won the race in between, so the list is re-read and their
   *       workspace is the answer.
   * </ol>
   *
   * <p>The two 409s cannot be told apart structurally — every qits service maps a domain exception
   * through one `{"message": …}` envelope — and they are deliberately not distinguished by prose here.
   * The *sequence* distinguishes them: attempt two is the cure for the first, and a re-read is the cure
   * for the second, so a wrong reading of the message cannot send the flow anywhere wrong. If the
   * re-read finds nothing either, the second failure is thrown as it arrived rather than smoothed over.
   */
  async open(projectId: string, node: EpicNode): Promise<WorkspaceDto> {
    const { repositoryId } = await this.wrapper(projectId);
    const existing = await this.find(repositoryId, node.epic.slug);
    if (existing) {
      return existing;
    }

    const request = {
      repositoryId,
      id: workspaceLabel(node.epic.slug),
      parent: PARENT_IS_REPOSITORY_DEFAULT,
      branch: refiningBranch(node.epic.slug),
      preamble: preamble(node),
    };
    try {
      return await this.workspaces.createWorkspace({ ...request, adoptExisting: false });
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
    try {
      return await this.workspaces.createWorkspace({ ...request, adoptExisting: true });
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
      const raced = await this.find(repositoryId, node.epic.slug);
      if (!raced) {
        throw error;
      }
      return raced;
    }
  }

  /**
   * The same flow, from a slug alone — what the refining page's own create offer presses.
   *
   * It reads the one epic's features and tasks first, because the preamble is the workspace's stated
   * goal and an outline is most of it. The overview never calls this: it is already holding the tree, so
   * asking for it again would be several round trips for data in hand.
   */
  async openBySlug(projectId: string, epicSlug: string): Promise<WorkspaceDto> {
    return this.open(projectId, await this.node(projectId, epicSlug));
  }

  /**
   * One epic of a project, with its features and their tasks, found by slug.
   *
   * The slug and not the id, because the slug is what the URL carries: it is the immutable git-safe
   * identity the branch name is composed from, so a refining page addressed by it names the same branch
   * the epics overview would.
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

/** Whether a rejection is the 409 the create answers for a branch that is already taken. */
function isConflict(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409;
}

/**
 * The workspace's requested **label** — a display name, not an identifier.
 *
 * qits-workspaces accepts `[A-Za-z0-9_-]` up to 64 characters, and a slug is git-safe rather than
 * label-safe: dots are legal in a slug and not here. So anything outside the set collapses to a single
 * dash and the whole thing is capped. The label is decoration — the created workspace's identity comes
 * back in the answer, and the *branch* is what the lookup matches on — so a collapse that loses a
 * character costs nothing, where sending the slug raw would cost a 400.
 */
export function workspaceLabel(epicSlug: string): string {
  const cleaned = `refining-${epicSlug}`.replace(LABEL_ALLOWED, '-');
  return cleaned.slice(0, LABEL_MAX_LENGTH);
}

/**
 * The workspace's preamble: what this workspace is for, in markdown.
 *
 * It is the epic as it stands — title, description, and the feature/task outline — because the preamble
 * is the only thing the workspace carries about *why* it exists, and it is what a coding agent opening
 * the workspace reads first. A snapshot rather than a live view, deliberately: the plan is what the
 * refining session is about to change, so a preamble that silently tracked the changes would stop being
 * the statement of the goal and become a second, worse copy of the epics tree.
 */
export function preamble(node: EpicNode): string {
  const lines: string[] = [`# Refine: ${node.epic.title}`, ''];
  lines.push(node.epic.description ?? '_This draft has no description yet._', '');
  lines.push('## Outline as it stands', '');
  if (node.features.length === 0) {
    lines.push('_No features drafted yet._');
  } else {
    for (const child of node.features) {
      lines.push(`- **${child.feature.title}**${suffix(child.feature.description)}`);
      for (const task of child.tasks) {
        lines.push(`  - ${task.title}${suffix(task.description)}`);
      }
    }
  }
  return lines.join('\n');
}

function suffix(description: string | null): string {
  return description ? ` — ${description}` : '';
}
