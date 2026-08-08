import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { EpicStatus } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { EpicActions } from './epic-actions';
import { EpicCard } from './epic-card';
import { EpicDraftCard } from './epic-draft-card';
import { EpicSummaryRow } from './epic-summary-row';
import { actionsFor, epicAnchor, epicTitles, groupEpics, type EpicNode } from './epics-model';

/** Which epic a transition is running against, and where it is trying to take it. */
interface InFlight {
  readonly id: string;
  readonly target: EpicStatus;
}

/** Why the last transition on one epic did not happen, kept beside the epic it is about. */
interface Failure {
  readonly id: string;
  readonly message: string;
}

/**
 * The epics a project is being changed by, grouped by where each one stands.
 *
 * <p><b>One state for the whole fan-out.</b> The service answers the three levels separately, so a
 * full tree is one read plus one per epic plus one per feature — but a card holding a feature whose
 * tasks are still in flight is a card that says an epic is smaller than it is. So the panel waits
 * for all of it and shows one loading state, and a failure anywhere is a failure of the panel with
 * one retry, rather than a page of half-drawn cards each offering its own.
 *
 * <p>The read is keyed on the project id in an effect, because the sub-navigation re-uses this
 * instance across a project hop. **A late answer is dropped** rather than rendered: the fan-out is
 * several round trips deep, so a hop can easily land while an older tree is still assembling, and
 * the last response to arrive is not the one the route is on.
 *
 * <p><b>Grouped from the one read, never from `?status=`.</b> The filter exists on the server, but
 * asking it five times would be five moments, and one of the five groups cannot be asked for at all
 * — done is a shape of the tree rather than a value on the row. So the fan-out stays single and
 * `groupEpics` does the splitting.
 *
 * <p><b>Two sections are always there, three appear only when they hold something.</b> Refining and
 * implementation are the work, so an empty one is a fact worth stating; done, superseded and
 * abandoned are the record, so they open collapsed with their count and stay out of the way of a
 * project that has none.
 *
 * <p>A transition re-reads the whole tree rather than splicing the answer in: superseding creates a
 * second epic, and a panel that patched one row would show a draft that is not there.
 */
@Component({
  selector: 'app-epics-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, EpicActions, EpicCard, EpicDraftCard, EpicSummaryRow],
  template: `
    <h2>Epics</h2>

    <app-async
      [state]="epics()"
      loadingLabel="Loading the epics"
      errorLabel="Could not load the epics"
      (retry)="load()"
    />

    @if (loaded()) {
      @if (nodes().length === 0) {
        <app-empty message="This project has no epics yet." />
      } @else {
        <section class="group">
          <h3>Refining</h3>
          @if (groups().refining.length === 0) {
            <app-empty message="No epic is being drafted." />
          } @else {
            <div class="cards">
              @for (node of groups().refining; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-draft-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="transition(node, $event)"
                  />
                </div>
              }
            </div>
          }
        </section>

        <section class="group">
          <h3>Implementation</h3>
          @if (groups().implementation.length === 0) {
            <app-empty message="No epic is being implemented." />
          } @else {
            <div class="cards">
              @for (node of groups().implementation; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="transition(node, $event)"
                  />
                </div>
              }
            </div>
          }
        </section>

        @if (groups().done.length > 0) {
          <details class="group">
            <summary>Done ({{ groups().done.length }})</summary>
            <div class="cards">
              @for (node of groups().done; track node.epic.id) {
                <div class="entry" [id]="anchor(node)">
                  <app-epic-card [node]="node" />
                  <app-epic-actions
                    [actions]="actions(node)"
                    [disabled]="inFlight() !== null"
                    [running]="running(node)"
                    [error]="error(node)"
                    (chosen)="transition(node, $event)"
                  />
                </div>
              }
            </div>
          </details>
        }

        @if (groups().superseded.length > 0) {
          <details class="group">
            <summary>Superseded ({{ groups().superseded.length }})</summary>
            <div class="rows">
              @for (node of groups().superseded; track node.epic.id) {
                <app-epic-summary-row [node]="node" [successorTitle]="successorTitle(node)" />
              }
            </div>
          </details>
        }

        @if (groups().abandoned.length > 0) {
          <details class="group">
            <summary>Abandoned ({{ groups().abandoned.length }})</summary>
            <div class="rows">
              @for (node of groups().abandoned; track node.epic.id) {
                <app-epic-summary-row [node]="node" />
              }
            </div>
          </details>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 1.5rem 0 0;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      color: #111827;
    }
    h3 {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    .group {
      margin-top: 1rem;
    }
    summary {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #6b7280;
    }
    details .cards,
    details .rows {
      margin-top: 0.5rem;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
  `,
})
export class EpicsOverview {
  private readonly api = inject(ProjectsApi);

  readonly projectId = input.required<string>();

  protected readonly epics = signal<Loadable<readonly EpicNode[]>>(LOADING);

  protected readonly inFlight = signal<InFlight | null>(null);

  protected readonly failure = signal<Failure | null>(null);

  protected readonly loaded = computed(() => this.epics().kind === 'ready');

  protected readonly nodes = computed<readonly EpicNode[]>(() => {
    const state = this.epics();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly groups = computed(() => groupEpics(this.nodes()));

  private readonly titles = computed(() => epicTitles(this.nodes()));

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      if (projectId) {
        void this.load(projectId);
      }
    });
  }

  protected anchor(node: EpicNode): string {
    return epicAnchor(node.epic.id);
  }

  protected actions(node: EpicNode) {
    return actionsFor(node.epic.status);
  }

  protected running(node: EpicNode): EpicStatus | null {
    const flight = this.inFlight();
    return flight?.id === node.epic.id ? flight.target : null;
  }

  protected error(node: EpicNode): string | null {
    const failure = this.failure();
    return failure?.id === node.epic.id ? failure.message : null;
  }

  /** The successor's title when this list holds it; null draws no link — see the row component. */
  protected successorTitle(node: EpicNode): string | null {
    const id = node.epic.supersededByEpicId;
    return id ? (this.titles().get(id) ?? null) : null;
  }

  /**
   * Move one epic, then re-read everything.
   *
   * A failure — the 409 an illegal move answers — leaves the tree alone and puts the server's
   * sentence beside the card, because the screen is still correct: nothing moved.
   */
  protected async transition(node: EpicNode, target: EpicStatus): Promise<void> {
    const id = node.epic.id;
    this.inFlight.set({ id, target });
    this.failure.set(null);
    try {
      await this.api.transitionEpic(id, target);
      await this.load();
    } catch (error) {
      this.failure.set({ id, message: describeError(error) });
    } finally {
      this.inFlight.set(null);
    }
  }

  /** Read the whole tree, blanking what is on screen first — arrival, a project hop, a retry. */
  protected async load(projectId = this.projectId()): Promise<void> {
    this.epics.set(LOADING);
    try {
      const tree = await this.read(projectId);
      if (projectId === this.projectId()) {
        this.epics.set(ready(tree));
      }
    } catch (error) {
      if (projectId === this.projectId()) {
        this.epics.set(failed(error));
      }
    }
  }

  /** The epics, then their features, then their tasks — each level in parallel across its parents. */
  private async read(projectId: string): Promise<readonly EpicNode[]> {
    const epics = await this.api.epics(projectId);
    return Promise.all(
      epics.map(async (epic) => ({
        epic,
        features: await Promise.all(
          (await this.api.features(epic.id)).map(async (feature) => ({
            feature,
            tasks: await this.api.tasks(feature.id),
          })),
        ),
      })),
    );
  }
}
