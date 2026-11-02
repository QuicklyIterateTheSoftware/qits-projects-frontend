import {
  workOfCampaign,
  workOfEpic,
  workOfFeature,
  workOfTask,
  workOfTicket,
} from '../../testing/work-fixtures';
import { campaignSummaryOf, epicOf, featureOf, taskOf, ticketOf, type WorkEntityDto } from './work';

/**
 * qits-634: every `/work` answer carries `tags` — enum names, `[]` when none — and the mappings onto
 * the client's per-archetype records carry them through, a service older than qits-634 (no field at
 * all) reading as none.
 */
describe('the /work mappings carry tags (qits-634)', () => {
  const RESERVED = ['RESERVED_FOR_HUMAN'];

  /** The row as an older service answers it: no `tags` field at all. */
  function untagged(row: WorkEntityDto): WorkEntityDto {
    const rest: { tags?: readonly string[] } & Omit<WorkEntityDto, 'tags'> = { ...row };
    delete rest.tags;
    return rest;
  }

  it('carries an epic’s and a ticket’s tags', () => {
    expect(epicOf(workOfEpic({ tags: RESERVED })).tags).toEqual(RESERVED);
    expect(ticketOf(workOfTicket({ tags: RESERVED })).tags).toEqual(RESERVED);
  });

  it('carries a feature’s and a task’s tags', () => {
    expect(featureOf(workOfFeature({ tags: RESERVED })).tags).toEqual(RESERVED);
    expect(taskOf(workOfTask({ tags: RESERVED })).tags).toEqual(RESERVED);
  });

  it('carries a campaign’s tags onto its desk row', () => {
    expect(campaignSummaryOf(workOfCampaign({ tags: RESERVED }), null).tags).toEqual(RESERVED);
  });

  it('keeps an empty set empty', () => {
    expect(ticketOf(workOfTicket({ tags: [] })).tags).toEqual([]);
  });

  it('reads an absent field as no tags on every archetype', () => {
    expect(epicOf(untagged(workOfEpic({}))).tags).toEqual([]);
    expect(ticketOf(untagged(workOfTicket({}))).tags).toEqual([]);
    expect(featureOf(untagged(workOfFeature({}))).tags).toEqual([]);
    expect(taskOf(untagged(workOfTask({}))).tags).toEqual([]);
    expect(campaignSummaryOf(untagged(workOfCampaign({})), null).tags).toEqual([]);
  });
});
