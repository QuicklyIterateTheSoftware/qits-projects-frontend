import { boundedAll } from './bounded';

/** A promise and the two hands that settle it, for driving `work` one answer at a time. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
  }
};

/**
 * `Promise.all` with a ceiling (qits-1815): the thing that keeps the desk's one per-root read from
 * becoming a burst the browser refuses.
 */
describe('boundedAll', () => {
  it('never has more than the limit in flight, and starts the next as one lands', async () => {
    const pending = Array.from({ length: 20 }, () => deferred<number>());
    let inFlight = 0;
    let most = 0;
    const started: number[] = [];
    const all = boundedAll(pending, 6, async (item, index) => {
      started.push(index);
      inFlight += 1;
      most = Math.max(most, inFlight);
      try {
        return await item.promise;
      } finally {
        inFlight -= 1;
      }
    });

    await settle();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    pending[3].resolve(3);
    await settle();
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);

    pending.forEach((item, index) => item.resolve(index));
    expect(await all).toEqual(pending.map((_, index) => index));
    expect(most).toBe(6);
  });

  it('answers in the items’ order, whatever order they land in', async () => {
    const answer = boundedAll(
      [30, 10, 20],
      2,
      (ms) => new Promise((done) => setTimeout(() => done(ms), ms)),
    );

    expect(await answer).toEqual([30, 10, 20]);
  });

  it('answers an empty list for no items, starting nothing', async () => {
    const work = vi.fn();

    expect(await boundedAll([], 6, work)).toEqual([]);
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects as Promise.all does, and starts nothing after the failure', async () => {
    const pending = Array.from({ length: 5 }, () => deferred<number>());
    const started: number[] = [];
    const all = boundedAll(pending, 2, (item, index) => {
      started.push(index);
      return item.promise;
    });
    await settle();
    pending[0].reject(new Error('refused'));

    await expect(all).rejects.toThrow('refused');
    pending[1].resolve(1);
    await settle();
    expect(started).toEqual([0, 1]);
  });

  it('reads a limit below one as one', async () => {
    let inFlight = 0;
    let most = 0;
    await boundedAll([1, 2, 3], 0, async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await settle();
      inFlight -= 1;
    });

    expect(most).toBe(1);
  });
});
