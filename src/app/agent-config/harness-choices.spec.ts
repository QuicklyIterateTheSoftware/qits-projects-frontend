import type {
  AgentCapabilityCatalogueDto,
  AgentHarnessCapabilityDto,
} from '../api/agent-configuration-api';
import { choicesFor, effortOptions, effortToStore } from './harness-choices';

function report(over: Partial<AgentHarnessCapabilityDto> = {}): AgentHarnessCapabilityDto {
  return {
    harness: 'CLAUDE',
    imageVersion: '2026.909.1',
    harnessVersion: 'claude 2.1.0',
    models: ['opus', 'sonnet', 'haiku', 'fable'],
    modelsEnumerated: false,
    effortSupported: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    authenticated: true,
    authDetail: '',
    probeFailed: false,
    probeDetail: '',
    reportedBy: 'projects daemon',
    reportedAt: '2026-09-09T10:00:00Z',
    shipped: false,
    otherImageVersions: [],
    ...over,
  };
}

function catalogue(...harnesses: AgentHarnessCapabilityDto[]): AgentCapabilityCatalogueDto {
  return { harnesses };
}

const KIMI = report({
  harness: 'KIMI',
  harnessVersion: 'kimi 0.9',
  models: ['kimi-k2', 'kimi-k2-turbo'],
  modelsEnumerated: true,
  effortSupported: false,
  effortLevels: [],
});

/**
 * The cascade, asserted without a DOM.
 *
 * <p>Everything the model and effort controls do comes from here, and the two harnesses answer in
 * different *kinds* rather than with different values: Claude Code has an effort flag and no way to
 * list its models; Kimi Code has a model catalogue and no effort concept at all. A platform that
 * hardcoded either would be wrong about the other, so what these tests pin is that neither is
 * assumed — including the two cases where the honest answer is "nothing is known", which are exactly
 * the ones a page would otherwise paper over.
 */
describe('choicesFor', () => {
  it('offers Claude’s aliases and says they are not the legal values', () => {
    const choices = choicesFor(catalogue(report()), 'CLAUDE', '');

    expect(choices.models).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    // The whole reason the control is a combobox: the report says what it enumerated, and Claude
    // Code has no command that lists models, so a full model id must still be settable.
    expect(choices.modelsAreAliases).toBe(true);
    expect(choices.effortApplies).toBe(true);
    expect(choices.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  /** Not a disabled dropdown carrying Claude's values: no control at all. */
  it('gives Kimi no effort concept, and enumerated models', () => {
    const choices = choicesFor(catalogue(report(), KIMI), 'KIMI', '');

    expect(choices.effortApplies).toBe(false);
    expect(choices.effortLevels).toEqual([]);
    expect(choices.models).toEqual(['kimi-k2', 'kimi-k2-turbo']);
    expect(choices.modelsAreAliases).toBe(false);
  });

  /** A pinned full id is what somebody comes to this page for; it must stay visible in the list. */
  it('keeps a model the harness never enumerated', () => {
    const choices = choicesFor(catalogue(report()), 'CLAUDE', 'claude-opus-5-20260501');
    expect(choices.models).toContain('claude-opus-5-20260501');
  });

  /**
   * "Nothing reported" is not "nothing offered", and it is emphatically not "no effort concept".
   * Hiding the effort control on ignorance would be making Kimi's *claim* on Claude's behalf.
   */
  it('keeps both controls when no report exists for the harness', () => {
    const choices = choicesFor(catalogue(report()), 'KIMI', 'something');
    expect(choices.reported).toBe(false);
    expect(choices.effortApplies).toBe(true);
    expect(choices.models).toEqual([]);
    expect(choices.provenance).toContain('No container has reported');

    expect(choicesFor(null, 'CLAUDE', '').effortApplies).toBe(true);
  });

  it('says when a list is the shipped fallback rather than a reading of a binary', () => {
    expect(choicesFor(catalogue(report({ shipped: true })), 'CLAUDE', '').provenance).toContain(
      'shipped fallback',
    );
    expect(
      choicesFor(catalogue(report({ probeFailed: true, probeDetail: 'timed out' })), 'CLAUDE', '')
        .provenance,
    ).toContain('timed out');
    expect(choicesFor(catalogue(report()), 'CLAUDE', '').provenance).toContain('claude 2.1.0');
  });
});

describe('effortOptions', () => {
  /**
   * A stored value the report does not list is kept. Dropping it would render the control as
   * "nothing chosen" and the next save would clear a value nobody decided to clear — a data loss
   * wearing a dropdown.
   */
  it('keeps a stored level the report has never heard of', () => {
    const choices = choicesFor(catalogue(report()), 'CLAUDE', '');
    expect(effortOptions(choices, 'ultra')).toContain('ultra');
    expect(effortOptions(choices, 'high')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('effortToStore', () => {
  /**
   * A harness with no effort concept stores none. The editor shows no control for it, so keeping the
   * old value would be the disabled-control problem moved into storage: invisible on the page, still
   * true in the row, and still what a reader of the store would believe.
   */
  it('clears an effort a harness cannot have', () => {
    expect(effortToStore(choicesFor(catalogue(report(), KIMI), 'KIMI', ''), 'high')).toBe('');
    expect(effortToStore(choicesFor(catalogue(report()), 'CLAUDE', ''), 'high')).toBe('high');
  });
});
