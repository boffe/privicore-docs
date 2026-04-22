/**
 * Thin Apidog OpenAPI client. Every request uses the bearer token from
 * APIDOG_TOKEN. Methods mirror endpoints documented at
 * https://openapi.apidog.io/ — kept as small as possible; structured-data
 * DTOs live in types.ts.
 *
 * Guiding constraints:
 *   - Do not log the token, ever. If you need to log a request, redact it.
 *   - Surface Apidog error responses as thrown Error with status + body.
 *   - Keep the wire shape "dumb" — higher-level logic (e.g. building
 *     endpoint docs from probe output) lives in src/ir.
 *
 * Confirmed endpoints (as of 2026-04-21):
 *   POST /v1/projects/{projectId}/import-openapi
 *   POST /v1/projects/{projectId}/export-openapi
 * There is no public "list projects" endpoint we've been able to find;
 * get the projectId from the URL of your project in the Apidog UI.
 */

import { getConfig } from "../config.ts";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

/** Options accepted by POST /v1/projects/{projectId}/import-openapi. */
export interface ImportOpenApiOptions {
  targetEndpointFolderId?: number;
  targetSchemaFolderId?: number;
  endpointOverwriteBehavior?: "OVERWRITE_EXISTING" | "AUTO_MERGE" | "KEEP_EXISTING" | "CREATE_NEW";
  schemaOverwriteBehavior?: "OVERWRITE_EXISTING" | "AUTO_MERGE" | "KEEP_EXISTING" | "CREATE_NEW";
  updateFolderOfChangedEndpoint?: boolean;
  prependBasePath?: boolean;
  targetBranchId?: number;
  moduleId?: number;
  deleteUnmatchedResources?: boolean;
}

/** Shape of the import-openapi response counters block. */
export interface ImportOpenApiResult {
  data: {
    counters: Record<string, Record<string, number>>;
    errors?: Array<{ message: string; code?: string }>;
  };
}

/** Options accepted by POST /v1/projects/{projectId}/export-openapi. */
export type ExportScope =
  | { type: "ALL"; excludedByTags?: string[] }
  | { type: "SELECTED_ENDPOINTS"; selectedEndpointIds: number[]; excludedByTags?: string[] }
  | { type: "SELECTED_TAGS"; selectedTags: string[]; excludedByTags?: string[] }
  | { type: "SELECTED_FOLDERS"; selectedFolderIds: number[]; excludedByTags?: string[] };

export interface ExportOpenApiRequest {
  scope: ExportScope;
  options?: {
    addFoldersToTags?: boolean;
    includeApidogExtensionProperties?: boolean;
  };
  oasVersion?: "3.0" | "3.1" | "2.0";
  exportFormat?: "JSON" | "YAML";
  environmentIds?: number[];
  branchId?: number;
  moduleId?: number;
}

/** Returned OpenAPI document. Loosely typed — we don't parse it. */
export interface ExportedOpenApiSpec {
  openapi: string;
  info: Record<string, unknown>;
  tags?: Array<Record<string, unknown>>;
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  servers?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export class ApidogClient {
  private readonly base: string;
  private readonly token: string;

  constructor(overrides?: { base?: string; token?: string }) {
    const cfg = getConfig();
    this.base = (overrides?.base ?? cfg.apidogApiBase).replace(/\/$/, "");
    this.token = overrides?.token ?? cfg.apidogToken;
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.base + "/");
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const raw = await res.text();
    let data: unknown;
    try { data = raw.length > 0 ? JSON.parse(raw) : null; } catch { data = raw; }

    if (!res.ok) {
      const summary = typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
      throw new Error(`apidog ${res.status} ${res.statusText} on ${opts.method ?? "GET"} ${path}: ${summary}`);
    }

    // Apidog's public host returns an HTML meta-redirect stub for unknown
    // paths (200 OK masquerading as a real response). Treat that as an
    // error with a clear message so callers don't accidentally trust it.
    if (typeof data === "string" && data.includes("docs.apidog.com") && data.includes("<script>")) {
      throw new Error(`apidog endpoint ${path} returned the docs-redirect stub — path is almost certainly wrong`);
    }

    return data as T;
  }

  /**
   * Export the current OpenAPI spec for a project. Doubles as a credible
   * "is my token + projectId valid?" check — if both are wrong you get a
   * clear 401/404 response.
   */
  async exportOpenApi(projectId: string, req?: Partial<ExportOpenApiRequest>): Promise<ExportedOpenApiSpec> {
    const body: ExportOpenApiRequest = {
      scope: req?.scope ?? { type: "ALL" },
      oasVersion: req?.oasVersion ?? "3.1",
      exportFormat: req?.exportFormat ?? "JSON",
      ...(req?.options ? { options: req.options } : {}),
      ...(req?.environmentIds ? { environmentIds: req.environmentIds } : {}),
      ...(req?.branchId !== undefined ? { branchId: req.branchId } : {}),
      ...(req?.moduleId !== undefined ? { moduleId: req.moduleId } : {}),
    };
    return this.request<ExportedOpenApiSpec>(
      `/v1/projects/${encodeURIComponent(projectId)}/export-openapi`,
      { method: "POST", body },
    );
  }

  /**
   * Import an OpenAPI spec into a project. Accepts either a URL to fetch
   * the spec from, or the spec itself serialized as YAML/JSON text.
   */
  async importOpenApi(
    projectId: string,
    input: string | { url: string; basicAuth?: { username: string; password: string } },
    options?: ImportOpenApiOptions,
  ): Promise<ImportOpenApiResult> {
    const body = {
      input,
      ...(options ? { options } : {}),
    };
    return this.request<ImportOpenApiResult>(
      `/v1/projects/${encodeURIComponent(projectId)}/import-openapi`,
      { method: "POST", body },
    );
  }
}
