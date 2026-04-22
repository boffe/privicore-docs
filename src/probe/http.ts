/**
 * Tiny HTTP helper for the probe path. Matches the shape of the pentest
 * repo's http helpers so porting probes between the two is frictionless.
 *
 * Deliberately kept minimal — the probe runner owns orchestration and
 * recording; this layer only speaks HTTP.
 */

import { getConfig } from "../config.ts";

function baseUrl(): string {
  return getConfig().privicoreApiUrl.replace(/\/$/, "");
}

export interface ProbeResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
}

export async function probeGet(path: string, token?: string, query?: Record<string, string>): Promise<ProbeResponse> {
  const url = new URL(path, baseUrl() + "/");
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (token) headers["X-DPT-AUTHORIZATION"] = token;
  const res = await fetch(url, { method: "GET", headers });
  return toProbeResponse(res);
}

export async function probePostForm(
  path: string,
  form: Record<string, string>,
  token?: string,
): Promise<ProbeResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (token) headers["X-DPT-AUTHORIZATION"] = token;
  const body = new URLSearchParams(form).toString();
  const res = await fetch(new URL(path, baseUrl() + "/"), { method: "POST", headers, body });
  return toProbeResponse(res);
}

export async function probePostJson(path: string, json: unknown, token?: string): Promise<ProbeResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-DPT-AUTHORIZATION"] = token;
  const res = await fetch(new URL(path, baseUrl() + "/"), { method: "POST", headers, body: JSON.stringify(json) });
  return toProbeResponse(res);
}

/**
 * POST with HTTP Basic authentication. Used for the OAuth token
 * endpoints that authenticate the *application* (not a profile) via
 * `Authorization: Basic base64(clientId:clientSecret)`.
 */
export async function probePostFormBasic(
  path: string,
  form: Record<string, string>,
  clientId: string,
  clientSecret: string,
): Promise<ProbeResponse> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Authorization": `Basic ${basic}`,
  };
  const body = new URLSearchParams(form).toString();
  const res = await fetch(new URL(path, baseUrl() + "/"), { method: "POST", headers, body });
  return toProbeResponse(res);
}

async function toProbeResponse(res: Response): Promise<ProbeResponse> {
  const rawBody = await res.text();
  let body: unknown = rawBody;
  try { body = rawBody.length > 0 ? JSON.parse(rawBody) : null; } catch { /* keep as string */ }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body, rawBody };
}
