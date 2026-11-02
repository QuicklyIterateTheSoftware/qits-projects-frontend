import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { ArchetypesApi } from './archetypes-api';

/**
 * `ArchetypesApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * the archetype registry, `GET /work/archetypes`, in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = ['listWorkArchetypes'];
const STATE = 'the archetype registry';

/** What the desks, the reshape form and the detail page read of the registry. */
const LIST_WORK_ARCHETYPES = [
  'properties',
  'serverOwned',
  'archetypes[].archetype',
  'archetypes[].depth',
  'archetypes[].mayBeRoot',
  'archetypes[].required',
  'archetypes[].requiredOnTransition',
  'archetypes[].permitted',
  'archetypes[].legalStatuses',
  'archetypes[].lifecycle',
  'archetypes[].transitions',
] as const;

/** One pact matcher spec, e.g. `{ match: 'type', min: 4, max: 4 }`. */
interface Matcher {
  readonly match: string;
  min?: number;
  max?: number;
  readonly variants?: readonly { readonly index: number; readonly rules: Rules }[];
}
/** One body path's rule, e.g. `$.transitions.IMPLEMENTED`. */
interface Rule {
  readonly combine: 'AND' | 'OR';
  readonly matchers: Matcher[];
}
type Rules = Record<string, Rule>;
/** One move as the pact body records it; only `to` and `kind` are matched once open-ended. */
interface Move {
  readonly to: string;
  readonly kind: string;
  readonly gates?: readonly string[];
}
interface RecordedArchetype {
  readonly archetype: string;
  readonly transitions?: Record<string, Move[]>;
}
interface GeneratedPact {
  readonly interactions: readonly {
    readonly comments?: {
      readonly references?: { readonly ['qits-call']?: { readonly operationId?: string } };
    };
    readonly response: {
      readonly body: { readonly content: { readonly archetypes: RecordedArchetype[] } };
      readonly matchingRules: { readonly body: Rules };
    };
  }[];
}

/**
 * `addGoldenInteraction` pins every `transitions.<STATUS>` array whose moves share one shape today
 * (no move there carries `gates`) to the length qits-projects happened to record: `type`, min = max
 * = that length. qits-projects is about to add a CLOSE move to several statuses of CAMPAIGN, EPIC
 * and FEATURE (qits-1757), and neither the desks, the reshape form nor the detail page rely on an
 * exact move count, so this drops the max and keeps the recorded count as a floor. A status whose
 * moves already differ in shape (REFINED everywhere; REPORTED for EPIC and TICKET, where one move
 * alone carries `gates`) is matched with `arrayContains` already, which pins no length, so it is
 * left as `addGoldenInteraction` built it. CAMPAIGN's transitions are reshaped further, see
 * `openEndedCampaign`.
 *
 * Runs on the pact this spec just generated, between the mock server answering (with qits-projects'
 * real recording, unchanged) and `assertPactPart` comparing or committing the result: it only
 * loosens what the committed pact asks a provider to match, not what `ArchetypesApi` under test read.
 */
function openEndedTransitions(generated: string): void {
  const written = JSON.parse(readFileSync(generated, 'utf8')) as GeneratedPact;
  for (const interaction of written.interactions) {
    if (interaction.comments?.references?.['qits-call']?.operationId !== 'listWorkArchetypes') {
      continue;
    }
    const archetypesRule = interaction.response.matchingRules.body['$.archetypes'];
    const variants = archetypesRule?.matchers.find((m) => m.match === 'arrayContains')?.variants;
    if (!variants) {
      throw new Error(
        'listWorkArchetypes no longer matches archetypes by shape: update openEndedTransitions',
      );
    }
    for (const variant of variants) {
      for (const [path, rule] of Object.entries(variant.rules)) {
        if (!/^\$\.transitions\.[A-Z_]+$/.test(path)) continue;
        const matcher = rule.matchers.find((m) => m.match === 'type');
        if (!matcher || matcher.min == null || matcher.max == null) continue;
        delete matcher.max;
      }
      const archetype = interaction.response.body.content.archetypes[variant.index];
      if (archetype?.archetype === 'CAMPAIGN') openEndedCampaign(archetype, variant.rules);
    }
  }
  writeFileSync(generated, JSON.stringify(written, null, 2));
}

/**
 * qits-650 derives a campaign's status from its members and leaves it two manual moves: DROP from
 * every status that is neither DONE nor DROPPED, REOPEN from DROPPED, and nothing from DONE. The
 * FORWARD, BACK and CLOSE moves (and their `gates`) recorded today go, so every recorded
 * `transitions.<STATUS>` of CAMPAIGN is reshaped to `type`, min 0, no max, each move's `to` and
 * `kind` matched by type, and none required to carry `gates`. The desks, the reshape form and the
 * detail page only offer the moves they find, so no count or kind is relied on.
 *
 * A provider verifies every element past the recorded length against element 0 alone, and
 * `arrayContains` would still demand a move with `gates`, so each status's recorded moves are
 * collapsed to one gate-less representative (`to`, `kind`): a move whose `gates` the provider adds
 * (today's) is an unexpected key, which a response may carry, while one without (after qits-650)
 * matches it outright. A status recorded empty (DONE) is left with no rule at all, so it is still
 * matched as exactly `[]`, which it is before and after qits-650.
 */
function openEndedCampaign(archetype: RecordedArchetype, rules: Rules): void {
  for (const [status, moves] of Object.entries(archetype.transitions ?? {})) {
    if (moves.length === 0) continue;
    const path = `$.transitions.${status}`;
    for (const key of Object.keys(rules)) {
      if (key === path || key.startsWith(`${path}[`) || key.startsWith(`${path}.`)) {
        delete rules[key];
      }
    }
    const representative = moves.find((move) => !move.gates) ?? moves[0];
    moves.splice(0, moves.length, { to: representative.to, kind: representative.kind });
    rules[path] = { combine: 'AND', matchers: [{ match: 'type', min: 0 }] };
    rules[`${path}[*].to`] = { combine: 'AND', matchers: [{ match: 'type' }] };
    rules[`${path}[*].kind`] = { combine: 'AND', matchers: [{ match: 'type' }] };
  }
}

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-archetypes-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

describe('qits-projects-frontend → qits-projects-service pact: ArchetypesApi', () => {
  afterAll(() => {
    try {
      const generated = join(dir, `${CONSUMER}-${PROVIDER}.json`);
      openEndedTransitions(generated);
      assertPactPart(generated, COMMITTED, OPERATIONS, 'QITS_GOLDEN_UPDATE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('show-work-item-actions: reads the registry once', () =>
    addGoldenInteraction(pact, masters, {
      provider: PROVIDER,
      state: STATE,
      operationId: 'listWorkArchetypes',
      trigger: { kind: 'ui', app: CONSUMER, interaction: 'show-work-item-actions' },
      consumes: LIST_WORK_ARCHETYPES,
    }).executeTest(async (server) => {
      const registry = await apiAt(server.url, ArchetypesApi).registry();
      expect(registry.archetypes.length).toBeGreaterThan(0);
      expect(registry.archetypes[0].transitions).toBeTruthy();
    }));
});
