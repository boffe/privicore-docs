/**
 * Landing page. Renders a hero (title, tagline, optional architecture
 * image) above a card grid of guide / reference links. The card list is
 * supplied by the caller so each card's copy stays source-controlled
 * near the rest of the build config.
 */

import { THEME_BOOTSTRAP_SCRIPT, THEME_TOGGLE_BUTTON, THEME_SCRIPT_TAG } from "./theme-boilerplate.ts";

export interface HomePageInput {
  siteTitle: string;
  tagline: string;
  topBarLinks?: Array<{ label: string; href: string }>;
  /** Primary CTAs shown as large cards on the home page. */
  cards: Array<{ title: string; description: string; href: string }>;
  /** Optional hero image shown above the cards (e.g. architecture diagram). */
  heroImage?: { src: string; alt: string };
}

export function renderHomePage(input: HomePageInput): string {
  const topBar = (input.topBarLinks ?? []).map((l) =>
    `<a href="${escapeHtml(l.href)}" class="topbar-link">${escapeHtml(l.label)}</a>`,
  ).join("\n      ");
  const cards = input.cards.map((c) => `
      <a class="home-card" href="${escapeHtml(c.href)}">
        <h3>${escapeHtml(c.title)}</h3>
        <p>${escapeHtml(c.description)}</p>
      </a>`).join("");
  const hero = input.heroImage
    ? `\n    <img class="home-hero-image" src="${escapeHtml(input.heroImage.src)}" alt="${escapeHtml(input.heroImage.alt)}">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.siteTitle)}</title>
  ${THEME_BOOTSTRAP_SCRIPT}
  <link rel="stylesheet" href="/assets/shell.css">
  <link rel="stylesheet" href="/assets/ai-agent/styles.css">
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand"><a href="/">${escapeHtml(input.siteTitle)}</a></div>
    <nav class="topbar-nav">
      ${topBar}
      ${THEME_TOGGLE_BUTTON}
    </nav>
  </header>
  <section class="home-hero">
    <h1>${escapeHtml(input.siteTitle)}</h1>
    <p class="home-tagline">${escapeHtml(input.tagline)}</p>${hero}
    <div class="home-cards">${cards}
    </div>
  </section>
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
