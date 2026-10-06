import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CommentDto } from '../api/dto';
import { EntityThread } from './entity-thread';

const AT = '2026-09-07T09:00:00Z';

function comment(over: Partial<CommentDto> = {}): CommentDto {
  return {
    id: 'c1',
    entityId: 't1',
    author: 'kim',
    body: 'Reproduced on **dev**.',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * An entity's thread, as the entity page draws it for any archetype (qits-551): oldest first,
 * markdown bodies, the "edited" hint off the two stamps, per-archetype wording, and a re-read after
 * every write.
 */
describe('EntityThread', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<EntityThread>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EntityThread);
    fixture.componentRef.setInput('entityId', 'qits-41');
    fixture.componentRef.setInput('archetype', 'TICKET');
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

  async function answer(comments: readonly CommentDto[]): Promise<void> {
    http
      .expectOne('/projects/api/work/qits-41/comments')
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
        candidate.method === 'POST' && candidate.url === '/projects/api/work/qits-41/comments',
    );
    expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
    request.flush({ comment: comment({ body: 'Reproduced on dev.' }) });
    await settle();
    await answer([comment({ body: 'Reproduced on dev.' })]);

    expect(element().querySelector('.comment .body')?.textContent).toContain('Reproduced on dev.');
  });

  it('edits a comment with a merge patch, changing only the body', async () => {
    await answer([comment()]);

    const edit = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === 'Edit',
    )!;
    edit.click();
    fixture.detectChanges();

    const box = element().querySelector<HTMLTextAreaElement>('.comment-edit')!;
    box.value = 'Reproduced on dev and on stage.';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const save = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === 'Save',
    )!;
    save.click();
    await settle();

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'PATCH' && candidate.url === '/projects/api/work/qits-41/comments/c1',
    );
    expect(request.request.body).toEqual({ body: 'Reproduced on dev and on stage.' });
    // A merge patch, sent as plain JSON — see the note above `EntitiesApi`.
    expect(request.request.headers.has('Content-Type')).toBe(false);
    request.flush({ comment: comment({ body: 'Reproduced on dev and on stage.' }) });
    await settle();
    await answer([comment({ body: 'Reproduced on dev and on stage.' })]);

    expect(element().querySelector('.comment .body')?.textContent).toContain(
      'Reproduced on dev and on stage.',
    );
  });

  it('says the thread could not be read, with its own retry', async () => {
    http
      .expectOne('/projects/api/work/qits-41/comments')
      .flush({ message: 'down' }, { status: 503, statusText: 'Down' });
    await settle();

    expect(element().textContent).toContain('Could not load the comments');
  });

  it('words the composer and the empty state off the archetype, lowercased', async () => {
    fixture.componentRef.setInput('archetype', 'EPIC');
    fixture.detectChanges();
    await answer([]);

    expect(element().textContent).toContain('Nothing has been said about this epic yet.');
    expect(
      element().querySelector<HTMLTextAreaElement>('.compose')?.getAttribute('placeholder'),
    ).toBe('Say something about this epic.');
  });
});
