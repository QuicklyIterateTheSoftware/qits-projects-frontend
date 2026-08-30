import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { ProjectParam } from '../nav/project-param';
import { QitsButton, QitsPicker, type QitsPickerOption } from '@qits/ui-components';
import {
  COMPONENT_TYPES,
  COMPONENTS_DIRECTORY,
  componentDirectory,
  type CreateRepositoryRequest,
  type CreateRepositoryResponse,
  type PlaceableArchetype,
} from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { basename, isGitSafeName } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';

/** Which of the two create flows the form is on. */
export type CreateMode = 'blank' | 'attach';

/**
 * Add a repository to a project: born blank on the platform git host, or an existing one attached
 * by url.
 *
 * <p><b>The two modes are two flows, not two spellings of one.</b> The server takes exactly one of
 * `name` and `url` and rejects a body carrying both, so the toggle is what decides which field is
 * on the request — and the other is *absent*, not empty. That is also why the fields are separate
 * rather than one box the page guesses at: a value that looks like a url and a repository someone
 * genuinely wants named `https` are indistinguishable to a guess, and the answer differs.
 *
 * <p><b>`?type=` is a prefill, not an instruction.</b> A group's "New service" link seeds the
 * picker; the picker is then free to disagree, because a reader who arrived from the wrong group
 * should not have to go back to fix it. An unrecognised value seeds nothing, which leaves the
 * picker's list standing open — the state it uses to mean "nothing chosen yet".
 *
 * <p>Success goes back to the project, because the thing the reader was doing is now visible there:
 * the new repository is in its group, and the wrapper's `.gitmodules` names it.
 */
@Component({
  selector: 'app-create-repository-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, QitsPicker, RouterLink],
  template: `
    <p class="back"><a [routerLink]="['/', projectSlug()]">← Back to the project</a></p>
    <h1>New repository</h1>

    <div class="modes" role="group" aria-label="How the repository is added">
      <button
        type="button"
        class="mode"
        [class.on]="mode() === 'blank'"
        [attr.aria-pressed]="mode() === 'blank'"
        (click)="setMode('blank')"
      >
        Create it blank
      </button>
      <button
        type="button"
        class="mode"
        [class.on]="mode() === 'attach'"
        [attr.aria-pressed]="mode() === 'attach'"
        (click)="setMode('attach')"
      >
        Attach an existing one
      </button>
    </div>

    <p class="explain">
      @if (mode() === 'blank') {
        A new repository on this platform's git host, seeded from the skeleton and committed into
        the project's wrapper as <code>{{ preview() }}</code
        >.
      } @else {
        An existing repository elsewhere, cloned onto the platform's git host and committed into the
        project's wrapper as <code>{{ preview() }}</code
        >.
      }
    </p>

    <!-- Not a <label>: the picker is an ARIA listbox, not a form control a label can be
         associated with. Its own ariaLabel is what names it for a screen reader. -->
    <div class="field">
      <span class="label">Type</span>
      <qits-picker
        [options]="types"
        [value]="archetype()"
        (valueChange)="onArchetype($event)"
        ariaLabel="Repository type"
        placeholder="Pick a type"
      />
    </div>

    @if (mode() === 'blank') {
      <label class="field">
        <span class="label" id="name-label">Name</span>
        <input
          type="text"
          class="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="qits-widgets"
          aria-labelledby="name-label"
          aria-describedby="name-hint"
          [value]="name()"
          (input)="onName($event)"
        />
      </label>
      <p class="hint" id="name-hint">
        Letters, digits, dots, dashes and underscores. The wrapper resolves it as
        <code>../&lt;name&gt;.git</code>, so it is also the name the git host serves.
      </p>
      @if (name() && !nameOk()) {
        <p class="invalid" role="alert">That name cannot be a git-host repository.</p>
      }
    } @else {
      <label class="field">
        <span class="label" id="url-label">Clone url</span>
        <input
          type="text"
          class="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://github.com/QuicklyIterate/qits-widgets.git"
          aria-labelledby="url-label"
          [value]="url()"
          (input)="onUrl($event)"
        />
      </label>
      <p class="hint">
        Read once to bring the code in, then kept as the repository's backup target. Its basename
        becomes the name the wrapper and the git host both use, and clones come from the git host
        from then on.
      </p>
    }

    <label class="field">
      <span class="label" id="component-label">Component</span>
      <input
        type="text"
        class="text component"
        autocomplete="off"
        spellcheck="false"
        placeholder="qits-widgets"
        aria-labelledby="component-label"
        aria-describedby="component-hint"
        [value]="component()"
        (input)="onComponent($event)"
      />
    </label>
    <p class="hint" id="component-hint">
      Optional. The technical unit this repository is part of — the one a service, its frontend and
      its daemon share. Naming one mounts it at
      <code>components/&lt;component&gt;/&lt;name&gt;</code>, whatever layout the project is in.
      Leave it empty and the project decides: the type's own directory, or
      <code>components/&lt;name&gt;/</code> where the project has already moved.
    </p>
    @if (component() && !componentOk()) {
      <p class="invalid" role="alert">That component cannot be a wrapper directory.</p>
    }

    <div class="actions">
      <qits-button
        variant="primary"
        [disabled]="!submittable()"
        [busy]="submit().kind === 'loading'"
        (pressed)="create()"
      >
        Add it to the project
      </qits-button>
      <a class="cancel" [routerLink]="['/', projectSlug()]">Cancel</a>
    </div>

    @if (submit().kind === 'error') {
      <p class="failed" role="alert">Could not add it — {{ message() }}.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 40rem;
    }
    .back {
      margin: 0 0 0.75rem;
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .modes {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .mode {
      padding: 0.3rem 0.7rem;
      font: inherit;
      font-size: 0.9rem;
      color: #374151;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      cursor: pointer;
    }
    .mode:hover {
      background: #f3f4f6;
    }
    .mode.on {
      color: #111827;
      font-weight: 600;
      border-color: #6b7280;
      background: #f3f4f6;
    }
    .explain {
      margin: 0.6rem 0 1rem;
      color: #374151;
    }
    .field {
      display: block;
      margin: 0 0 0.6rem;
    }
    .label {
      display: block;
      margin-bottom: 0.2rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #374151;
    }
    .text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: #111827;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .text:focus {
      outline: 2px solid #6b7280;
      outline-offset: 1px;
    }
    .hint {
      margin: 0 0 0.8rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .invalid {
      margin: -0.5rem 0 0.8rem;
      font-size: 0.85rem;
      color: #b91c1c;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .failed {
      margin: 0.6rem 0 0;
      color: #b91c1c;
    }
  `,
})
export class CreateRepositoryPage {
  private readonly api = inject(ProjectsApi);
  private readonly param = inject(ProjectParam);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * The six types, named and nothing more.
   *
   * The label used to carry the archetype's directory — "service (services/)" — and that is only
   * half true now: a repository with a component is mounted under `components/` whatever type it
   * is. The destination is the preview's job, which is right under both layouts.
   */
  protected readonly types: readonly QitsPickerOption<PlaceableArchetype>[] = COMPONENT_TYPES.map(
    (type) => ({ value: type.archetype, label: type.singular }),
  );

  /** The id the create request takes, and the slug the two links back are spelled with. */
  protected readonly projectId = this.param.projectId;
  protected readonly projectSlug = this.param.projectSlug;

  protected readonly mode = signal<CreateMode>('blank');
  protected readonly archetype = signal<PlaceableArchetype | undefined>(undefined);
  protected readonly name = signal('');
  protected readonly url = signal('');
  protected readonly component = signal('');
  protected readonly submit = signal<Loadable<CreateRepositoryResponse>>(IDLE);

  protected readonly nameOk = computed(() => isGitSafeName(this.name().trim()));

  /**
   * A component is a directory in the wrapper, so it is held to the same rule a name is — and to
   * one more: `components` itself is the layout's own first segment, never a component.
   */
  protected readonly componentOk = computed(() => {
    const component = this.component().trim();
    return isGitSafeName(component) && component !== COMPONENTS_DIRECTORY;
  });

  /**
   * Where the submodule will land, spelled the way `.gitmodules` will spell it.
   *
   * A stated component decides it outright. With none, this shows the archetype's directory — the
   * honest answer for a project still in that layout, and the one place this page cannot be exact,
   * because a project whose wrapper has already moved places a componentless create at
   * `components/<name>/<name>` instead. The field's hint says so; the server has the last word
   * either way.
   */
  protected readonly preview = computed(() => {
    const component = this.component().trim();
    const directory = component
      ? componentDirectory(component)
      : (COMPONENT_TYPES.find((type) => type.archetype === this.archetype())?.directory ??
        '<type>');
    const name = this.mode() === 'blank' ? this.name().trim() : basename(this.url().trim());
    return `${directory}/${name || '<name>'}`;
  });

  protected readonly submittable = computed(() => {
    if (this.archetype() === undefined || this.submit().kind === 'loading') {
      return false;
    }
    if (this.component().trim() && !this.componentOk()) {
      return false;
    }
    return this.mode() === 'blank' ? this.nameOk() : this.url().trim().length > 0;
  });

  protected readonly message = computed(() => {
    const state = this.submit();
    return state.kind === 'error' ? state.message : '';
  });

  constructor() {
    // The prefill follows the query parameter rather than being read once, because a group's link
    // navigates to this same page: `?type=DAEMON` after `?type=SERVICE` re-uses this instance.
    effect(() => {
      const requested = this.query().get('type');
      const known = COMPONENT_TYPES.find((type) => type.archetype === requested);
      if (known) {
        this.archetype.set(known.archetype);
      }
    });
  }

  protected setMode(mode: CreateMode): void {
    this.mode.set(mode);
    this.submit.set(IDLE);
  }

  protected onArchetype(archetype: PlaceableArchetype | undefined): void {
    this.archetype.set(archetype);
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onUrl(event: Event): void {
    this.url.set((event.target as HTMLInputElement).value);
  }

  protected onComponent(event: Event): void {
    this.component.set((event.target as HTMLInputElement).value);
  }

  /**
   * One of `name` and `url` is on the body, and the other is not on it at all. `component` is on it
   * only when one was stated — an empty one is *absent*, which is what tells the server to let the
   * wrapper's own layout decide.
   */
  protected async create(): Promise<void> {
    const archetype = this.archetype();
    if (!archetype || !this.submittable()) {
      return;
    }
    const component = this.component().trim();
    const request: CreateRepositoryRequest = {
      ...(this.mode() === 'blank' ? { name: this.name().trim() } : { url: this.url().trim() }),
      archetype,
      ...(component ? { component } : {}),
    };

    this.submit.set(LOADING);
    try {
      this.submit.set(ready(await this.api.createRepository(this.projectId(), request)));
      await this.router.navigate(['/', this.projectSlug()]);
    } catch (error) {
      this.submit.set(failed(error));
    }
  }
}
