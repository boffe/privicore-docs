/**
 * Orchestrates site generation: reads IR + editorial content, emits a
 * fully static `dist/` that can be hosted anywhere.
 *
 * Layout of dist/:
 *   index.html            — landing page
 *   reference/index.html  — Scalar-rendered OpenAPI reference
 *   openapi.json          — the OpenAPI 3.1 spec the reference renders from
 *   guides/<slug>.html    — one file per `content/guides/*.md`
 *   assets/shell.css      — shared stylesheet
 *
 * Deliberately does not minify / bundle. For a docs site this small
 * it's not worth the added tooling; all modern static hosts gzip the
 * assets on the way out.
 */

import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";
import { toOpenApi } from "../ir/to-openapi.ts";
import type { DocSet } from "../ir/types.ts";
import { renderReferenceShell } from "./render-reference.ts";
import { renderGuidePage, type GuideMeta } from "./render-guide.ts";
import { renderHomePage } from "./render-home.ts";
import { applyBasePath, applySiteConfig, applySiteConfigDeep, type SiteUrlConfig } from "./site-config.ts";

const DEFAULT_CSS_PATH = "src/site/shell.css";

export interface BuildInput {
  /** Where to read the IR DocSet from. */
  docSetPath: string;
  /** Directory with editorial markdown. Subdir `guides/` → guide pages. */
  contentDir: string;
  /** Directory to write the static site to. */
  outDir: string;
  siteTitle?: string;
  tagline?: string;
}

export async function build(input: BuildInput): Promise<void> {
  const siteTitle = input.siteTitle ?? "Privicore API";
  const tagline = input.tagline ?? "Data-at-rest tokenisation vault. Reference + guides.";

  const cfg = getConfig();
  const siteUrls: SiteUrlConfig = {
    apiUrl: cfg.docsApiUrl,
    wsUrl: cfg.docsWsUrl,
    upstreamUrl: cfg.docsUpstreamUrl,
    downstreamUrl: cfg.docsDownstreamUrl,
    docsSiteUrl: cfg.docsSiteUrl,
  };
  const basePath = cfg.docsBasePath;
  // Prefixes our own absolute paths with the basePath (if any).
  // No-op when the site is hosted at a domain root.
  const base = (s: string) => applyBasePath(s, basePath);
  console.log(`[build] site urls: api=${siteUrls.apiUrl}  ws=${siteUrls.wsUrl}`);
  if (basePath) console.log(`[build] base path: ${basePath}`);

  // Clean + create dist/
  if (fs.existsSync(input.outDir)) fs.rmSync(input.outDir, { recursive: true, force: true });
  fs.mkdirSync(input.outDir, { recursive: true });
  fs.mkdirSync(path.join(input.outDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(input.outDir, "reference"), { recursive: true });
  fs.mkdirSync(path.join(input.outDir, "guides"), { recursive: true });

  // 1) Emit OpenAPI spec.
  const rawDocSet = loadDocSet(input.docSetPath);
  const docSet = applySiteConfigDeep(rawDocSet, siteUrls);
  const spec = toOpenApi(docSet, { title: siteTitle, appendPhaseFooter: true });
  const specPath = path.join(input.outDir, "openapi.json");
  fs.writeFileSync(specPath, base(JSON.stringify(spec, null, 2)));
  console.log(`[build] wrote ${specPath} (${Object.keys(spec.paths).length} paths)`);

  // 2) Reference (Scalar) shell.
  const topBarLinks = [
    { label: "Guides", href: "/guides/getting-started.html" },
    { label: "API reference", href: "/reference/" },
  ];
  const referenceHtml = renderReferenceShell({
    title: siteTitle,
    specUrl: "/openapi.json",
    topBarLinks,
  });
  fs.writeFileSync(path.join(input.outDir, "reference", "index.html"), base(referenceHtml));
  console.log(`[build] wrote reference/index.html`);

  // 3) Guide pages. Read and URL-substitute each guide once; reused
  // for the AI context bundle in step 8 without a second fs read.
  const guidesDir = path.join(input.contentDir, "guides");
  const guideMetas = scanGuides(guidesDir);
  const guideMarkdown = new Map<string, string>();
  for (const meta of guideMetas) {
    guideMarkdown.set(
      meta.slug,
      applySiteConfig(fs.readFileSync(path.join(guidesDir, `${meta.slug}.md`), "utf8"), siteUrls),
    );
  }

  // Sidebar also links out to the AGENTS.md primer — it's a guide in
  // spirit even though it lives at /agents.md rather than under /guides/.
  const sidebarMetas: GuideMeta[] = [
    ...guideMetas,
    { slug: "agents", title: "For AI agents (AGENTS.md)", href: "/agents.md" },
  ];

  for (const meta of guideMetas) {
    const html = renderGuidePage({
      siteTitle,
      guide: meta,
      markdown: guideMarkdown.get(meta.slug)!,
      allGuides: sidebarMetas,
      topBarLinks,
    });
    fs.writeFileSync(path.join(input.outDir, "guides", `${meta.slug}.html`), base(html));
    console.log(`[build] wrote guides/${meta.slug}.html`);
  }

  // 4) Landing page. Card titles come from each guide's H1 (via
  // scanGuides) so they can't drift; only the one-line descriptions
  // are owned here.
  const cardDescriptions: Record<string, string> = {
    "getting-started": "Authenticate, store your first blob, retrieve it. Five steps.",
    "profile-management": "Change the password, rotate authorization tokens, fetch profile ids, and pair mobile devices with a QR token.",
    "protocol-overview": "The async-command model, WebSocket acks, encryption layers, and the known quirks.",
    "store-and-retrieve": "End-to-end walkthrough: encrypt, tokenise, and round-trip a blob through the engine.",
    "voting-gated-operations": "Require a real-time vote from registered devices before sensitive operations complete.",
    "websocket-integration": "Concrete wire protocol: connect, join, message types, and an awaiter pattern.",
    "device-management": "The generic device lifecycle: request, approve, specialise, retire. Prerequisite for storage and authenticator devices.",
    "storage-device-management": "Register storage devices so stored blobs have somewhere to land, and manage the fan-out.",
    "data-token-lifecycle": "List, update, classify, and delete tokens after they're stored.",
    "keys-and-public-keys": "Signed-key format, key generation, and fetching the engine's own public key.",
    "oauth-applications": "Delegate scoped access to third-party integrations without sharing profile credentials.",
  };
  const homeHtml = renderHomePage({
    siteTitle,
    tagline,
    topBarLinks,
    heroImage: {
      src: "/images/architecture-overview.png",
      alt: "Privicore at a glance: a client exchanges data for a data token with the engine, which stores ciphertext on storage devices and checks with a voting policy before sensitive operations are allowed.",
    },
    cards: [
      ...guideMetas.map((m) => ({
        title: m.title,
        description: cardDescriptions[m.slug] ?? "",
        href: `/guides/${m.slug}.html`,
      })),
      {
        title: "API reference",
        description: "Per-endpoint documentation with live request / response examples.",
        href: "/reference/",
      },
      {
        title: "For AI agents",
        description: "Drop AGENTS.md into your project and your AI coding tools will know how to integrate with Privicore.",
        href: "/agents.md",
      },
    ],
  });
  fs.writeFileSync(path.join(input.outDir, "index.html"), base(homeHtml));
  console.log(`[build] wrote index.html`);

  // 5) Copy shared CSS.
  const cssSrc = fs.existsSync(DEFAULT_CSS_PATH)
    ? fs.readFileSync(DEFAULT_CSS_PATH, "utf8")
    : FALLBACK_CSS;
  fs.writeFileSync(path.join(input.outDir, "assets", "shell.css"), cssSrc);
  console.log(`[build] wrote assets/shell.css`);

  // 6) Copy public/ verbatim. Everything under public/ is served at the
  // site root (e.g. public/images/foo.png → /images/foo.png).
  if (fs.existsSync("public")) {
    copyRecursive("public", input.outDir);
    console.log(`[build] copied public/ → ${input.outDir}/`);
  }

  // 7) `.nojekyll` so GitHub Pages serves underscore-prefixed paths
  // unprocessed (and, broadly, skips Jekyll entirely). Harmless on
  // any other host.
  fs.writeFileSync(path.join(input.outDir, ".nojekyll"), "");

  // 7b) agents.md — the AGENTS.md / CLAUDE.md primer integrators drop
  // into their projects. Served raw (not rendered as HTML) so AI
  // coding tools and curl both get plain markdown.
  const agentsSrc = path.join(input.contentDir, "agents.md");
  if (fs.existsSync(agentsSrc)) {
    const raw = applySiteConfig(fs.readFileSync(agentsSrc, "utf8"), siteUrls);
    fs.writeFileSync(path.join(input.outDir, "agents.md"), raw);
    console.log(`[build] wrote agents.md`);
  }

  // 8) Bundle the AI-agent context: OpenAPI spec + guide markdown in
  // one JSON blob the in-browser launcher fetches at page load. Keeps
  // the launcher static (no backend) and lets us cache the context
  // on Anthropic's side via prompt-caching on repeated queries.
  const aiContext = {
    siteTitle,
    openapi: spec,
    guides: guideMetas.map((m) => ({
      slug: m.slug,
      title: m.title,
      url: `/guides/${m.slug}.html`,
      markdown: guideMarkdown.get(m.slug)!,
    })),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(input.outDir, "assets", "ai-context.json"), base(JSON.stringify(aiContext)));
  console.log(`[build] wrote assets/ai-context.json (${guideMetas.length} guides + ${Object.keys(spec.paths).length} endpoints)`);

  console.log(`\n[build] done — site at ${input.outDir}/`);
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function loadDocSet(docSetPath: string): DocSet {
  if (!fs.existsSync(docSetPath)) {
    console.warn(`[build] ${docSetPath} not found — using empty placeholder DocSet`);
    return {
      generatedAt: new Date().toISOString(),
      source: { privicoreApiUrl: "http://localhost:8009" },
      endpoints: {},
    };
  }
  return JSON.parse(fs.readFileSync(docSetPath, "utf8")) as DocSet;
}

/**
 * Preferred teaching order for the sidebar. Slugs not listed here are
 * appended at the end in alphabetical order, so dropping a new guide in
 * `content/guides/` still shows up without a code change — you just
 * want to add its slug to this list at the right position if the
 * default placement is wrong.
 */
const GUIDE_ORDER = [
  "getting-started",
  "profile-management",
  "protocol-overview",
  "websocket-integration",
  "keys-and-public-keys",
  "store-and-retrieve",
  "data-token-lifecycle",
  "device-management",
  "storage-device-management",
  "voting-gated-operations",
  "oauth-applications",
];

function scanGuides(guidesDir: string): GuideMeta[] {
  if (!fs.existsSync(guidesDir)) return [];
  const files = fs.readdirSync(guidesDir).filter((f) => f.endsWith(".md"));
  const metas = files.map((f) => {
    const slug = f.replace(/\.md$/, "");
    const title = deriveTitle(path.join(guidesDir, f), slug);
    return { slug, title, sourcePath: path.join(guidesDir, f) };
  });
  return metas.sort((a, b) => {
    const ai = GUIDE_ORDER.indexOf(a.slug);
    const bi = GUIDE_ORDER.indexOf(b.slug);
    if (ai === -1 && bi === -1) return a.slug.localeCompare(b.slug);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function deriveTitle(file: string, fallback: string): string {
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^#\s+(.+)$/m);
  return match ? match[1]!.trim() : fallback;
}

/**
 * Fallback CSS if src/site/shell.css is missing. Intentionally minimal —
 * gives enough structure that the site is navigable, not a finished design.
 * We'll iterate on the real stylesheet once the content is in place.
 */
const FALLBACK_CSS = `
:root {
  --color-bg: #0b0d12;
  --color-panel: #11141b;
  --color-text: #d8deea;
  --color-muted: #8893a6;
  --color-accent: #8bb7ff;
  --color-border: #1e2432;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --color-bg: #fdfdfd;
    --color-panel: #f5f6f8;
    --color-text: #13151c;
    --color-muted: #6a7285;
    --color-accent: #2a5ec4;
    --color-border: #e2e5ec;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-body);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.55;
}
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}
.topbar-brand a {
  color: var(--color-text);
  font-weight: 600;
  font-size: 1.05rem;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.topbar-brand img {
  height: var(--topbar-height);
  width: auto;
  display: block;
}
.topbar-nav { display: flex; gap: 18px; }
.topbar-link { color: var(--color-muted); font-size: 0.95rem; }
.topbar-link:hover { color: var(--color-text); text-decoration: none; }
.home-hero {
  max-width: 880px;
  margin: 80px auto 40px;
  padding: 0 28px;
  text-align: center;
}
.home-hero h1 { font-size: 2.4rem; margin: 0 0 12px; }
.home-tagline { color: var(--color-muted); font-size: 1.1rem; margin-bottom: 48px; }
.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  text-align: left;
}
.home-card {
  display: block;
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
  color: var(--color-text);
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.home-card:hover {
  border-color: var(--color-accent);
  transform: translateY(-1px);
  text-decoration: none;
}
.home-card h3 { margin: 0 0 6px; font-size: 1.1rem; }
.home-card p { margin: 0; color: var(--color-muted); font-size: 0.95rem; }
.guide-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px;
  gap: 36px;
}
.guide-sidebar {
  position: sticky;
  top: 72px;
  align-self: start;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
}
.guide-sidebar h2 { margin: 0 0 12px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); }
.guide-sidebar ul { list-style: none; margin: 0; padding: 0; }
.guide-sidebar li { padding: 6px 0; }
.guide-sidebar li.active a { color: var(--color-text); font-weight: 500; }
.guide-content { max-width: 760px; }
.guide-content pre {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}
.guide-content code {
  font-family: var(--font-mono);
  background: var(--color-panel);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}
.guide-content pre code { background: transparent; padding: 0; }
.guide-content h1, .guide-content h2, .guide-content h3 { scroll-margin-top: 80px; }
.reference-mount { min-height: calc(100vh - 56px); }
`;
