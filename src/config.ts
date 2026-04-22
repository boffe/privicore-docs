/**
 * Loads environment config and fails fast on missing required values.
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

export interface Config {
  /** Apidog integration is dormant — see CLAUDE.md. Retained so the
   *  dormant `src/apidog/` module still compiles. Not required to
   *  build the site or run probes. */
  apidogToken: string;
  apidogApiBase: string;
  apidogProjectId: string | null;

  /** Where the probe talks to — typically local CAB during dev
   *  (http://localhost:8009). Not the URL shown in rendered docs. */
  privicoreApiUrl: string;
  privicoreWsUrl: string;
  privicoreUsername: string;
  privicorePassword: string;

  /** URLs displayed in the rendered documentation site. Distinct from
   *  the probe URLs — probes may talk to localhost while published
   *  docs point at a public sandbox. Substituted into markdown and
   *  DocSet descriptions as `{{apiUrl}}`, `{{wsUrl}}`, etc. */
  docsApiUrl: string;
  docsWsUrl: string;
  docsUpstreamUrl: string;
  docsDownstreamUrl: string;

}

function optional(key: string): string | null {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function getConfig(): Config {
  return {
    apidogToken: optional("APIDOG_TOKEN") ?? "",
    apidogApiBase: optional("APIDOG_API_BASE") ?? "https://api.apidog.com",
    apidogProjectId: optional("APIDOG_PROJECT_ID"),
    privicoreApiUrl: optional("PRIVICORE_API_URL") ?? "http://localhost:8009",
    privicoreWsUrl: optional("PRIVICORE_WS_URL") ?? "ws://localhost:8083",
    privicoreUsername: optional("PRIVICORE_USERNAME") ?? "",
    privicorePassword: optional("PRIVICORE_PASSWORD") ?? "",
    docsApiUrl: optional("DOCS_API_URL") ?? "https://cab.example.com",
    docsWsUrl: optional("DOCS_WS_URL") ?? "wss://cab.example.com:8083",
    docsUpstreamUrl: optional("DOCS_UPSTREAM_URL") ?? "https://upstream.example.com:8010",
    docsDownstreamUrl: optional("DOCS_DOWNSTREAM_URL") ?? "https://downstream.example.com:8011",
  };
}

/**
 * Returns a redacted view of the config safe to print in logs. The token is
 * reduced to `<prefix>…<suffix>` so operators can still tell which token is
 * in use without exposing the secret value in its entirety.
 */
export function redactedConfig(cfg: Config): Record<string, string> {
  const tok = cfg.apidogToken;
  const short = tok.length > 12 ? `${tok.slice(0, 6)}…${tok.slice(-4)}` : "***";
  return {
    apidogToken: short,
    apidogApiBase: cfg.apidogApiBase,
    apidogProjectId: cfg.apidogProjectId ?? "(not set)",
    privicoreApiUrl: cfg.privicoreApiUrl,
    privicoreWsUrl: cfg.privicoreWsUrl,
    privicoreUsername: cfg.privicoreUsername || "(not set)",
  };
}
