import { Marked, Renderer } from 'marked';

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);
const SAFE_IMAGE_SCHEMES = new Set(['http', 'https']);
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

const renderer = new Renderer();

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
  return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title}>`;
};

const markdown = new Marked({
  gfm: true,
  renderer,
});

/** Render GitHub-flavoured Markdown while keeping raw HTML and unsafe URLs inert. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return '';
  const rendered = markdown.parse(source.replace(/\r\n?/g, '\n'), { async: false });
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
