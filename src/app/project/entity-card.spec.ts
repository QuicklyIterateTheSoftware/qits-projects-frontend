import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EpicDto, TicketDto } from '../api/dto';
import { epicEntity, ticketEntity, type Entity } from './entities-model';
import { EntityCard } from './entity-card';

const AT = '2026-10-11T09:00:00Z';

function ticket(over: Partial<TicketDto> = {}): Entity {
  return ticketEntity({
    id: 't1',
    projectId: 'p1',
    title: 'The cancelled badge is the wrong colour',
    slug: 'cancelled-badge',
    number: 377,
    qualifiedId: 'qits-377',
    type: 'BUG',
    status: 'REPORTED',
    assignee: null,
    createdBy: null,
    impetus: 'The badge reads as success when a run is cancelled.',
    description: 'Use the danger tone for a cancelled run.',
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  });
}

function epic(over: Partial<EpicDto> = {}): Entity {
  return epicEntity({
    id: 'e1',
    projectId: 'p1',
    title: 'Fix the badge palette',
    slug: 'fix-badge-palette',
    description: 'Walk every status through the new tone table, one at a time.',
    number: 12,
    qualifiedId: 'qits-12',
    status: 'REFINED',
    supersededByEpicId: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  });
}

/**
 * The excerpt a desk card draws (qits-1821): the listing's plain-text lead, in place of the whole
 * markdown description `app-markdown` used to render here.
 */
describe('EntityCard excerpt', () => {
  let fixture: ComponentFixture<EntityCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(EntityCard);
    fixture.componentRef.setInput('projectSlug', 'qits');
  });

  function draw(entity: Entity): HTMLElement {
    fixture.componentRef.setInput('entity', entity);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws a ticket’s excerpt', () => {
    const card = draw(ticket({ excerpt: 'Use the danger tone for a cancelled run.' }));
    expect(card.querySelector('.excerpt')?.textContent).toBe(
      'Use the danger tone for a cancelled run.',
    );
  });

  it('draws an epic’s excerpt', () => {
    const card = draw(epic({ excerpt: 'Walk every status through the new tone table.' }));
    expect(card.querySelector('.excerpt')?.textContent).toBe(
      'Walk every status through the new tone table.',
    );
  });

  it('draws no excerpt for a row whose listing carries none', () => {
    expect(draw(ticket({ excerpt: null })).querySelector('.excerpt')).toBeNull();
    expect(draw(epic({ excerpt: null })).querySelector('.excerpt')).toBeNull();
  });

  /** The whole description is the page's now; a card never renders markdown at all. */
  it('never draws `app-markdown`, even when the item still carries a description', () => {
    const card = draw(ticket({ excerpt: null, description: 'Still set, but not drawn here.' }));
    expect(card.querySelector('app-markdown')).toBeNull();
  });
});
