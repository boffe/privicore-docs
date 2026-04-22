/**
 * Build-time substitution for site URLs. Guide markdown and DocSet
 * descriptions reference `{{apiUrl}}`, `{{wsUrl}}`, `{{upstreamUrl}}`,
 * and `{{downstreamUrl}}` as placeholders; this module swaps them for
 * whatever the current environment configures.
 *
 * Defaults (see `src/config.ts`) are `cab.example.com` placeholders,
 * which keeps local preview builds working without any env setup.
 * Production deploys set `DOCS_API_URL` etc. in `.env` or in the CI
 * build environment.
 */

export interface SiteUrlConfig {
  apiUrl: string;
  wsUrl: string;
  upstreamUrl: string;
  downstreamUrl: string;
  docsSiteUrl: string;
}

const TOKENS: Array<keyof SiteUrlConfig> = ["apiUrl", "wsUrl", "upstreamUrl", "downstreamUrl", "docsSiteUrl"];

/** Replace `{{apiUrl}}` / `{{wsUrl}}` / `{{upstreamUrl}}` / `{{downstreamUrl}}`
 *  in the given string with the configured values. */
export function applySiteConfig(text: string, cfg: SiteUrlConfig): string {
  let out = text;
  for (const key of TOKENS) {
    out = out.replaceAll(`{{${key}}}`, cfg[key]);
  }
  return out;
}

/** Recursively apply `applySiteConfig` to every string value in a
 *  JSON-y structure. Used to template the DocSet before it reaches
 *  the OpenAPI converter. */
export function applySiteConfigDeep<T>(value: T, cfg: SiteUrlConfig): T {
  if (typeof value === "string") return applySiteConfig(value, cfg) as T;
  if (Array.isArray(value)) return value.map((v) => applySiteConfigDeep(v, cfg)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = applySiteConfigDeep(v, cfg);
    }
    return out as T;
  }
  return value;
}

/**
 * Rewrite absolute site paths to include a base path. Used when the
 * site is hosted at a sub-path (e.g. boffe.github.io/privicore-docs/)
 * rather than a domain root. Targets only our own path prefixes —
 * leaves external URLs and arbitrary absolute paths in prose alone.
 *
 * Matches occurrences of `/guides/`, `/reference/`, `/assets/`,
 * `/images/`, `/openapi.json` that appear after a context character
 * (quote, paren, `=`, whitespace) so we don't accidentally rewrite
 * the middle of a longer URL or a regex pattern.
 */
const SITE_PATH_PREFIXES = [
  "/guides/",
  "/reference/",
  "/assets/",
  "/images/",
  "/openapi.json",
];
export function applyBasePath(content: string, basePath: string): string {
  if (!basePath) return content;
  let out = content;
  for (const root of SITE_PATH_PREFIXES) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Contextual boundary: quote, paren, equals, whitespace, or parenthesis.
    const re = new RegExp(`(["'(\\s=])${escaped}`, "g");
    out = out.replace(re, `$1${basePath}${root}`);
  }
  // Site-root link (topbar brand, "back to home"): exact `href="/"`.
  out = out.replaceAll('href="/"', `href="${basePath}/"`);
  out = out.replaceAll("href='/'", `href='${basePath}/'`);
  return out;
}
