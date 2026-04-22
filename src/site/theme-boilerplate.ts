/**
 * Shared HTML snippets for the site-wide theme toggle. Dropped into
 * every page template so the inline head script can set the correct
 * class before first paint (no FOUC), the topbar has a visible
 * toggle, and theme.js wires up the click handler.
 */

/** Inline <head> script — runs blocking before paint. Sets
 *  `dark-mode` or `light-mode` on <html> based on prior choice or
 *  system preference. */
export const THEME_BOOTSTRAP_SCRIPT = `<script>(function(){try{var s=localStorage.getItem("privicore-docs-theme");var d=s==="dark"||(!s&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.add(d?"dark-mode":"light-mode");}catch(e){document.documentElement.classList.add("light-mode");}})();</script>`;

/** Topbar button markup — drops in next to the other topbar links.
 *  The SVGs are GitHub's moon/sun icons; the active one is swapped
 *  by a CSS rule keyed off the html class. */
export const THEME_TOGGLE_BUTTON = `<button class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode"><svg class="icon-moon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278Z"/></svg><svg class="icon-sun" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0Zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13Zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5ZM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8Zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0Zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0Zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707ZM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708Z"/></svg></button>`;

/** Load the click handler. Defer so it doesn't block render. */
export const THEME_SCRIPT_TAG = `<script src="/assets/theme.js" defer></script>`;
