/**
 * **`Promise.all` with a ceiling** — `work` applied to every item, at most `limit` of them in flight
 * at any moment, and the answers in the items' own order (qits-1815).
 *
 * <p>Why a ceiling at all: a browser does not queue an unbounded fan-out politely. Past a few
 * hundred simultaneous requests Chromium stops opening them and fails the rest with
 * `net::ERR_INSUFFICIENT_RESOURCES`, which reaches a page as a read that failed — "the service is
 * unreachable" — when nothing was wrong with the service. A read that is per row of a project is the
 * one that grows without a bound, so it goes through here rather than through `Promise.all`.
 *
 * <p><b>It fails the way `Promise.all` fails</b>: the first rejection rejects the whole, and no new
 * item is started after it (the ones already in flight are left to land, unread). A caller that
 * wants one item's failure to cost only that item catches inside `work`.
 *
 * <p>`limit` below one is read as one, so a caller's arithmetic can never stall the queue.
 */
export async function boundedAll<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const lanes = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}
