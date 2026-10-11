import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { DropResolution } from '../api/work';
import { DropForm } from './drop-form';

/**
 * The Drop's form (qits-248): an outcome is required, and the reference exists — and is required —
 * exactly for the three outcomes that name another item. What it emits is the drop's body besides
 * its target, so a reference never rides along with an outcome that forbids one.
 */
describe('DropForm', () => {
  let fixture: ComponentFixture<DropForm>;
  let dropped: DropResolution[];
  let cancelled: number;

  beforeEach(async () => {
    fixture = TestBed.createComponent(DropForm);
    dropped = [];
    cancelled = 0;
    fixture.componentInstance.dropped.subscribe((resolution) => dropped.push(resolution));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function pick(outcome: string): void {
    const radio = element().querySelector<HTMLInputElement>(`[data-outcome="${outcome}"] input`);
    expect(radio, `no outcome ${outcome}`).toBeTruthy();
    radio!.checked = true;
    radio!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function type(value: string): void {
    const input = element().querySelector<HTMLInputElement>('.drop-reference');
    expect(input, 'no reference box').toBeTruthy();
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function sendButton(): HTMLButtonElement {
    return element().querySelector<HTMLButtonElement>('.send-drop button')!;
  }

  function send(): void {
    sendButton().click();
    fixture.detectChanges();
  }

  it('offers the six outcomes, each explained', () => {
    const rows = Array.from(element().querySelectorAll('.outcome'));
    expect(rows.map((row) => row.getAttribute('data-outcome'))).toEqual([
      'DUPLICATE',
      'RESOLVED_ELSEWHERE',
      'SUPERSEDED',
      'OBSOLETE',
      'INVALID',
      'WONT_DO',
    ]);
    for (const row of rows) {
      expect(row.querySelector('.outcome-explanation')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('withholds the press until an outcome is picked', () => {
    expect(sendButton().disabled).toBe(true);
    send();
    expect(dropped).toEqual([]);
    expect(element().querySelector('.drop-problem')).toBeNull();
  });

  it.each(['DUPLICATE', 'RESOLVED_ELSEWHERE', 'SUPERSEDED'])(
    'asks %s for the item it names, and requires it',
    (outcome) => {
      pick(outcome);
      expect(element().querySelector('.drop-reference')).not.toBeNull();
      expect(sendButton().disabled).toBe(true);
      expect(element().querySelector('.drop-problem')?.textContent).toContain('qualified id');

      type('qits-378');
      expect(sendButton().disabled).toBe(false);
      send();
      expect(dropped).toEqual([{ outcome, supersededBy: 'qits-378' }]);
    },
  );

  it.each(['OBSOLETE', 'INVALID', 'WONT_DO'])(
    'hides the reference for %s, and sends the outcome alone',
    (outcome) => {
      pick(outcome);
      expect(element().querySelector('.drop-reference')).toBeNull();
      expect(sendButton().disabled).toBe(false);
      send();
      expect(dropped).toEqual([{ outcome }]);
    },
  );

  it('drops a reference typed for one outcome when another that forbids it is picked', () => {
    pick('DUPLICATE');
    type('qits-378');
    pick('INVALID');
    send();
    expect(dropped).toEqual([{ outcome: 'INVALID' }]);
  });

  it('labels the reference by the outcome', () => {
    pick('RESOLVED_ELSEWHERE');
    expect(element().querySelector('#drop-reference-label')?.textContent).toContain('Resolved by');
  });

  it('cancels', () => {
    const cancel = Array.from(element().querySelectorAll('qits-button')).find(
      (host) => host.textContent?.trim() === 'Cancel',
    );
    cancel!.querySelector('button')!.click();
    expect(cancelled).toBe(1);
  });
});
