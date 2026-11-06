import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideQitsWorkBriefs, type QitsWorkBriefSource } from '@qits/ui-components';
import type { PromptAttachmentDto } from '../api/prompt-attachments-api';
import { EpicDocument, epicBlocks, imageMarkdown, insertImageAt, slotAt } from './epic-document';

const image: PromptAttachmentDto = {
  id: 'image-1',
  mimeType: 'image/png',
  label: 'Sketch 1',
  source: 'SKETCH',
  createdAt: '2026-08-09T10:00:00Z',
  dataBase64: 'cG5n',
};

describe('epicBlocks', () => {
  it('keeps source line ranges while rendering blank-line-delimited paragraphs', () => {
    const blocks = epicBlocks('## Purpose\n\nFirst **paragraph**.\ncontinues\n\n- one\n- two');

    expect(
      blocks.map(({ startLine, endLine, excerpt }) => ({ startLine, endLine, excerpt })),
    ).toEqual([
      { startLine: 1, endLine: 1, excerpt: '## Purpose' },
      { startLine: 3, endLine: 4, excerpt: 'First **paragraph**.\ncontinues' },
      { startLine: 6, endLine: 7, excerpt: '- one\n- two' },
    ]);
    expect(blocks[1].html).toContain('<strong>paragraph</strong>');
  });

  it('inserts a browser-loadable image URL and migrates an older label reference when rendering', () => {
    const url = '/projects/api/refinements/7/prompt-attachments/image-1/content';
    expect(imageMarkdown(7, image)).toBe(`![Sketch 1](${url})`);
    expect(insertImageAt('before\n\nafter', 3, 7, image)).toBe(
      `before\n\n![Sketch 1](${url})\n\nafter`,
    );
    expect(insertImageAt('![Sketch 1](qits-attachment:Sketch%201)', 2, 7, image)).toBe(
      `![Sketch 1](${url})\n![Sketch 1](${url})\n`,
    );
    // Not loaded yet: the content route wants the bearer, so the URL waits in `cite` for BearerHtml.
    expect(epicBlocks(imageMarkdown(7, image), [], 7)[0].html).toContain(`cite="${url}"`);
    expect(epicBlocks(imageMarkdown(7, image), [image], 7)[0].html).toContain(
      'src="data:image/png;base64,cG5n"',
    );
    expect(epicBlocks('![Sketch 1](qits-attachment:Sketch%201)', [image], 7)[0].html).toContain(
      'src="data:image/png;base64,cG5n"',
    );
  });
});

describe('the radial selection control', () => {
  it('maps the eight gesture directions between the plus and diagonal cuts', () => {
    expect(slotAt(0, -70)).toBe(0);
    expect(slotAt(70, 0)).toBe(2);
    expect(slotAt(0, 70)).toBe(4);
    expect(slotAt(-70, -70)).toBe(7);
    expect(slotAt(0, 0)).toBeNull();
  });

  it('pins the passage that opened the radial menu without arming a second click', async () => {
    const fixture = TestBed.createComponent(EpicDocument);
    fixture.componentRef.setInput('text', 'First paragraph.\n\nSecond paragraph.');
    const picks: unknown[] = [];
    fixture.componentInstance.picked.subscribe((pick) => picks.push(pick));
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const first = element.querySelector<HTMLElement>('.block')!;
    first.click();
    expect(picks).toEqual([]);
    expect(element.querySelector('.insert')).toBeNull();

    first.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 250, clientY: 250, bubbles: true }),
    );
    await fixture.whenStable();
    expect(
      element.querySelector<HTMLElement>('[aria-label="Insert a saved image"]')!.style.transform,
    ).toBe('rotate(247.5deg)');
    expect(
      element.querySelector<HTMLElement>('[aria-label="Attach this epic passage to chat"]')!.style
        .transform,
    ).toBe('rotate(292.5deg)');
    element
      .querySelector<HTMLButtonElement>('[aria-label="Attach this epic passage to chat"]')!
      .click();
    await fixture.whenStable();

    expect(picks).toEqual([{ startLine: 1, endLine: 1, excerpt: 'First paragraph.' }]);
    expect(element.querySelector('.insert')).toBeNull();
    first.click();
    expect(picks).toHaveLength(1);
  });
});

/**
 * qits-1898: given the project, each block draws its work ids as `qits-work-ref`s with their briefs.
 * The document stays the read-only render it was: a press on a reference still lands in its block,
 * and the passage it pins is the block's source, not its drawn text.
 */
describe('work ids in the epic document', () => {
  let asked: string[][];

  beforeEach(() => {
    asked = [];
    const source: QitsWorkBriefSource = async (_project, ids) => {
      asked.push([...ids]);
      return ids
        .filter((id) => id === 'qits-14')
        .map((qualifiedId) => ({
          id: 'k1',
          qualifiedId,
          archetype: 'TASK',
          status: 'REFINED',
          title: 'Route the desk',
          updatedAt: '2026-11-06T11:29:56.962030Z',
        }));
    };
    TestBed.configureTestingModule({ providers: [provideQitsWorkBriefs(source)] });
  });

  async function draw(project: string | undefined) {
    const fixture = TestBed.createComponent(EpicDocument);
    fixture.componentRef.setInput('text', 'First, after qits-14.\n\nSecond names qits-404.');
    if (project !== undefined) fixture.componentRef.setInput('project', project);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('links a known id per block, and pins the block a reference sits in', async () => {
    const fixture = await draw('qits');
    const element = fixture.nativeElement as HTMLElement;
    const picks: unknown[] = [];
    fixture.componentInstance.picked.subscribe((pick) => picks.push(pick));

    const blocks = element.querySelectorAll<HTMLElement>('.block');
    expect(blocks).toHaveLength(2);
    expect(
      Array.from(blocks[0].querySelectorAll('.qits-work-ref')).map((t) => t.textContent),
    ).toEqual(['qits-14']);
    expect(blocks[1].querySelector('.qits-work-ref')).toBeNull();
    expect(blocks[1].textContent).toContain('Second names qits-404.');
    expect(asked).toEqual([['qits-14', 'qits-404']]);

    blocks[0]
      .querySelector('.qits-work-ref')!
      .dispatchEvent(new MouseEvent('contextmenu', { clientX: 250, clientY: 250, bubbles: true }));
    await fixture.whenStable();
    element
      .querySelector<HTMLButtonElement>('[aria-label="Attach this epic passage to chat"]')!
      .click();
    await fixture.whenStable();

    expect(picks).toEqual([{ startLine: 1, endLine: 1, excerpt: 'First, after qits-14.' }]);
  });

  it('leaves every block as rendered without a project', async () => {
    const fixture = await draw(undefined);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('qits-work-ref')).toBeNull();
    expect(element.querySelector('.block .markdown')?.innerHTML).toBe(
      '<p>First, after qits-14.</p>',
    );
    expect(asked).toEqual([]);
  });
});
