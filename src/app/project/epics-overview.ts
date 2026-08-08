import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ProjectsApi } from '../api/projects-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { EpicCard } from './epic-card';
import type { EpicNode } from './epics-model';

/**
 * The epics a project is being changed by, read-only.
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
 */
@Component({
  selector: 'app-epics-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, EpicCard],
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
        <div class="cards">
          @for (node of nodes(); track node.epic.id) {
            <app-epic-card [node]="node" />
          }
        </div>
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

  protected readonly loaded = computed(() => this.epics().kind === 'ready');

  protected readonly nodes = computed<readonly EpicNode[]>(() => {
    const state = this.epics();
    return state.kind === 'ready' ? state.value : [];
  });

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      if (projectId) {
        void this.load(projectId);
      }
    });
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
