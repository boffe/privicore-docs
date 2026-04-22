/**
 * Theme toggle — flips the `dark-mode` / `light-mode` class on <html>
 * and persists the choice in localStorage. The class also drives
 * Scalar's reference page (it has its own `.dark-mode` / `.light-mode`
 * CSS selectors), so one toggle controls the whole site.
 *
 * The initial class-setting runs as an inline <head> script in each
 * page's HTML to avoid a flash of the wrong theme. This file only
 * handles the click handler on the topbar toggle button.
 */

const STORAGE_KEY = "privicore-docs-theme";

function currentTheme() {
  return document.documentElement.classList.contains("dark-mode") ? "dark" : "light";
}

function applyTheme(theme) {
  const html = document.documentElement;
  html.classList.remove("dark-mode", "light-mode");
  html.classList.add(theme === "dark" ? "dark-mode" : "light-mode");
  syncScalar();
}

/**
 * Scalar manages its own `.light-mode` / `.dark-mode` class on its
 * root container, independent of our html class. The sidebar inherits
 * our class via CSS variables, but the main content keys off Scalar's
 * own class — so a toggle that only touches `<html>` leaves the main
 * content stuck on Scalar's initial theme.
 *
 * Fix: sweep the DOM for any element carrying the opposite theme
 * class and flip it. Lightweight and generic — works regardless of
 * what Scalar names its root container.
 */
function syncScalar() {
  const isDark = document.documentElement.classList.contains("dark-mode");
  const desired = isDark ? "dark-mode" : "light-mode";
  const stale = isDark ? "light-mode" : "dark-mode";
  for (const el of document.querySelectorAll("." + stale)) {
    if (el === document.documentElement) continue;
    el.classList.remove(stale);
    el.classList.add(desired);
  }
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
}

function wire() {
  for (const btn of document.querySelectorAll(".theme-toggle")) {
    btn.addEventListener("click", toggleTheme);
  }
  // Scalar renders async. MutationObserver catches its late-added
  // containers and any internal state re-assertions. Once Scalar has
  // settled (typically <1s), keeping the observer running is just
  // dead weight — disconnect it after a short window.
  const observer = new MutationObserver(syncScalar);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  setTimeout(() => observer.disconnect(), 5000);
  // Also sync immediately — catches anything Scalar rendered before
  // theme.js loaded.
  syncScalar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
