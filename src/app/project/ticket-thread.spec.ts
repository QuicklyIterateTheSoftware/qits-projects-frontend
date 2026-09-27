import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TicketCommentDto } from '../api/dto';
import { TicketThread } from './ticket-thread';

const AT = '2026-09-07T09:00:00Z';

function comment(over: Partial<TicketCommentDto> = {}): TicketCommentDto {
  return {
    id: 'c1',
    ticketId: 't1',
    author: 'kim',
    body: 'Reproduced on **dev**.',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * A ticket's thread, as the entity page draws it (moved out of the retired ticket page): oldest
 * first, markdown bodies, the "edited" hint off the two stamps, and a re-read after every write.
 */
describe('TicketThread', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TicketThread>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TicketThread);
    fixture.componentRef.setInput('ticketId', 't1');
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function answer(comments: readonly TicketCommentDto[]): Promise<void> {
    http
      .expectOne('/projects/api/tickets/t1/comments')
      .flush({ entries: comments.map((value) => ({ comment: value })) });
    await settle();
  }

  it('draws the thread oldest first, with markdown bodies and the edited hint', async () => {
    await answer([
      comment(),
      comment({ id: 'c2', author: null, body: 'Second.', updatedAt: '2026-09-07T11:00:00Z' }),
    ]);

    const rows = Array.from(element().querySelectorAll('.comment'));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.body strong')?.textContent).toBe('dev');
    expect(rows[1].querySelector('.author')?.textContent).toBe('—');
    expect(rows[1].querySelector('.edited')).not.toBeNull();
    expect(rows[0].querySelector('.edited')).toBeNull();
  });

  it('posts a comment with only its body, then re-reads the thread', async () => {
    await answer([]);

    const box = element().querySelector<HTMLTextAreaElement>('.compose')!;
    box.value = 'Reproduced on dev.';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const send = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === 'Comment',
    )!;
    send.click();
    await settle();

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === '/projects/api/tickets/t1/comments',
    );
    expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
    request.flush({ comment: comment({ body: 'Reproduced on dev.' }) });
    await settle();
    await answer([comment({ body: 'Reproduced on dev.' })]);

    expect(element().querySelector('.comment .body')?.textContent).toContain('Reproduced on dev.');
  });

  it('says the thread could not be read, with its own retry', async () => {
    http
      .expectOne('/projects/api/tickets/t1/comments')
      .flush({ message: 'down' }, { status: 503, statusText: 'Down' });
    await settle();

    expect(element().textContent).toContain('Could not load the comments');
  });
});
