/**
 * Editorial-preserving merge between an existing DocSet (what's on disk)
 * and an incoming DocSet (what the probe just produced).
 *
 * Merge rule:
 *   - Auto-generated fields come from `incoming`: method, path, phase,
 *     parameters, responses, sourceRun.
 *   - Editorial fields come from `existing` when present, else `incoming`:
 *     summary, description, auth, gotchas.
 *   - Examples merge by `name` — incoming overwrites, existing examples
 *     not touched by the probe are kept.
 *   - Endpoints present only in `incoming` are added verbatim.
 *   - Endpoints present only in `existing` are kept untouched.
 *
 * Keep this file pure. I/O (reading docset.json, writing it back) lives
 * in the CLI.
 */

import type { DocSet, EndpointDoc, EndpointExample } from "./types.ts";

export function mergeDocSet(existing: DocSet, incoming: DocSet): DocSet {
  const endpoints: Record<string, EndpointDoc> = { ...existing.endpoints };
  for (const [id, incomingEp] of Object.entries(incoming.endpoints)) {
    const existingEp = existing.endpoints[id];
    endpoints[id] = existingEp
      ? mergeEndpoint(existingEp, incomingEp)
      : incomingEp;
  }

  return {
    generatedAt: incoming.generatedAt,
    source: incoming.source,
    endpoints,
  };
}

export function mergeEndpoint(existing: EndpointDoc, incoming: EndpointDoc): EndpointDoc {
  // `summary` is required on EndpointDoc, so narrow the editorial
  // preference down to a guaranteed string via the incoming fallback.
  const summary = preferEditorial(existing.summary, incoming.summary) ?? incoming.summary;

  return {
    // Identity — must match.
    id: existing.id,

    // Editorial — existing wins if set.
    summary,
    description: preferEditorial(existing.description, incoming.description),
    auth: preferEditorial(existing.auth, incoming.auth),
    gotchas: preferEditorial(existing.gotchas, incoming.gotchas),

    // Auto — incoming wins.
    method: incoming.method,
    path: incoming.path,
    phase: incoming.phase,
    parameters: incoming.parameters,
    responses: incoming.responses,
    sourceRun: incoming.sourceRun,

    // Examples — merge by name, incoming overwrites.
    examples: mergeExamples(existing.examples, incoming.examples),
  };
}

function preferEditorial<T>(editorial: T | undefined, incoming: T | undefined): T | undefined {
  // Treat empty string / empty array / hand-authored-stub values as "not
  // meaningfully set," so the first real probe can fill them in. Anything
  // else from `existing` is preserved.
  if (editorial === undefined || editorial === null) return incoming;
  if (typeof editorial === "string" && editorial.trim().length === 0) return incoming;
  if (Array.isArray(editorial) && editorial.length === 0) return incoming;
  return editorial;
}

function mergeExamples(existing: EndpointExample[], incoming: EndpointExample[]): EndpointExample[] {
  const byName = new Map<string, EndpointExample>();
  for (const ex of existing) byName.set(ex.name, ex);
  for (const ex of incoming) byName.set(ex.name, ex); // incoming wins
  return Array.from(byName.values());
}
