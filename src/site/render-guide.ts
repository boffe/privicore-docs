/**
 * Renders a single editorial guide page: reads `.md` from `content/`,
 * converts to HTML, wraps in the site's shared chrome (top bar, sidebar
 * with guide list, footer).
 *
 * Kept intentionally un-opinionated: no blog-style features, no search
 * (we'll add search via client-side indexing later if needed), no
 * pagination. Just "a page of prose that matches the reference site's
 * look".
 */

import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/common";
import { THEME_BOOTSTRAP_SCRIPT, THEME_TOGGLE_BUTTON, THEME_SCRIPT_TAG } from "./theme-boilerplate.ts";

// Server-side syntax highlighting. Runs once per build; no client JS.
marked.use(markedHighlight({
  langPrefix: "hljs language-",
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    return hljs.highlight(code, { language }).value;
  },
}));

// Apidog-style admonition blocks:
//
//     :::info[Title optional]
//     body markdown, supports paragraphs, code, links, etc.
//     :::
//
// Rendered as <div class="admonition admonition-TYPE">…</div>. The title
// line is optional; if omitted the block uses the capitalised type name.
const ADMONITION_TYPES = ["info", "note", "tip", "warning", "danger"] as const;
type AdmonitionType = typeof ADMONITION_TYPES[number];
const ADMONITION_OPEN_RE = new RegExp(
  `^:::(${ADMONITION_TYPES.join("|")})(?:\\[([^\\]]*)\\])?[^\\n]*\\n`,
);
// marked's extension typings require an `any`-flavoured tokenizer signature
// because custom tokens are free-form. We confine the looseness to this one
// registration; the admonition body is fully parsed by marked's own lexer so
// everything downstream stays standards-compliant.
type AdmonitionToken = {
  type: "admonition";
  raw: string;
  admType: AdmonitionType;
  admTitle: string;
  tokens: unknown[];
};
marked.use({
  extensions: [{
    name: "admonition",
    level: "block",
    start(src: string) { return src.match(/:::/)?.index; },
    tokenizer(this: { lexer: { blockTokens: (src: string, tokens: unknown[]) => void } }, src: string): AdmonitionToken | undefined {
      const openMatch = ADMONITION_OPEN_RE.exec(src);
      if (!openMatch) return undefined;
      const rest = src.slice(openMatch[0].length);
      const closeIdx = rest.search(/^:::\s*$/m);
      if (closeIdx === -1) return undefined;
      const inner = rest.slice(0, closeIdx);
      const fullLen = openMatch[0].length + closeIdx + 3;
      const after = src.charAt(fullLen);
      const consumed = after === "\n" ? fullLen + 1 : fullLen;
      const innerTokens: unknown[] = [];
      this.lexer.blockTokens(inner, innerTokens);
      return {
        type: "admonition",
        raw: src.slice(0, consumed),
        admType: openMatch[1] as AdmonitionType,
        admTitle: (openMatch[2] ?? "").trim(),
        tokens: innerTokens,
      };
    },
    renderer(this: { parser: { parse: (t: unknown[]) => string } }, token: AdmonitionToken): string {
      const title = escapeHtml(token.admTitle || capitalise(token.admType));
      const body = this.parser.parse(token.tokens);
      return `<div class="admonition admonition-${token.admType}">`
        + `<p class="admonition-title">${title}</p>`
        + body
        + `</div>`;
    },
  }] as never,
});
function capitalise(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export interface GuideMeta {
  slug: string;
  title: string;
  /** Relative path to the markdown source, for "edit this page" links. */
  sourcePath?: string;
  /** Override the default `/guides/{slug}.html` URL. Used for sidebar
   *  entries that point outside the guides/ tree (e.g. agents.md). */
  href?: string;
}

export interface GuideRenderInput {
  siteTitle: string;
  guide: GuideMeta;
  markdown: string;
  /** Other guides, to render the sidebar index. */
  allGuides: GuideMeta[];
  topBarLinks?: Array<{ label: string; href: string }>;
}

export function renderGuidePage(input: GuideRenderInput): string {
  const body = marked.parse(input.markdown, { async: false }) as string;
  const topBar = (input.topBarLinks ?? []).map((l) =>
    `<a href="${escapeHtml(l.href)}" class="topbar-link">${escapeHtml(l.label)}</a>`,
  ).join("\n      ");
  const sidebarItems = input.allGuides.map((g) => {
    const active = g.slug === input.guide.slug ? ' class="active"' : "";
    const href = g.href ?? `/guides/${g.slug}.html`;
    return `<li${active}><a href="${escapeHtml(href)}">${escapeHtml(g.title)}</a></li>`;
  }).join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.guide.title)} — ${escapeHtml(input.siteTitle)}</title>
  ${THEME_BOOTSTRAP_SCRIPT}
  <link rel="stylesheet" href="/assets/shell.css">
  <link rel="stylesheet" href="/assets/ai-agent/styles.css">
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand"><a href="/"><img src="/images/privicore-logo.png" alt="">${escapeHtml(input.siteTitle)}</a></div>
    <nav class="topbar-nav">
      ${topBar}
      ${THEME_TOGGLE_BUTTON}
    </nav>
  </header>
  <div class="guide-layout">
    <aside class="guide-sidebar">
      <h2>Guides</h2>
      <ul>
        ${sidebarItems}
      </ul>
    </aside>
    <article class="guide-content">
      ${body}
    </article>
  </div>
  ${THEME_SCRIPT_TAG}
  <script type="module" src="/assets/ai-agent/launcher.js"></script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
