import { HttpErrorResponse } from '@angular/common/http';
import { notSignedIn } from './agent-sign-in';

/** The daemon's sentence. Rendered, never matched on — that distinction is what this suite pins. */
const SENTENCE =
  "Nobody has signed Claude Code in on this platform's shared credential volume, so this session" +
  ' cannot start.';

function answer(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'no', error: body });
}

/**
 * Telling "nobody has signed in" apart from every other way a launch can fail.
 *
 * <p>The load-bearing test is the negative one below: **the sentence alone is not the refusal.** The
 * marker is `error: "not-signed-in"`, and a reader that matched the prose would be rebuilding the
 * defect this epic removes — a contract living in a display string, which changes meaning the day
 * somebody rewords it. The other direction matters just as much: a false positive puts a sign-in
 * button in front of a reader whose real problem is something else, which is the same class of lie
 * as the substitution this whole feature replaces.
 */
describe('notSignedIn', () => {
  it('reads the refusal off its marker, and names the harness off its field', () => {
    const read = notSignedIn(
      answer(409, { error: 'not-signed-in', agentType: 'CLAUDE', message: SENTENCE }),
    );
    expect(read?.harness).toBe('CLAUDE');
    expect(read?.label).toBe('Claude Code');
    expect(read?.message).toBe(SENTENCE);
  });

  it('names Kimi from the field rather than from the sentence', () => {
    const read = notSignedIn(
      answer(409, {
        error: 'not-signed-in',
        agentType: 'KIMI',
        // Deliberately says "Claude": the field decides, and prose never does.
        message: 'Claude Code is signed in; this one is not.',
      }),
    );
    expect(read?.harness).toBe('KIMI');
    expect(read?.label).toBe('Kimi Code');
  });

  it('names no harness rather than guessing at one', () => {
    const read = notSignedIn(answer(409, { error: 'not-signed-in', message: SENTENCE }));
    expect(read?.harness).toBeNull();
    expect(read?.label).toBe('the coding agent');
  });

  /** The whole point of the marker: the words are not the contract. */
  it('does not read the sentence as the refusal', () => {
    expect(notSignedIn(answer(409, { message: SENTENCE }))).toBeNull();
    expect(notSignedIn(answer(400, { error: 'not-signed-in', message: SENTENCE }))).toBeNull();
  });

  it('is not every failure', () => {
    expect(notSignedIn(answer(400, { message: 'fork is not supported by Kimi Code' }))).toBeNull();
    expect(notSignedIn(answer(409, { error: 'session-in-use' }))).toBeNull();
    expect(notSignedIn(answer(502, 'Bad Gateway'))).toBeNull();
    expect(notSignedIn(new Error('boom'))).toBeNull();
  });
});
