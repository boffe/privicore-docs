/**
 * Convert our IR DocSet into an OpenAPI 3.1 document. Scalar (and any
 * other standards-compliant renderer) consumes this directly.
 *
 * Design notes:
 *   - Keep the conversion pure: (DocSet) => OpenApiDocument. No I/O here.
 *   - Preserve editorial prose (description, gotchas) as OpenAPI
 *     `description` + vendor extensions (x-privicore-gotchas). Scalar will
 *     render the description Markdown; the vendor extension is for our own
 *     diffing tools.
 *   - Each EndpointExample becomes a request `example` on the matching
 *     parameter and a response `example` on the matching status.
 *   - Async-command endpoints get an appended note on the description so
 *     readers understand the WS-ack semantics without having to chase a
 *     cross-reference. (The full protocol explanation lives in the
 *     editorial guide page.)
 */

import type { DocSet, EndpointDoc, EndpointExample } from "./types.ts";

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
}

/**
 * Pretty display names for the machine slugs used as endpoint tags.
 * Scalar slugifies the display name to build anchor URLs, so each
 * pretty name is chosen so it slugifies back to the existing slug —
 * preserving cross-links from guides (e.g. `#tag/data-token/...`).
 */
const TAG_DISPLAY: Record<string, { name: string; description: string }> = {
  "profile": { name: "Profile", description: "Create, authenticate, and manage a profile identity." },
  "public-key": { name: "Public Key", description: "Register and retrieve signed Curve25519 public keys." },
  "data-token": { name: "Data Token", description: "Tokenise, retrieve, and manage encrypted payloads." },
  "device": { name: "Device", description: "Request, approve, configure, and retire devices." },
  "storage": { name: "Storage", description: "Promote approved devices into the storage fan-out." },
  "verified-authenticator": { name: "Verified Authenticator", description: "Authenticator devices and voting configurations." },
  "policy": { name: "Policy", description: "Register and activate voting-gated operation policies." },
  "voting": { name: "Voting", description: "Inspect and control live voting pools." },
  "oauth": { name: "OAuth", description: "Register applications and issue scoped access tokens." },
  "utility": { name: "Utility", description: "Health checks and command-status polling." },
};

interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    in: "path" | "query" | "header";
    name: string;
    required: boolean;
    description?: string;
    schema?: { type: string };
    example?: unknown;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema?: unknown; examples?: Record<string, { summary?: string; value: unknown }> }>;
  };
  responses: Record<string, {
    description?: string;
    content?: Record<string, { schema?: unknown; examples?: Record<string, { summary?: string; value: unknown }> }>;
  }>;
  security?: Array<Record<string, string[]>>;
  ["x-privicore-gotchas"]?: string[];
  ["x-privicore-phase"]?: string;
}

export interface ToOpenApiOptions {
  title?: string;
  version?: string;
  /** Override/append to each endpoint's description. If set, phase + gotchas
   * footers are appended automatically to the per-endpoint description so
   * readers see the WS-ack semantics inline. */
  appendPhaseFooter?: boolean;
}

const DEFAULT_SERVER: OpenApiDocument["servers"] = [
  { url: "https://api.example.com", description: "Production (placeholder — override in config)" },
];

export function toOpenApi(docSet: DocSet, opts: ToOpenApiOptions = {}): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};

  for (const [id, ep] of Object.entries(docSet.endpoints)) {
    const pathKey = normalisePath(ep.path);
    const methodKey = ep.method.toLowerCase();
    const entry = paths[pathKey] ?? (paths[pathKey] = {});
    entry[methodKey] = buildOperation(id, ep, opts);
  }

  // Emit the tags this spec actually uses, in a stable order that
  // matches TAG_DISPLAY. Unknown slugs fall through unchanged.
  const usedTagSlugs = new Set<string>();
  for (const ep of Object.values(docSet.endpoints)) {
    const slug = ep.id.split(".")[0];
    if (slug) usedTagSlugs.add(slug);
  }
  const tags = Object.entries(TAG_DISPLAY)
    .filter(([slug]) => usedTagSlugs.has(slug))
    .map(([, v]) => v);
  for (const slug of usedTagSlugs) {
    if (!(slug in TAG_DISPLAY)) tags.push({ name: slug, description: "" });
  }

  const doc: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: opts.title ?? "Privicore API",
      version: opts.version ?? "unversioned",
      description:
        "Reference documentation generated from the live Privicore instance " +
        "via the `privicore-doc-writer` probe. Editorial prose is hand-authored " +
        "and merged per re-probe.",
    },
    servers: [
      { url: docSet.source.privicoreApiUrl, description: "Reference instance this doc set was probed against" },
      ...DEFAULT_SERVER,
    ],
    tags,
    paths,
  };

  return doc;
}

function normalisePath(path: string): string {
  // Trim trailing slashes except for root, ensure leading slash.
  if (!path.startsWith("/")) path = "/" + path;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function buildOperation(id: string, ep: EndpointDoc, opts: ToOpenApiOptions): OpenApiOperation {
  const description = composeDescription(ep, opts);
  const parameters = (ep.parameters ?? [])
    .filter((p) => p.in === "path" || p.in === "query" || p.in === "header")
    .map((p) => ({
      in: p.in as "path" | "query" | "header",
      name: p.name,
      required: p.required,
      description: p.description,
      schema: { type: p.type || "string" },
      example: p.example,
    }));

  const op: OpenApiOperation = {
    operationId: id,
    summary: ep.summary,
    description,
    tags: deriveTags(ep),
    parameters: parameters.length > 0 ? parameters : undefined,
    responses: buildResponses(ep),
  };

  const requestBody = buildRequestBody(ep);
  if (requestBody) op.requestBody = requestBody;

  if (ep.auth && ep.auth !== "public") {
    op.security = [{ [ep.auth]: [] }];
  }

  if (ep.gotchas && ep.gotchas.length > 0) {
    op["x-privicore-gotchas"] = ep.gotchas;
  }
  if (ep.phase) {
    op["x-privicore-phase"] = ep.phase;
  }

  return op;
}

function composeDescription(ep: EndpointDoc, opts: ToOpenApiOptions): string {
  const parts: string[] = [];
  if (ep.description) parts.push(ep.description);

  if (opts.appendPhaseFooter && ep.phase === "async-command") {
    parts.push(
      "\n\n> **Async command.** This endpoint returns HTTP 202 plus a command id. " +
        "The actual success/failure lives on the WebSocket at " +
        "`wss://.../8083` as a message with type `X-DPT-CAB-ID` matching " +
        "the returned id. See the _Async command model_ guide for the full " +
        "sequence.",
    );
  }
  if (opts.appendPhaseFooter && ep.phase === "async-request") {
    parts.push(
      "\n\n> **Async request.** Read path — the response arrives on the " +
        "WebSocket as `X-DPT-CAB-REQUEST-ID`. See _Async command model_.",
    );
  }
  if (opts.appendPhaseFooter && ep.gotchas && ep.gotchas.length > 0) {
    parts.push("\n\n**Gotchas**\n" + ep.gotchas.map((g) => `- ${g}`).join("\n"));
  }

  return parts.join("");
}

function deriveTags(ep: EndpointDoc): string[] | undefined {
  // By convention IR ids are dotted, e.g. "data-token.reserve-token-space".
  // First dotted segment = slug; we map to the pretty display name so
  // Scalar's sidebar matches the slugify-back anchor shape.
  const first = ep.id.split(".")[0];
  if (!first) return undefined;
  return [TAG_DISPLAY[first]?.name ?? first];
}

function buildRequestBody(ep: EndpointDoc): OpenApiOperation["requestBody"] | undefined {
  const formParams = (ep.parameters ?? []).filter((p) => p.in === "form");
  const jsonParams = (ep.parameters ?? []).filter((p) => p.in === "json");

  // Prefer JSON if both are declared (rare).
  if (jsonParams.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of jsonParams) {
      properties[p.name] = { type: p.type || "string", description: p.description, example: p.example };
      if (p.required) required.push(p.name);
    }
    return {
      required: required.length > 0,
      content: {
        "application/json": {
          schema: { type: "object", properties, required: required.length ? required : undefined },
          examples: exampleMap(ep, "json"),
        },
      },
    };
  }

  if (formParams.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of formParams) {
      properties[p.name] = { type: p.type || "string", description: p.description, example: p.example };
      if (p.required) required.push(p.name);
    }
    return {
      required: required.length > 0,
      content: {
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties, required: required.length ? required : undefined },
          examples: exampleMap(ep, "form"),
        },
      },
    };
  }

  return undefined;
}

function exampleMap(ep: EndpointDoc, expected: "json" | "form"): Record<string, { summary?: string; value: unknown }> | undefined {
  const out: Record<string, { summary?: string; value: unknown }> = {};
  for (const ex of ep.examples) {
    if (ex.request.bodyType !== expected) continue;
    out[slug(ex.name)] = { summary: ex.name, value: ex.request.body };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildResponses(ep: EndpointDoc): OpenApiOperation["responses"] {
  const out: OpenApiOperation["responses"] = {};
  if (ep.responses && ep.responses.length > 0) {
    for (const r of ep.responses) {
      out[String(r.status)] = {
        description: r.description,
        content: r.schema ? { "application/json": { schema: r.schema } } : undefined,
      };
    }
  }

  // Enrich with recorded examples from the live probe.
  for (const ex of ep.examples) {
    const status = String(ex.response.status);
    const slot = out[status] ?? (out[status] = { description: ex.response.status >= 400 ? "Error" : "Success" });
    slot.content = slot.content ?? { "application/json": {} };
    const jsonSlot = slot.content["application/json"] ?? (slot.content["application/json"] = {});
    jsonSlot.examples = jsonSlot.examples ?? {};
    jsonSlot.examples[slug(ex.name)] = { summary: ex.name, value: ex.response.body };
  }

  if (Object.keys(out).length === 0) {
    out["default"] = { description: "Undocumented response — probe has not run against this endpoint yet." };
  }

  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "example";
}

// Helper exposed for tests; not used by the builder itself.
export function examplesForStatus(ep: EndpointDoc, status: number): EndpointExample[] {
  return ep.examples.filter((e) => e.response.status === status);
}
