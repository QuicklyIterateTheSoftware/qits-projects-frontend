import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CriterionSpec } from '../api/dto';
import { CampaignCriterionForm } from './campaign-criterion-form';

/**
 * The four typed forms, and exactly the JSON each produces — the SPA page's contract. The service
 * writes every key of a shape, refuses one it does not have, and takes an empty optional as null.
 */
describe('CampaignCriterionForm', () => {
  let fixture: ComponentFixture<CampaignCriterionForm>;
  let saved: CriterionSpec[];

  beforeEach(async () => {
    fixture = TestBed.createComponent(CampaignCriterionForm);
    fixture.componentRef.setInput('members', [
      { entityId: 'e1', qualifiedId: 'qits-411', title: 'First' },
      { entityId: 'e2', qualifiedId: 'qits-409', title: 'Second' },
    ]);
    fixture.componentRef.setInput('defaultEntityId', 'e2');
    fixture.componentRef.setInput('repositories', ['qits-ci-service', 'qits-projects-service']);
    saved = [];
    fixture.componentInstance.saved.subscribe((criterion) => saved.push(criterion));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function choose(selector: string, value: string): void {
    const select = element().querySelector<HTMLSelectElement>(selector);
    expect(select, `no select at ${selector}`).toBeTruthy();
    select!.value = value;
    select!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function type(selector: string, value: string): void {
    const input = element().querySelector<HTMLInputElement>(selector);
    expect(input, `no input at ${selector}`).toBeTruthy();
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function save(): void {
    element().querySelector<HTMLButtonElement>('.save-criterion button')!.click();
    fixture.detectChanges();
  }

  it('offers the four kinds and nothing else', () => {
    const labels = Array.from(element().querySelectorAll('.kind option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Member reaches status',
      'Deployment goes live',
      'Repository releases',
      'A person approves',
    ]);
  });

  /** qits-887: READY_FOR_DEV sits after REFINED — waiting until a member is scheduled. */
  it('offers every status a member can reach, READY_FOR_DEV after REFINED', () => {
    const statuses = Array.from(element().querySelectorAll('.status option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(statuses).toEqual([
      'REFINED',
      'READY_FOR_DEV',
      'IMPLEMENTING',
      'IMPLEMENTED',
      'VERIFYING',
      'VERIFIED',
      'DONE',
    ]);
  });

  it('member reaches status: the previous member and VERIFIED by default', () => {
    const offered = Array.from(element().querySelectorAll('.target option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(offered).toEqual(['e1', 'e2']);
    save();
    expect(JSON.stringify(saved[0])).toBe(
      '{"kind":"ENTITY_STATUS","predicate":{"entityId":"e2","status":"VERIFIED"}}',
    );

    choose('.target', 'e1');
    choose('.status', 'DONE');
    save();
    expect(saved[1]).toEqual({
      kind: 'ENTITY_STATUS',
      predicate: { entityId: 'e1', status: 'DONE' },
    });
  });

  it('deployment goes live: the environment and the floor are null when left empty', () => {
    choose('.kind', 'DEPLOYMENT_ACTIVE');
    const button = element().querySelector<HTMLButtonElement>('.save-criterion button')!;
    expect(button.disabled).toBe(true);

    type('.application', 'qits-projects');
    save();
    expect(JSON.stringify(saved[0])).toBe(
      '{"kind":"DEPLOYMENT_ACTIVE","predicate":{"applicationName":"qits-projects","environmentName":null,"minimumVersion":null}}',
    );

    type('.environment', 'dev');
    type('.deployment-version', '2026.1001.91244');
    save();
    expect(JSON.stringify(saved[1])).toBe(
      '{"kind":"DEPLOYMENT_ACTIVE","predicate":{"applicationName":"qits-projects","environmentName":"dev","minimumVersion":"2026.1001.91244"}}',
    );
  });

  it('repository releases: a repository of the project, projectId null', () => {
    choose('.kind', 'SCM_RELEASE');
    save();
    expect(JSON.stringify(saved[0])).toBe(
      '{"kind":"SCM_RELEASE","predicate":{"repositoryName":"qits-ci-service","projectId":null,"minimumVersion":null}}',
    );

    choose('.repository', 'qits-projects-service');
    type('.release-version', '2026.927.1');
    save();
    expect(JSON.stringify(saved[1])).toBe(
      '{"kind":"SCM_RELEASE","predicate":{"repositoryName":"qits-projects-service","projectId":null,"minimumVersion":"2026.927.1"}}',
    );
  });

  it('a person approves: an empty predicate', () => {
    choose('.kind', 'APPROVAL');
    save();
    expect(JSON.stringify(saved[0])).toBe('{"kind":"APPROVAL","predicate":{}}');
  });
});
