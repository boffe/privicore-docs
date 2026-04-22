/**
 * Takes probe output and mints EndpointExample records suitable for merging
 * into the DocSet. Keep this pure — I/O lives in the CLI.
 */

import type { EndpointExample, HttpMethod } from "../ir/types.ts";
import type { ProbeResponse } from "./http.ts";

export interface RecordExampleInput {
  name: string;
  method: HttpMethod;
  path: string;
  requestHeaders?: Record<string, string>;
  requestQuery?: Record<string, string>;
  bodyType?: "form" | "json" | "binary" | "none";
  body?: unknown;
  response: ProbeResponse;
  note?: string;
}

export function recordExample(input: RecordExampleInput): EndpointExample {
  return {
    name: input.name,
    request: {
      method: input.method,
      path: input.path,
      headers: redactHeaders(input.requestHeaders ?? {}),
      query: input.requestQuery,
      bodyType: input.bodyType ?? "none",
      body: input.body,
    },
    response: {
      status: input.response.status,
      headers: input.response.headers,
      body: input.response.body,
    },
    note: input.note,
  };
}

/**
 * Removes sensitive values from request headers before they land in the IR.
 * Adds a placeholder so readers know the field exists in the real call.
 */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "x-dpt-authorization" || lower === "authorization" || lower === "cookie") {
      out[k] = "<redacted>";
    } else {
      out[k] = v;
    }
  }
  return out;
}
