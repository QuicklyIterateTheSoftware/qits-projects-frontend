/**
 * Markdown, rendered to HTML by hand — the subset a description is written in, and nothing more.
 *
 * ## Why this exists instead of `marked` or `markdown-it`
 *
 * Every description on an epic, a feature and a task is markdown: the refinement agent writes
 * headings, `**bold**`, backtick spans, fenced blocks and lists into them, and until this file
 * existed the cards printed all of that verbatim — `## Status page A public **status page**…` on
 * one line. A renderer was the fix, and a *dependency* was not available for it: this SPA ships
 * with the lockfile it has, the host's node is pinned under Angular 22's floor, and the same
 * reasoning already produced {@link ../project/agent/ansi-screen#AnsiScreen} rather than xterm.js.
 * So the subset is hand-rolled, and it is a subset on purpose.
 *
 * **What it renders:** ATX headings (`#`…`######`), paragraphs, `**strong**` and `*emphasis*` (and
 * their `_` spellings), inline code, fenced code blocks, unordered and ordered lists with one level
 * of nesting, links, blockquotes, horizontal rules, and hard line breaks (two trailing spaces or a
 * trailing backslash).
 *
 * **What it does not, said plainly:** no tables, no images, no reference links, no autolinks, no
 * footnotes, no indented (four-space) code blocks, no HTML passthrough, and no loose-list `<p>`
 * wrapping — a blank line inside a list ends it. Nesting deeper than one level flattens into the
 * level above. A description that wants any of those reads as close to its source as markdown gets;
 * it never reads as broken markup, which is the property that matters.
 *
 * ## Escaping is the invariant, not a feature
 *
 * **Every character of the source text is HTML-escaped before it is put inside a tag.** There is no
 * passthrough path: a description containing `<script>alert(1)</script>` or
 * `<img src=x onerror=alert(1)>` renders as those characters, visible, because a description is
 * *text* that happens to carry markdown punctuation — it is never a document that may bring its own
 * markup. The spec pins that in its own group, and it is the one behaviour here that must not be
 * relaxed to support a new construct.
 *
 * The output is bound with `[innerHTML]` and **no `bypassSecurityTrustHtml`**, so Angular's own
 * sanitizer runs over it as a second net. That is deliberate belt-and-braces: this file's escaping
 * is what makes the output safe, and the sanitizer is what makes a bug in this file survivable.
 *
 * Link targets get the same suspicion. Only `http:`, `https:`, `mailto:` and scheme-less URLs
 * become an `href`; anything else — `javascript:`, `data:`, a scheme hidden behind control
 * characters — is left as the literal text the author typed, so the reader sees the trick rather
 * than a link that performs it.
 */

/** The punctuation a backslash can escape, so `\*not emphasis\*` reads as it was typed. */
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>|~"']/;

/** An opening or closing code fence, and whatever follows it on the line (the info string). */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** `## Heading`, with the closing hashes CommonMark allows. A `#hashtag` is not one — the space is required. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** `---`, `***`, `___` — three or more, spaces allowed between. Checked before lists, which `- - -` also matches. */
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** `> quoted`, with the one optional space after the marker. */
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;

const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;

/** `1.` and `1)` both, because both appear in agent-written outlines. */
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;

const BLANK = /^[ \t]*$/;

/** `[label](url)`, with an optional double-quoted title. No nested parentheses in the url. */
const LINK = /^\[((?:[^[\]\\]|\\.)*)\]\(([^\s)]*)(?:[ \t]+"([^"]*)")?\)/;

/** A url's scheme, if it spells one at all. */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** The only schemes that become an `href`. Everything else stays text — see the file comment. */
const SAFE_SCHEMES = ['http', 'https', 'mailto'];

/** One list marker, decomposed. */
interface Marker {
  readonly indent: number;
  readonly ordered: boolean;
  /** The item's own text, with the marker removed. */
  readonly text: string;
}

/**
 * Markdown in, HTML out. Empty text answers an empty string, so a caller can ask `@if` of it.
 *
 * Pure and framework-free on purpose: this is the whole of the rendering, so it is asserted
 * directly in `markdown.spec.ts` rather than through a component fixture — the same split `format`
 * and `loadable` already use.
 */
export function renderMarkdown(source: string): string {
  if (!source) {
    return '';
  }
  return blocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

/**
 * The escape that everything else here depends on.
 *
 * Quotes are escaped along with the three structural characters because the same function writes
 * attribute values (`href`, `title`), and an unescaped quote there is an attribute break-out rather
 * than a cosmetic problem.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The block scanner: one pass down the lines, each block consuming as much as it owns. */
function blocks(lines: readonly string[]): string {
  let html = '';
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (BLANK.test(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const [code, next] = codeBlock(lines, index, fence[1]);
      html += code;
      index = next;
      continue;
    }

    if (RULE.test(line)) {
      html += '<hr>';
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level}>${inline(stripClosingHashes(heading[2] ?? ''))}</h${level}>`;
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const [quote, next] = quoteBlock(lines, index);
      html += quote;
      index = next;
      continue;
    }

    if (marker(line)) {
      const [list, next] = listBlock(lines, index, 0);
      html += list;
      index = next;
      continue;
    }

    const [paragraph, next] = paragraphBlock(lines, index);
    html += paragraph;
    index = next;
  }
  return html;
}

/**
 * A fenced block, up to a closing fence of the same character and at least the same length, or to
 * the end of the text — an unclosed fence is a description someone is still typing, not an error.
 *
 * The info string (` ```ts `) is read and dropped: nothing here highlights, so a `language-*` class
 * would be decoration no code reads. The body is escaped and otherwise untouched, which is the
 * whole point of a code block.
 */
function codeBlock(lines: readonly string[], start: number, fence: string): [string, number] {
  const character = fence[0] === '~' ? '~' : '`';
  const closing = new RegExp(`^ {0,3}${character}{${fence.length},}[ \t]*$`);
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !closing.test(lines[index])) {
    body.push(lines[index]);
    index += 1;
  }
  const consumed = index < lines.length ? index + 1 : index;
  return [`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`, consumed];
}

/**
 * A blockquote, rendered by running the block scanner over its stripped lines.
 *
 * Recursive rather than special-cased, so a quote holding a list or a heading draws them. A blank
 * line ends the quote: lazy continuation is the one CommonMark rule that makes a quote swallow the
 * paragraph after it, which is a worse failure than needing the `>` on every line.
 */
function quoteBlock(lines: readonly string[], start: number): [string, number] {
  const inner: string[] = [];
  let index = start;
  while (index < lines.length) {
    const quoted = QUOTE.exec(lines[index]);
    if (!quoted) {
      break;
    }
    inner.push(quoted[1]);
    index += 1;
  }
  return [`<blockquote>${blocks(inner)}</blockquote>`, index];
}

/** A paragraph: every line up to a blank one or the start of another block. */
function paragraphBlock(lines: readonly string[], start: number): [string, number] {
  const body: string[] = [];
  let index = start;
  while (index < lines.length && !BLANK.test(lines[index]) && !startsBlock(lines[index])) {
    body.push(lines[index]);
    index += 1;
  }
  return [`<p>${flow(body)}</p>`, index];
}

/** Whether a line begins a block of its own, and therefore ends the paragraph or item above it. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    marker(line) !== null
  );
}

/**
 * A list and, for a top-level one, the nested lists inside its items.
 *
 * <p><b>Indent decides, and two spaces is the step.</b> A marker two or more columns in belongs to
 * the item above it; anything shallower is a sibling. At depth 1 every further marker is a sibling
 * too — the third level flattens into the second rather than recursing, because a description deep
 * enough to need it is a document, and this renderer is honest about not being one.
 *
 * <p>A blank line ends the list, and so does a marker of the other kind: `- a` followed by `1. b`
 * is two lists, which is what the source says. An unindented line that starts no block of its own
 * continues the item above it, so a wrapped sentence stays in its bullet.
 */
function listBlock(lines: readonly string[], start: number, depth: number): [string, number] {
  const first = marker(lines[start]);
  if (!first) {
    return ['', start + 1];
  }
  const ordered = first.ordered;
  const base = first.indent;
  const items: string[] = [];
  let text: string[] = [];
  let nested = '';
  let open = false;

  const flush = (): void => {
    if (open) {
      items.push(flow(text) + nested);
    }
    text = [];
    nested = '';
  };

  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (BLANK.test(line)) {
      index += 1;
      break;
    }

    const found = marker(line);
    if (found) {
      if (depth === 0 && found.indent >= base + 2) {
        const [html, next] = listBlock(lines, index, depth + 1);
        nested += html;
        index = next;
        continue;
      }
      if (depth > 0 && found.indent < base) {
        break;
      }
      if (found.ordered !== ordered) {
        break;
      }
      flush();
      open = true;
      text.push(found.text);
      index += 1;
      continue;
    }

    if (startsBlock(line) || !open) {
      break;
    }
    text.push(line.trim());
    index += 1;
  }

  flush();
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`, index];
}

/** The list marker a line carries, or null for a line that carries none. Tabs count as two columns. */
function marker(line: string): Marker | null {
  const bullet = BULLET.exec(line);
  if (bullet && !RULE.test(line)) {
    return { indent: columns(bullet[1]), ordered: false, text: bullet[3] };
  }
  const ordered = ORDERED.exec(line);
  if (ordered) {
    return { indent: columns(ordered[1]), ordered: true, text: ordered[3] };
  }
  return null;
}

function columns(indent: string): number {
  return indent.replace(/\t/g, '  ').length;
}

/** `## Heading ##` — the trailing run is decoration, and it is not part of the words. */
function stripClosingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '');
}

/**
 * Several source lines as one run of inline content.
 *
 * A line ending in two spaces or a backslash is a **hard** break and becomes `<br>`; every other
 * newline is soft and stays a newline, which HTML collapses to a space. Keeping the newline rather
 * than emitting a space makes the generated markup readable in devtools, and reads identically.
 */
function flow(lines: readonly string[]): string {
  return lines
    .map((line, position) => {
      const last = position === lines.length - 1;
      const hard = /(?: {2,}|\\)$/.test(line);
      const content = inline(line.replace(/(?:[ \t]+|\\)$/, ''));
      return last ? content : content + (hard ? '<br>' : '\n');
    })
    .join('');
}

/**
 * One run of inline content: emphasis, code, links and escapes, over text that is escaped as it is
 * emitted.
 *
 * A single left-to-right scan, holding plain characters in a buffer and flushing them through
 * {@link escapeHtml} whenever a construct interrupts. Written this way rather than as a chain of
 * `replace` calls because both orderings of "escape, then match" are wrong: escaping first turns
 * `&amp;` into a token the matchers can see, and matching first means a tag is built around text
 * nobody escaped. Here the two cannot come apart.
 */
function inline(text: string): string {
  let html = '';
  let plain = '';
  let index = 0;

  const flushPlain = (): void => {
    html += escapeHtml(plain);
    plain = '';
  };

  while (index < text.length) {
    const character = text[index];

    if (character === '\\' && index + 1 < text.length && ESCAPABLE.test(text[index + 1])) {
      plain += text[index + 1];
      index += 2;
      continue;
    }

    if (character === '`') {
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(text.slice(index));
      if (code) {
        flushPlain();
        html += `<code>${escapeHtml(code[2])}</code>`;
        index += code[0].length;
        continue;
      }
    }

    if (character === '[') {
      const link = LINK.exec(text.slice(index));
      if (link) {
        flushPlain();
        html += anchor(link[1], link[2], link[3]);
        index += link[0].length;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const span = emphasis(text, index, character);
      if (span) {
        flushPlain();
        html += span.html;
        index = span.next;
        continue;
      }
    }

    plain += character;
    index += 1;
  }

  flushPlain();
  return html;
}

/**
 * A link, or the source text back again when its target is not one this page will offer.
 *
 * The refused case renders what the author typed — `[press me](javascript:steal())` stays visible
 * as those characters — rather than quietly dropping the url and leaving a label that looks
 * ordinary. A reader who can see the trick can report it.
 */
function anchor(label: string, url: string, title: string | undefined): string {
  const target = safeUrl(url);
  if (target === null) {
    return escapeHtml(`[${label}](${url}${title === undefined ? '' : ` "${title}"`})`);
  }
  const titled = title === undefined ? '' : ` title="${escapeHtml(title)}"`;
  return `<a href="${escapeHtml(target)}"${titled}>${inline(label)}</a>`;
}

/**
 * A url with its scheme vetted, or null for one that must stay text.
 *
 * Control characters and spaces are removed *before* the scheme is read, because a browser removes
 * them too: `java\tscript:alert(1)` is a `javascript:` url to the navigator and a scheme-less
 * relative path to a naive regex, and that gap is the whole trick.
 */
function safeUrl(url: string): string | null {
  const bare = Array.from(url)
    .filter((character) => (character.codePointAt(0) ?? 0) > 0x20)
    .join('');
  const scheme = SCHEME.exec(bare);
  if (!scheme) {
    return bare;
  }
  return SAFE_SCHEMES.includes(scheme[1].toLowerCase()) ? bare : null;
}

/**
 * `**strong**` or `*emphasis*` starting at `index`, or null when the run opens nothing.
 *
 * An underscore only opens a span when the character before it is not alphanumeric, and only closes
 * one when the character after it is not: without that rule `qits_spa_projects` renders as
 * `qits<em>spa</em>projects`, and identifiers are exactly what these descriptions are full of.
 */
function emphasis(
  text: string,
  index: number,
  delimiter: string,
): { html: string; next: number } | null {
  if (delimiter === '_' && index > 0 && /[A-Za-z0-9]/.test(text[index - 1])) {
    return null;
  }
  const strong = text.startsWith(delimiter + delimiter, index);
  const run = delimiter.repeat(strong ? 2 : 1);
  const from = index + run.length;
  const close = closingRun(text, from, run, delimiter);
  if (close < 0) {
    return null;
  }
  const tag = strong ? 'strong' : 'em';
  return {
    html: `<${tag}>${inline(text.slice(from, close))}</${tag}>`,
    next: close + run.length,
  };
}

/** Where the matching delimiter run ends the span, or -1 for a run that is never closed. */
function closingRun(text: string, from: number, run: string, delimiter: string): number {
  for (let index = from; index < text.length; index += 1) {
    if (!text.startsWith(run, index)) {
      continue;
    }
    if (index === from) {
      // Empty content: `****` is four asterisks, not two empty spans.
      continue;
    }
    if (run.length === 1 && text[index + 1] === delimiter) {
      // A `**` inside a `*…*` span is the nested strong, not this span's close. Step over both.
      index += 1;
      continue;
    }
    if (delimiter === '_' && /[A-Za-z0-9]/.test(text[index + run.length] ?? '')) {
      continue;
    }
    return index;
  }
  return -1;
}
