/**
 * Intermediate representation of a documented API endpoint. Probes write
 * this; uploaders read it. Editorial layers (hand-written prose, gotchas,
 * examples) attach via optional fields so they're not lost on re-probe.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type ResponsePhase = "sync" | "async-command" | "async-request" | "streaming";

export interface EndpointExample {
  /** Short label shown to the reader, e.g. "authenticate happy path". */
  name: string;
  /** Original request as it would be issued on the wire. */
  request: {
    method: HttpMethod;
    path: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    bodyType?: "form" | "json" | "binary" | "none";
    body?: unknown;
  };
  /** Response the server actually sent during the probe. */
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /** If the operation is async, the WS ack that resolved it. */
  asyncAck?: {
    type: string; // e.g. "X-DPT-CAB-ID" or "X-DPT-CAB-REQUEST-ID"
    commandStatus: number;
    body?: unknown;
  };
  /** Freeform notes attached to this example — e.g. "gateway returned 502 on first try". */
  note?: string;
}

export interface EndpointDoc {
  /** Canonical identifier, e.g. "data-token.reserve-token-space". Used as
   * the stable key for merging editorial content across re-probes. */
  id: string;
  summary: string;
  /** Longer prose. Editorial only — not auto-generated. */
  description?: string;
  method: HttpMethod;
  path: string;
  phase: ResponsePhase;
  /** Which scope/role/token type is required — authorizationToken, public, oauth, etc. */
  auth?: "authorization-token" | "oauth" | "public" | "device-token";
  /** Known request parameters (URL, query, header, form). */
  parameters?: Array<{
    in: "path" | "query" | "header" | "form" | "json";
    name: string;
    required: boolean;
    type: string;
    description?: string;
    example?: unknown;
  }>;
  /** Documented response shapes (happy path first, then failure cases). */
  responses?: Array<{
    status: number;
    description?: string;
    schema?: unknown;
  }>;
  /** Recorded examples from the live probe. */
  examples: EndpointExample[];
  /** Hand-written warnings / gotchas that re-probes should preserve. */
  gotchas?: string[];
  /** Source: which probe or review added this record, and when. */
  sourceRun?: {
    tool: "probe" | "manual";
    at: string; // ISO timestamp
    revision?: string; // e.g. a server commit id
  };
}

/** Container for all known endpoints, keyed by id. */
export interface DocSet {
  generatedAt: string;
  source: {
    privicoreApiUrl: string;
    privicoreCommit?: string;
  };
  endpoints: Record<string, EndpointDoc>;
}
