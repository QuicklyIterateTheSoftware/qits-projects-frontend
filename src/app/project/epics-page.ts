import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectParam } from '../nav/project-param';
import { RefinementPanel } from './agent/refinement-panel';
import { EpicsOverview } from './epics-overview';

/**
 * The plan a project is being changed by: its epics, and the agent that drafts them.
 *
 * <p><b>This is what the project's own address used to be.</b> `/<slug>` is a hub now — the project
 * node in the chrome, a list of the ways into it — and the work moved one segment down, beside
 * `project-setup`, `workspaces` and `editor`. The move is what makes the plan a *sub-element* with a
 * row of its own in the sidebar rather than "whatever the project root happens to render", which is
 * what it was: a reader could reach the board only by knowing that the bare project address means
 * epics.
 *
 * <p>Nothing about the board itself changed with the move. The refinement agent came with it,
 * because the agent is what changes the epics below it and the two are one surface — an agent on the
 * hub would talk about a plan that is not on the screen. It is still one collapsed row until
 * somebody asks for it, so arriving here still costs exactly the epics read the overview owns.
 *
 * <p>The heading is this page's own word and the back link carries the project's name, which is the
 * shape every sub-page here has (`project-setup` is the other). Both come from the shared project
 * list `ProjectParam` has already read to resolve the address's slug, so the page adds no request of
 * its own.
 */
@Component({
  selector: 'app-epics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EpicsOverview, RefinementPanel, RouterLink],
  template: `
    <p class="back">
      <a [routerLink]="['/', projectSlug()]">← {{ heading() }}</a>
    </p>

    <h1>Epics</h1>

    <app-refinement-panel [projectId]="projectId()" />

    <app-epics-overview [projectId]="projectId()" [projectSlug]="projectSlug()" />
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
  `,
})
export class EpicsPage {
  private readonly param = inject(ProjectParam);

  /** The id every request takes, and the slug every link is spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  /** The project's display name, once the shared list has answered. The address until then. */
  protected readonly heading = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value.name : this.param.segment();
  });
}
