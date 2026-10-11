import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TicketDto } from '../api/dto';
import { ticketEntity, type TicketEntity } from './entities-model';
import { EntitySummaryRow } from './entity-summary-row';

const AT = '2026-10-11T09:00:00Z';

function ticket(over: Partial<TicketDto>): TicketEntity {
  return ticketEntity({
    id: 't1',
    projectId: 'p1',
    title: 'The cancelled badge is the wrong colour',
    slug: 'cancelled-badge',
    number: 377,
    qualifiedId: 'qits-377',
    type: 'BUG',
    status: 'DROPPED',
    assignee: null,
    createdBy: null,
    impetus: null,
    description: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  });
}

/** The archive's row (qits-248): a dropped entity says why beside its status, and what closed it. */
describe('EntitySummaryRow', () => {
  let fixture: ComponentFixture<EntitySummaryRow>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(EntitySummaryRow);
    fixture.componentRef.setInput('projectSlug', 'qits');
  });

  function draw(entity: TicketEntity, successor: TicketEntity | null = null): HTMLElement {
    fixture.componentRef.setInput('entity', entity);
    fixture.componentRef.setInput('successor', successor);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the outcome beside DROPPED', () => {
    const row = draw(ticket({ outcome: 'OBSOLETE' }));
    expect(row.querySelector('.outcome')?.textContent).toContain('obsolete');
  });

  it('draws nothing extra for a drop with a null outcome, or none at all', () => {
    expect(draw(ticket({ outcome: null })).querySelector('.outcome')).toBeNull();
    expect(draw(ticket({})).querySelector('.outcome')).toBeNull();
  });

  it('links a duplicate to its original, said as a duplicate', () => {
    const original = ticket({ id: 't2', number: 378, qualifiedId: 'qits-378', title: 'Original' });
    const row = draw(ticket({ outcome: 'DUPLICATE', supersededBy: 't2' }), original);
    const link = row.querySelector<HTMLAnchorElement>('.successor');
    expect(link?.textContent?.trim()).toBe('duplicate of Original');
    expect(link?.getAttribute('href')).toBe('/qits/work/qits-378');
  });
});
