import { escapeHtml, renderMarkdown } from './markdown';

/**
 * The renderer is asserted on its output string, because the string *is* the contract: it is handed
 * to `[innerHTML]`, so what it contains is what the browser is asked to build.
 *
 * The bug that produced this file is the first group: an epic description arrived as markdown and
 * every card printed it verbatim.
 */
describe('renderMarkdown', () => {
  it('renders the description that was being printed raw', () => {
    const source = ['## Status page', '', 'A public **status page** for the platform.'].join('\n');

    expect(renderMarkdown(source)).toBe(
      '<h2>Status page</h2><p>A public <strong>status page</strong> for the platform.</p>',
    );
  });

  it('draws nothing for text with nothing in it, so a caller can ask `@if` of it', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\n\n')).toBe('');
  });

  it('accepts the line endings a pasted description arrives with', () => {
    expect(renderMarkdown('one\r\n\r\ntwo')).toBe('<p>one</p><p>two</p>');
  });
});

describe('headings', () => {
  it('renders one through six', () => {
    expect(renderMarkdown('# a\n## b\n### c\n#### d\n##### e\n###### f')).toBe(
      '<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>',
    );
  });

  it('drops the closing hashes, which are decoration rather than words', () => {
    expect(renderMarkdown('## Scope ##')).toBe('<h2>Scope</h2>');
  });

  /** The space is what makes it a heading. Without it the line is a sentence about a tag. */
  it('leaves a hashtag and a seventh hash as text', () => {
    expect(renderMarkdown('#nostatus')).toBe('<p>#nostatus</p>');
    expect(renderMarkdown('####### seven')).toBe('<p>####### seven</p>');
  });

  it('renders inline markup inside a heading', () => {
    expect(renderMarkdown('## The `qits-ci` **service**')).toBe(
      '<h2>The <code>qits-ci</code> <strong>service</strong></h2>',
    );
  });
});

describe('paragraphs and line breaks', () => {
  it('keeps consecutive lines in one paragraph', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one\ntwo</p>');
  });

  /** Two trailing spaces, and a trailing backslash, are the two spellings of a hard break. */
  it('turns a hard break into a <br>', () => {
    expect(renderMarkdown('one  \ntwo')).toBe('<p>one<br>two</p>');
    expect(renderMarkdown('one\\\ntwo')).toBe('<p>one<br>two</p>');
  });

  it('separates paragraphs on a blank line', () => {
    expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
  });
});

describe('emphasis', () => {
  it('renders both spellings of strong and of emphasis', () => {
    expect(renderMarkdown('**a** __b__ *c* _d_')).toBe(
      '<p><strong>a</strong> <strong>b</strong> <em>c</em> <em>d</em></p>',
    );
  });

  it('nests strong inside emphasis', () => {
    expect(renderMarkdown('*a **b** c*')).toBe('<p><em>a <strong>b</strong> c</em></p>');
  });

  /**
   * These descriptions are full of identifiers, and `qits_spa_projects` is not three words with one
   * of them italic. An underscore run only opens or closes a span at a non-alphanumeric edge.
   */
  it('leaves the underscores in an identifier alone', () => {
    expect(renderMarkdown('qits_spa_projects and snake_case_names')).toBe(
      '<p>qits_spa_projects and snake_case_names</p>',
    );
  });

  it('leaves an unclosed run as the character it is', () => {
    expect(renderMarkdown('2 * 3 and **unclosed')).toBe('<p>2 * 3 and **unclosed</p>');
  });

  it('honours a backslash escape', () => {
    expect(renderMarkdown('\\*not emphasis\\*')).toBe('<p>*not emphasis*</p>');
  });
});

describe('code', () => {
  it('renders an inline span, with its markdown punctuation left as characters', () => {
    expect(renderMarkdown('run `ng test --**watch**`')).toBe(
      '<p>run <code>ng test --**watch**</code></p>',
    );
  });

  it('renders a fenced block and carries its language class', () => {
    expect(renderMarkdown('```ts\nconst a = 1;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1;\n</code></pre>',
    );
  });

  it('keeps the blank lines and the indentation inside a block', () => {
    expect(renderMarkdown('```\na\n\n  b\n```')).toBe('<pre><code>a\n\n  b\n</code></pre>');
  });

  it('accepts tilde fences, and a longer fence than three', () => {
    expect(renderMarkdown('~~~\na\n~~~')).toBe('<pre><code>a\n</code></pre>');
    expect(renderMarkdown('````\n```\n````')).toBe('<pre><code>```\n</code></pre>');
  });

  /** A description someone is still typing, not an error — so it renders what is there. */
  it('closes an unclosed fence at the end of the text', () => {
    expect(renderMarkdown('```\nhalf written')).toBe('<pre><code>half written\n</code></pre>');
  });
});

describe('lists', () => {
  it('renders an unordered list', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('renders an ordered list, in both spellings of the marker', () => {
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(renderMarkdown('1) a\n2) b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('nests one level under the item above it', () => {
    expect(renderMarkdown('- a\n  - b\n  - c\n- d')).toBe(
      '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>',
    );
  });

  it('supports standard deeply nested lists', () => {
    expect(renderMarkdown('- a\n  - b\n    - c')).toBe(
      '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>',
    );
  });

  it('keeps a wrapped sentence inside its bullet', () => {
    expect(renderMarkdown('- a line\n  that wraps')).toBe('<ul><li>a line\nthat wraps</li></ul>');
  });

  it('starts a new list when the marker changes kind', () => {
    expect(renderMarkdown('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('renders inline markup inside an item', () => {
    expect(renderMarkdown('- the `epic/` **branch**')).toBe(
      '<ul><li>the <code>epic/</code> <strong>branch</strong></li></ul>',
    );
  });

  it('ends the list at a heading', () => {
    expect(renderMarkdown('- a\n## next')).toBe('<ul><li>a</li></ul><h2>next</h2>');
  });
});

describe('links', () => {
  it('renders an http link, and one with a title', () => {
    expect(renderMarkdown('see [the run](https://qits.example/ci/api/runs/7)')).toBe(
      '<p>see <a href="https://qits.example/ci/api/runs/7">the run</a></p>',
    );
    expect(renderMarkdown('[home](/projects/ "The projects page")')).toBe(
      '<p><a href="/projects/" title="The projects page">home</a></p>',
    );
  });

  it('renders markup inside the label', () => {
    expect(renderMarkdown('[the **run**](/ci/)')).toBe(
      '<p><a href="/ci/">the <strong>run</strong></a></p>',
    );
  });

  it('escapes an ampersand in the target rather than leaving it bare in the attribute', () => {
    expect(renderMarkdown('[q](/search?a=1&b=2)')).toBe(
      '<p><a href="/search?a=1&amp;b=2">q</a></p>',
    );
  });
});

/**
 * The invariant, in its own group: **nothing in a description becomes markup**.
 *
 * A description is written by an agent and edited by people, and it reaches this renderer as text
 * from an API. Every one of these would be a stored cross-site scripting hole if the renderer had a
 * passthrough path, and there is exactly one way to be sure it does not — assert the escaped
 * characters, not the absence of an alert.
 */
describe('escaping', () => {
  it('renders a script tag as the characters it is', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('renders an event handler on an image as text', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('escapes inside every construct it renders, not only in paragraphs', () => {
    expect(renderMarkdown('## <b>heading</b>')).toBe('<h2>&lt;b&gt;heading&lt;/b&gt;</h2>');
    expect(renderMarkdown('- <b>item</b>')).toBe('<ul><li>&lt;b&gt;item&lt;/b&gt;</li></ul>');
    expect(renderMarkdown('**<b>bold</b>**')).toBe(
      '<p><strong>&lt;b&gt;bold&lt;/b&gt;</strong></p>',
    );
    expect(renderMarkdown('> <b>quoted</b>')).toBe(
      '<blockquote><p>&lt;b&gt;quoted&lt;/b&gt;</p></blockquote>',
    );
  });

  /** A code block is where markup is most likely to appear honestly, and it still comes out as text. */
  it('escapes a code block that closes the tags around it', () => {
    expect(renderMarkdown('```\n</code></pre><script>alert(1)</script>\n```')).toBe(
      '<pre><code>&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>',
    );
  });

  it('escapes an inline span that tries the same', () => {
    expect(renderMarkdown('`</code><b>x</b>`')).toBe(
      '<p><code>&lt;/code&gt;&lt;b&gt;x&lt;/b&gt;</code></p>',
    );
  });

  it('refuses a javascript: target and shows the reader what was written', () => {
    expect(renderMarkdown('[press me](javascript:alert(1))')).toBe(
      '<p>[press me](javascript:alert(1))</p>',
    );
  });

  it('refuses a data: target', () => {
    expect(renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')).toBe(
      '<p>[x](data:text/html;base64,PHNjcmlwdD4=)</p>',
    );
  });

  /** A browser strips the control characters before it reads the scheme, so this must too. */
  it('sees through a scheme hidden behind a control character', () => {
    const rendered = renderMarkdown('[x](\u0001javascript:alert(1))');

    expect(rendered).not.toContain('<a');
    expect(rendered).toContain('javascript:alert(1)');
  });

  it('escapes a quote in the target, which is the other way out of an attribute', () => {
    expect(renderMarkdown('[x](/a")')).toBe('<p><a href="/a&quot;">x</a></p>');
  });

  it('escapes the title, which is an attribute as well', () => {
    expect(renderMarkdown('[x](/a "a<b>")')).toBe('<p><a href="/a" title="a&lt;b&gt;">x</a></p>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter in text and in an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand first, so an escape is not double-escaped into a different one', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('the remaining blocks', () => {
  it('renders a blockquote, and the blocks inside it', () => {
    expect(renderMarkdown('> a note\n> - and a bullet')).toBe(
      '<blockquote><p>a note</p><ul><li>and a bullet</li></ul></blockquote>',
    );
  });

  it('renders the three spellings of a horizontal rule', () => {
    expect(renderMarkdown('---\n***\n___')).toBe('<hr><hr><hr>');
  });

  /** `- - -` is both a rule and a bullet by the letter of the syntax. The rule wins, as it should. */
  it('reads a spaced rule as a rule rather than as a list', () => {
    expect(renderMarkdown('- - -')).toBe('<hr>');
  });
});
