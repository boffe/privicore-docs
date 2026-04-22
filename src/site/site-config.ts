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
}

const TOKENS: Array<keyof SiteUrlConfig> = ["apiUrl", "wsUrl", "upstreamUrl", "downstreamUrl"];

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
