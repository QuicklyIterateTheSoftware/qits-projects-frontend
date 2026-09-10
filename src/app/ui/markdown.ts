import { Marked, Renderer } from 'marked';

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);
const SAFE_IMAGE_SCHEMES = new Set(['http', 'https']);
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

const renderer = new Renderer();

/**
 * What a dossier page knows about its own figures, for the one call being rendered.
 *
 * **The renderer decides `<img>` or `<iframe>`, never the author.** `renderer.html` stays
 * {@link escapeHtml}, so raw HTML in a body renders as visible text — that is the one surface which
 * deliberately keeps raw HTML out, and letting an author write an iframe tag to frame a design would
 * re-admit it. So a figure is written as ordinary image syntax and this decides the tag from the
 * asset's kind, which puts the frame's attributes in code, tested once, instead of in every
 * document.
 *
 * It is a module-scoped variable rather than a parameter threaded through marked because the parse
 * is synchronous: {@link renderMarkdown} sets it, parses, and clears it in a `finally`.
 */
let figures: DossierFigures | null = null;

/** The epic whose assets may be framed, and what kind each of them is. */
export interface DossierFigures {
  readonly epicId: string;
  /** Asset id → kind. An id absent from it is not framed, whatever its URL looks like. */
  readonly kinds: ReadonlyMap<string, 'IMAGE' | 'DESIGN'>;
}

/** The URL shape the inline door writes into a page's markdown. */
const DOSSIER_ASSET = /^\/epics\/([A-Za-z0-9._~-]+)\/dossier-assets\/([A-Za-z0-9._~-]+)\/content$/;

/**
 * The asset id this URL names, if it is a DESIGN of the epic being rendered.
 *
 * A URL that is not a dossier asset **of this epic** is an ordinary image and is never framed: a
 * page must not be able to frame another epic's document by naming its path.
 */
function framedDesign(href: string): string | null {
  if (!figures) return null;
  const match = DOSSIER_ASSET.exec(href);
  if (!match || match[1] !== figures.epicId) return null;
  return figures.kinds.get(match[2]) === 'DESIGN' ? match[2] : null;
}

// Epic descriptions are user/agent-authored text. Standard Markdown is supported, raw HTML is not.
renderer.html = ({ text }) => escapeHtml(text);

renderer.link = function (token) {
  if (!safeUrl(token.href, SAFE_LINK_SCHEMES)) return escapeHtml(token.raw);
  const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  return `<a href="${escapeHtml(token.href)}"${title}>${this.parser.parseInline(token.tokens)}</a>`;
};

renderer.image = (token) => {
  if (!safeImageUrl(token.href)) return escapeHtml(token.raw);
  const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  if (framedDesign(token.href)) {
    // Sandboxed, and never with `allow-same-origin`. The response carries `Content-Security-Policy:
    // sandbox` too, which is what covers the URL being opened directly; this attribute covers the
    // frame.
    return (
      `<iframe src="${escapeHtml(token.href)}" sandbox loading="lazy"` +
      ` title="${escapeHtml(token.text)}"${title}></iframe>`
    );
  }
  return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title}>`;
};

const markdown = new Marked({
  gfm: true,
  renderer,
});

/**
 * Render GitHub-flavoured Markdown while keeping raw HTML and unsafe URLs inert.
 *
 * Pass {@link DossierFigures} to let a dossier page's DESIGN assets render as sandboxed frames;
 * without it — every other caller — image syntax renders as an image, exactly as before.
 */
export function renderMarkdown(source: string, dossier?: DossierFigures): string {
  if (!source.trim()) return '';
  figures = dossier ?? null;
  let rendered: string;
  try {
    rendered = markdown.parse(source.replace(/\r\n?/g, '\n'), { async: false });
  } finally {
    figures = null;
  }
  // Marked formats block HTML with newlines; compact boundaries keep snapshots and DOM inspection
  // stable without changing whitespace inside paragraphs or code blocks.
  return rendered.trim().replace(/>\n(?=<)/g, '>');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string, allowedSchemes: ReadonlySet<string>): boolean {
  const normalized = [...url]
    .filter((character) => character.charCodeAt(0) > 0x20 && character.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  const scheme = SCHEME.exec(normalized);
  return !scheme || allowedSchemes.has(scheme[1].toLowerCase());
}

function safeImageUrl(url: string): boolean {
  return (
    safeUrl(url, SAFE_IMAGE_SCHEMES) ||
    /^data:image\/(?:png|jpeg);base64,[a-zA-Z0-9+/]*={0,2}$/.test(url)
  );
}
