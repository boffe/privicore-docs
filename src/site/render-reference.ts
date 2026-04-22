/**
 * Builds the HTML shell that embeds Scalar's API reference against our
 * generated OpenAPI spec. Scalar renders the three-column layout
 * (nav | content | code sample) directly from the spec URL.
 *
 * Why Scalar:
 *   - Open source, actively maintained.
 *   - Fully driven by OpenAPI so our probe → IR → OpenAPI → site
 *     pipeline stays end-to-end standards-compliant.
 *
 * Customisation happens here. Branding, typography, colour palette, and
 * the top-bar nav are ours. The reference content itself is Scalar's.
 */

import { THEME_BOOTSTRAP_SCRIPT, THEME_TOGGLE_BUTTON, THEME_SCRIPT_TAG } from "./theme-boilerplate.ts";

export interface ReferenceShellOptions {
  title: string;
  /** Relative URL of the OpenAPI JSON file to render. */
  specUrl: string;
  /** Extra links to render in the top bar. */
  topBarLinks?: Array<{ label: string; href: string }>;
  /** Scalar's CDN URL — pinned for reproducibility. */
  scalarCdnUrl?: string;
  /** Scalar configuration object (serialised into the script tag). */
  scalarConfig?: Record<string, unknown>;
}

// Major-version pinned so a Scalar breaking change doesn't silently
// stop rendering operations (they did in fact change the config shape
// between majors — the old pattern of a JSON `<script>` body with
// `{url: …}` inside is no longer recognised, which produces a page
// that shows only the spec's `info` block).
const DEFAULT_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1";

/**
 * Custom CSS injected into Scalar via the `customCss` config option.
 *
 * Scalar's sidebar active state is applied via utility classes:
 * `.bg-sidebar-b-active`, `.text-sidebar-c-active`, `.font-sidebar-active`.
 * Its default rule is `.scalar-app .bg-sidebar-b-active` (two classes).
 * The theme class (`.dark-mode` / `.light-mode`) is on <html>, NOT on
 * `.scalar-app`, so we target via descendant combinator —
 * `.dark-mode .scalar-app .bg-sidebar-b-active`. `!important` on the
 * active-state rules since this is the single most-visible piece of
 * chrome and we don't want a future Scalar update to win by specificity.
 */
const CUSTOM_CSS = `
.light-mode .scalar-app .bg-sidebar-b-active {
  background-color: #fbf7ff !important;
}
.light-mode .scalar-app .text-sidebar-c-active {
  color: #6639b7 !important;
}
.light-mode .scalar-app .font-sidebar-active {
  font-weight: 600 !important;
}

.dark-mode .scalar-app .bg-sidebar-b-active {
  background-color: #2a1f3d !important;
}
.dark-mode .scalar-app .text-sidebar-c-active {
  color: #d2a8ff !important;
}
.dark-mode .scalar-app .font-sidebar-active {
  font-weight: 600 !important;
}

/* Full palette override, scoped to .scalar-app so it wins over
   Scalar's default theme. Scalar defines its backgrounds on the
   .dark-mode class which can resolve closer to consumers than
   our html-level override; pinning them on .scalar-app puts our
   values at the same scope as Scalar's own. */
.light-mode .scalar-app {
  --scalar-background-1: #ffffff;
  --scalar-background-2: #fafbfc;
  --scalar-background-3: #f6f8fa;
  --scalar-background-accent: #8250df14;
  --scalar-color-1: #1f2328;
  --scalar-color-2: #424a53;
  --scalar-color-3: #656d76;
  --scalar-color-accent: #8250df;
  --scalar-border-color: #d0d7de;
}
.dark-mode .scalar-app {
  --scalar-background-1: #1d2125;
  --scalar-background-2: #22272b;
  --scalar-background-3: #282e33;
  --scalar-background-accent: #d2a8ff1f;
  --scalar-color-1: #e6edf3;
  --scalar-color-2: #c9d1d9;
  --scalar-color-3: #8b949e;
  --scalar-color-accent: #d2a8ff;
  --scalar-border-color: #3b4148;
}

/* Sidebar-specific variables (Scalar scopes some to .t-doc__sidebar). */
.light-mode .scalar-app,
.light-mode .scalar-app .t-doc__sidebar {
  --scalar-sidebar-background-1: #ffffff;
  --scalar-sidebar-color-active: #6639b7;
  --scalar-sidebar-item-active-background: #fbf7ff;
  --scalar-sidebar-indent-border-active: #8250df;
  --scalar-sidebar-font-weight-active: 600;
}
.dark-mode .scalar-app,
.dark-mode .scalar-app .t-doc__sidebar {
  --scalar-sidebar-background-1: #1d2125;
  --scalar-sidebar-color-active: #d2a8ff;
  --scalar-sidebar-item-active-background: #2a1f3d;
  --scalar-sidebar-indent-border-active: #d2a8ff;
  --scalar-sidebar-font-weight-active: 600;
}

/* Also force the sidebar container's background-color directly, for
   belt-and-braces. The utility class .bg-sidebar-b-1 is what actually
   paints the sidebar panel. */
.light-mode .scalar-app .bg-sidebar-b-1 {
  background-color: #ffffff !important;
}
.dark-mode .scalar-app .bg-sidebar-b-1 {
  background-color: #1d2125 !important;
}
`.trim();

export function renderReferenceShell(opts: ReferenceShellOptions): string {
  const topBar = (opts.topBarLinks ?? []).map((l) =>
    `<a href="${escapeHtml(l.href)}" class="topbar-link">${escapeHtml(l.label)}</a>`,
  ).join("\n      ");

  const scalarConfig = {
    // `default` is Scalar's neutral theme — it consumes our CSS
    // variables cleanly (unlike "none", which strips styling, and
    // unlike the named themes like "purple" which bake in their own
    // palette and out-specificity our overrides).
    theme: "default",
    layout: "modern",
    // Inject CSS directly into Scalar's own scope. This wins the
    // specificity race against Scalar's internal theme rules and
    // pins the active-sidebar item to our purple palette in both
    // modes.
    customCss: CUSTOM_CSS,
    // Suppress Scalar's built-in Ask-AI button; we ship our own
    // BYOK launcher (`/assets/ai-agent/launcher.js`) site-wide.
    agent: { disabled: true },
    // Hide Scalar's "Open in API Client" button — it's Scalar's own
    // standalone REST client, outside our docs experience.
    hideClientButton: true,
    // Disable the default MCP integration — it puts "Install in Cursor"
    // / "Install in VS Code" / "Generate MCP" links in the sidebar
    // footer that all point at scalar.com.
    mcp: { disabled: true },
    // Hide Scalar's developer-tools strip (Configure / Share / Deploy).
    // Shown on localhost by default; `never` kills it everywhere.
    showDeveloperTools: "never",
    // We ship our own theme toggle in the topbar (works for guides
    // and the reference together). Hide Scalar's own to avoid two
    // toggles competing on the same page.
    hideDarkModeToggle: true,
    ...opts.scalarConfig,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  ${THEME_BOOTSTRAP_SCRIPT}
  <link rel="stylesheet" href="/assets/shell.css">
  <link rel="stylesheet" href="/assets/ai-agent/styles.css">
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand">
      <a href="/"><img src="/images/privicore-logo.png" alt="">${escapeHtml(opts.title)}</a>
    </div>
    <nav class="topbar-nav">
      ${topBar}
      ${THEME_TOGGLE_BUTTON}
    </nav>
  </header>
  <main class="reference-mount">
    <script
      id="api-reference"
      data-url="${escapeHtml(opts.specUrl)}"
      data-configuration='${escapeHtml(JSON.stringify(scalarConfig))}'></script>
    <script src="${escapeHtml(opts.scalarCdnUrl ?? DEFAULT_CDN)}"></script>
  </main>
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
