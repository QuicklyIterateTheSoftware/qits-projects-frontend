import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ArchetypeRegistry } from '../api/archetypes-api';
import { EntityTransitionForm } from './entity-transition-form';
import type { EntityTransitionRequest, TransitionSubject } from './entity-transition-model';

const REGISTRY: ArchetypeRegistry = {
  properties: [
    'TITLE',
    'SLUG',
    'DESCRIPTION',
    'STATUS',
    'TICKET_TYPE',
    'IMPETUS',
    'ASSIGNEE',
    'CREATED_BY',
    'SUPERSEDED_BY',
    'REPOSITORY_ID',
    'IMPLEMENTED_AT',
    'DEPENDS_ON',
  ],
  serverOwned: ['SLUG', 'CREATED_BY'],
  archetypes: [
    {
      archetype: 'EPIC',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE', 'STATUS'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS', 'SUPERSEDED_BY'],
      legalStatuses: ['ABANDONED', 'IMPLEMENTATION', 'IMPLEMENTED', 'REFINING', 'SUPERSEDED'],
    },
    {
      archetype: 'TICKET',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      requiredOnTransition: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      permitted: [
        'TITLE',
        'SLUG',
        'DESCRIPTION',
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
        'ASSIGNEE',
        'CREATED_BY',
      ],
      legalStatuses: ['DONE', 'IMPLEMENTED', 'REFINED', 'REPORTED', 'VERIFIED'],
    },
    {
      archetype: 'FEATURE',
      depth: 1,
      mayBeRoot: false,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
      legalStatuses: [],
    },
    {
      archetype: 'TASK',
      depth: 2,
      mayBeRoot: false,
      required: ['TITLE', 'REPOSITORY_ID'],
      requiredOnTransition: ['TITLE', 'REPOSITORY_ID'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'REPOSITORY_ID', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
      legalStatuses: [],
    },
  ],
};

function subject(over: Partial<TransitionSubject> = {}): TransitionSubject {
  return {
    id: 's1',
    archetype: 'TICKET',
    title: 'A row',
    number: 1,
    qualifiedId: 'qits-1',
    parentId: null,
    projectId: 'p1',
    values: {},
    ...over,
  };
}

/** One epic, one feature under it, two tasks under that, and a ticket beside the lot. */
const PROJECT: readonly TransitionSubject[] = [
  subject({
    id: 'e1',
    archetype: 'EPIC',
    title: 'Merge the entities',
    qualifiedId: 'qits-12',
    values: { TITLE: 'Merge the entities', SLUG: 'merge', STATUS: 'IMPLEMENTATION' },
  }),
  subject({
    id: 'f1',
    archetype: 'FEATURE',
    title: 'The transition form',
    qualifiedId: 'qits-13',
    parentId: 'e1',
    values: { TITLE: 'The transition form', SLUG: 'the-form' },
  }),
  subject({
    id: 'k1',
    archetype: 'TASK',
    title: 'Draw the parent picker',
    qualifiedId: 'qits-14',
    parentId: 'f1',
    values: { TITLE: 'Draw the parent picker', SLUG: 'picker', REPOSITORY_ID: 'r1' },
  }),
  subject({
    id: 'k2',
    archetype: 'TASK',
    title: 'Split the refusal',
    qualifiedId: 'qits-15',
    parentId: 'f1',
    values: { TITLE: 'Split the refusal', SLUG: 'split', REPOSITORY_ID: 'r1' },
  }),
  subject({
    id: 't1',
    archetype: 'TICKET',
    title: 'The badge is the wrong colour',
    qualifiedId: 'qits-41',
    values: {
      TITLE: 'The badge is the wrong colour',
      SLUG: 'badge',
      STATUS: 'REPORTED',
      TICKET_TYPE: 'BUG',
      IMPETUS: 'It reads as success when a run is cancelled.',
      ASSIGNEE: 'kim',
      CREATED_BY: 'robin',
    },
  }),
];

describe('EntityTransitionForm', () => {
  let fixture: ComponentFixture<EntityTransitionForm>;
  let submitted: ReadonlyMap<string, EntityTransitionRequest> | null;

  beforeEach(() => {
    submitted = null;
    TestBed.configureTestingModule({});
  });

  async function mount(initialId = 't1', error: string | null = null): Promise<void> {
    fixture = TestBed.createComponent(EntityTransitionForm);
    fixture.componentRef.setInput('registry', REGISTRY);
    fixture.componentRef.setInput('subjects', PROJECT);
    fixture.componentRef.setInput('initialId', initialId);
    fixture.componentRef.setInput('error', error);
    fixture.componentInstance.submitted.subscribe((request) => (submitted = request));
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function entries(): HTMLElement[] {
    return Array.from(element().querySelectorAll('article.entry'));
  }

  /** One entry's controls, in the order the template draws them: archetype, parent, then the fields. */
  function selects(entry: HTMLElement): HTMLSelectElement[] {
    return Array.from(entry.querySelectorAll('select'));
  }

  function labels(entry: HTMLElement): string[] {
    return Array.from(entry.querySelectorAll('.label')).map(
      (node) => node.textContent?.replace('*', '').trim() ?? '',
    );
  }

  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  function buttonNamed(name: string, within: HTMLElement = element()): HTMLButtonElement {
    const found = Array.from(within.querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === name,
    );
    expect(found, `no button named ${name}`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  /** The Apply button, whose label carries the count and so cannot be matched by name. */
  function apply(): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find((node) =>
      node.textContent?.trim().startsWith('Apply'),
    );
    return found as HTMLButtonElement;
  }

  it('opens holding the row the press came from, as it stands', async () => {
    await mount();

    expect(entries().length).toBe(1);
    expect(entries()[0].textContent).toContain('The badge is the wrong colour');
    expect(selects(entries()[0])[0].value).toBe('TICKET');
  });

  /** Every archetype the registry names, and no list of them written in the component. */
  it('offers every archetype the registry describes as a target', async () => {
    await mount();
    const options = Array.from(selects(entries()[0])[0].options).map((option) => option.value);

    expect(options).toEqual(['EPIC', 'TICKET', 'FEATURE', 'TASK']);
  });

  /** Permitted minus server-owned: no slug box, no createdBy box, however the values arrived. */
  it('draws a box per statable property and none for the server-owned ones', async () => {
    await mount();

    expect(labels(entries()[0])).toEqual([
      'Becomes',
      'Sits under',
      'title',
      'description',
      'status',
      'ticket type',
      'impetus',
      'assignee',
    ]);
  });

  it('renders status as a picker over the legal statuses of the target', async () => {
    await mount();
    const status = selects(entries()[0])[2];

    expect(Array.from(status.options).map((option) => option.value)).toEqual([
      'DONE',
      'IMPLEMENTED',
      'REFINED',
      'REPORTED',
      'VERIFIED',
    ]);
    expect(status.value).toBe('REPORTED');
  });

  /** A root is offered only where the target may be one — a task is never offered "no parent". */
  it('offers no-parent only where the target may be a root', async () => {
    await mount();
    const parent = selects(entries()[0])[1];

    expect(Array.from(parent.options).map((option) => option.textContent?.trim())).toContain(
      'No parent — a root',
    );

    await choose(selects(entries()[0])[0], 'TASK');

    expect(
      Array.from(selects(entries()[0])[1].options).map((option) => option.textContent?.trim()),
    ).not.toContain('No parent — a root');
  });

  /** Depth, and nothing else: an epic and a feature can hold a task, another task cannot. */
  it('offers only the candidates deep enough to hold the target', async () => {
    await mount();
    await choose(selects(entries()[0])[0], 'TASK');
    const parents = Array.from(selects(entries()[0])[1].options)
      .map((option) => option.value)
      .filter((value) => value.length > 0);

    expect(parents).toEqual(['e1', 'f1']);
  });

  /**
   * The last place a person can notice. The door is a PUT, so demoting a ticket clears its status,
   * its kind, its impetus, its assignee and the principal who filed it — by omission.
   */
  it('names every property a demotion will discard', async () => {
    await mount();
    await choose(selects(entries()[0])[0], 'FEATURE');
    const warning = entries()[0].querySelector('.lost')?.textContent ?? '';

    expect(warning).toContain('status, ticket type, impetus, assignee, created by');
  });

  it('warns about nothing when the archetype does not move', async () => {
    await mount();

    expect(entries()[0].querySelector('.lost')).toBe(null);
  });

  /** A status the new archetype does not offer is not a status, so the picker asks again. */
  it('clears a status the target archetype does not know', async () => {
    await mount();
    await choose(selects(entries()[0])[0], 'EPIC');
    const status = selects(entries()[0])[2];

    expect(status.value).toBe('');
    expect(apply().disabled).toBe(true);
  });

  it('submits a map of one, spelled the way the wire spells it', async () => {
    await mount();
    apply().click();
    await settle();

    expect(submitted && [...submitted.keys()]).toEqual(['t1']);
    expect(submitted?.get('t1')).toEqual({
      archetype: 'TICKET',
      membership: { parent: null },
      title: 'The badge is the wrong colour',
      status: 'REPORTED',
      ticketType: 'BUG',
      impetus: 'It reads as success when a run is cancelled.',
      assignee: 'kim',
    });
  });

  it('refuses to submit while a required field of the target is empty', async () => {
    await mount();
    await type(entries()[0].querySelector('input') as HTMLInputElement, '   ');

    expect(apply().disabled).toBe(true);
  });

  /**
   * **The motivating case, end to end.** From the epic's card: remove the epic, add the feature and
   * promote it to a root epic, add both tasks and make them features under it — and press once.
   *
   * The task's parent picker offering `f1` at all is the whole point: `f1` is *stored* as a feature,
   * which cannot hold a feature, and is offered because the selection says it is about to be an epic.
   */
  it('splits a feature out into its own epic and re-shapes its tasks in one request', async () => {
    await mount('e1');

    buttonNamed('Remove', entries()[0]).click();
    await settle();

    await addSubject('f1');
    await choose(selects(entries()[0])[0], 'EPIC');
    await choose(selects(entries()[0])[2], 'REFINING');

    await addSubject('k1');
    await addSubject('k2');
    for (const id of ['k1', 'k2']) {
      const entry = entryOf(id);
      await choose(selects(entry)[0], 'FEATURE');
      await choose(selects(entry)[1], 'f1');
    }

    expect(apply().disabled).toBe(false);
    apply().click();
    await settle();

    expect(submitted && [...submitted.keys()]).toEqual(['f1', 'k1', 'k2']);
    expect(submitted?.get('f1')).toEqual({
      archetype: 'EPIC',
      membership: { parent: null },
      title: 'The transition form',
      status: 'REFINING',
    });
    expect(submitted?.get('k1')).toEqual({
      archetype: 'FEATURE',
      membership: { parent: 'f1' },
      title: 'Draw the parent picker',
    });
    expect(submitted?.get('k2')?.['membership']).toEqual({ parent: 'f1' });
  });

  /** The epic is never restated, which is why the entry the press opened on can be removed. */
  it('leaves nothing selected, and nothing submittable, once every entry is removed', async () => {
    await mount();
    buttonNamed('Remove', entries()[0]).click();
    await settle();

    expect(entries().length).toBe(0);
    expect(element().textContent).toContain('Nothing is selected');
    expect(apply().disabled).toBe(true);
  });

  /** With one entry there is no ambiguity, so the sentence goes under the box it is about. */
  it('draws a refusal under the field it names', async () => {
    await mount('t1', 'a TICKET requires impetus, and none was given');
    const messages = Array.from(entries()[0].querySelectorAll('.field-failed')).map((node) =>
      node.textContent?.trim(),
    );

    expect(messages).toEqual(['a TICKET requires impetus, and none was given']);
  });

  /** It names no property a box exists for, so it is a form-level sentence rather than swallowed. */
  it('draws a slug collision as a form-level message', async () => {
    await mount('t1', 'slug "badge" is already taken under parent e1');

    expect(entries()[0].querySelector('.field-failed')).toBe(null);
    expect(element().querySelector('.failed')?.textContent).toContain('already taken under parent');
  });

  /**
   * With several entries the sentence names no entity, so pinning a fragment to a field would put a
   * red line under whichever of four rows was drawn first. It is listed instead, and said so.
   */
  it('lists the fragments rather than guessing once more than one entry is selected', async () => {
    await mount('t1', 'a TASK requires repository id; a EPIC has no impetus');
    await addSubject('k1');
    const listed = Array.from(element().querySelectorAll('.failed')).map((node) =>
      node.textContent?.trim(),
    );

    expect(listed).toEqual(['a TASK requires repository id', 'a EPIC has no impetus']);
    expect(element().querySelectorAll('.field-failed').length).toBe(0);
    expect(element().textContent).toContain('names properties but no entity');
  });

  /** A null qualified id draws nothing at all, never `null-`. */
  it('draws no identifier for a row that has none', async () => {
    const anonymous = PROJECT.map((row) => (row.id === 't1' ? { ...row, qualifiedId: null } : row));
    fixture = TestBed.createComponent(EntityTransitionForm);
    fixture.componentRef.setInput('registry', REGISTRY);
    fixture.componentRef.setInput('subjects', anonymous);
    fixture.componentRef.setInput('initialId', 't1');
    await settle();

    expect(entries()[0].querySelector('.qualified')).toBe(null);
    expect(entries()[0].textContent).not.toContain('null');
  });

  function entryOf(id: string): HTMLElement {
    const at = entries().findIndex((entry) => entry.textContent?.includes(titleOf(id)));
    expect(at, `no entry for ${id}`).toBeGreaterThan(-1);
    return entries()[at];
  }

  function titleOf(id: string): string {
    return PROJECT.find((row) => row.id === id)?.title ?? '';
  }

  async function addSubject(id: string): Promise<void> {
    const picker = element().querySelector('.add select') as HTMLSelectElement;
    await choose(picker, id);
    buttonNamed('Add').click();
    await settle();
  }
});
