/**
 * Probe one or more Privicore endpoints against the configured CAB and
 * merge the result into `intermediate/docset.json`, preserving editorial
 * fields (description, summary, gotchas, auth) per the merge rule in
 * `src/ir/merge.ts`.
 *
 * Usage:
 *   npm run probe -- --endpoint profile.authenticate
 *   npm run probe -- --list
 *   npm run probe -- --endpoint <id> --out intermediate/custom.json
 *
 *   # Drift check (CI):
 *   npm run probe -- --all --verify --skip-destructive
 *
 * Environment (see src/config.ts for full list + defaults):
 *   PRIVICORE_API_URL      Privicore CAB base URL
 *   PRIVICORE_WS_URL       WebSocket proxy URL
 *   PRIVICORE_USERNAME     required for authenticated probes
 *   PRIVICORE_PASSWORD     required for authenticated probes
 */

import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";
import { mergeDocSet } from "../ir/merge.ts";
import type { DocSet, EndpointDoc } from "../ir/types.ts";
import { getProbe, listProbes, type ProbeContext } from "../probe/endpoints/index.ts";

interface Args {
  endpoint?: string;
  list: boolean;
  all: boolean;
  verify: boolean;
  skipDestructive: boolean;
  out: string;
  allowDestructive: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    list: false,
    all: false,
    verify: false,
    skipDestructive: false,
    out: "intermediate/docset.json",
    allowDestructive: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--endpoint") out.endpoint = argv[++i];
    else if (a === "--list") out.list = true;
    else if (a === "--all") out.all = true;
    else if (a === "--verify") out.verify = true;
    else if (a === "--skip-destructive") out.skipDestructive = true;
    else if (a === "--out") out.out = argv[++i]!;
    else if (a === "--allow-destructive") out.allowDestructive = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("Registered probes:");
    for (const p of listProbes()) {
      const tag = p.destructive ? " [destructive]" : "";
      console.log(`  ${p.id}${tag}  ${p.summary}`);
    }
    return;
  }

  const cfg = getConfig();
  const ctx: ProbeContext = {
    apiUrl: cfg.privicoreApiUrl,
    wsUrl: cfg.privicoreWsUrl,
    username: cfg.privicoreUsername,
    password: cfg.privicorePassword,
  };
  const existing = loadDocSet(args.out, cfg.privicoreApiUrl);

  if (args.all) {
    await runAll(args, ctx, existing);
    return;
  }

  if (!args.endpoint) {
    console.error("error: --endpoint <id> required (or --list / --all)");
    process.exit(2);
  }
  const probe = getProbe(args.endpoint);
  if (!probe) {
    console.error(`error: no probe registered for "${args.endpoint}"`);
    console.error(`       run "npm run probe -- --list" to see available probes`);
    process.exit(2);
  }
  if (probe.destructive && !args.allowDestructive) {
    console.error(`error: "${args.endpoint}" is marked destructive; re-run with --allow-destructive to confirm.`);
    process.exit(2);
  }

  console.log(`[probe] running ${probe.id} against ${ctx.apiUrl}`);
  const fresh = await probe.run(ctx);
  console.log(`[probe] recorded ${fresh.examples.length} example(s) for ${fresh.method} ${fresh.path}`);

  if (args.verify) {
    const existingEp = existing.endpoints[fresh.id];
    const drift = diffStructural(existingEp, fresh);
    if (drift) {
      console.error(`[probe] DRIFT: ${fresh.id}\n${drift}`);
      process.exit(1);
    }
    console.log(`[probe] no drift for ${fresh.id}`);
    return;
  }

  const incoming: DocSet = {
    generatedAt: new Date().toISOString(),
    source: { privicoreApiUrl: ctx.apiUrl },
    endpoints: { [fresh.id]: fresh },
  };
  const merged = mergeDocSet(existing, incoming);
  reportMerge(existing.endpoints[fresh.id], merged.endpoints[fresh.id]!);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(merged, null, 2) + "\n");
  console.log(`[probe] wrote ${args.out} (${Object.keys(merged.endpoints).length} endpoints)`);
}

async function runAll(args: Args, ctx: ProbeContext, existing: DocSet): Promise<void> {
  const all = listProbes();
  const toRun = all.filter((p) => {
    if (p.destructive && (args.skipDestructive || !args.allowDestructive)) return false;
    return true;
  });
  const skipped = all.length - toRun.length;

  console.log(`[probe] running ${toRun.length} probe(s) against ${ctx.apiUrl}  (skipping ${skipped} destructive)`);

  const drifts: Array<{ id: string; detail: string }> = [];
  const failures: Array<{ id: string; error: string }> = [];
  const fresh: Record<string, EndpointDoc> = {};

  for (const probe of toRun) {
    try {
      const doc = await probe.run(ctx);
      fresh[doc.id] = doc;
      if (args.verify) {
        const drift = diffStructural(existing.endpoints[doc.id], doc);
        if (drift) {
          drifts.push({ id: doc.id, detail: drift });
          console.error(`[probe] DRIFT  ${doc.id}`);
        } else {
          console.log(`[probe] ok     ${doc.id}`);
        }
      } else {
        console.log(`[probe] ran    ${doc.id}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: probe.id, error: msg });
      console.error(`[probe] FAIL   ${probe.id}: ${msg}`);
    }
  }

  if (args.verify) {
    writeDriftSummary(drifts, failures, toRun.length);
    if (drifts.length > 0 || failures.length > 0) process.exit(1);
    console.log(`[probe] no drift across ${toRun.length} probe(s)`);
    return;
  }

  // Write mode: merge all fresh docs at once.
  const incoming: DocSet = {
    generatedAt: new Date().toISOString(),
    source: { privicoreApiUrl: ctx.apiUrl },
    endpoints: fresh,
  };
  const merged = mergeDocSet(existing, incoming);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(merged, null, 2) + "\n");
  console.log(`[probe] wrote ${args.out} (${Object.keys(merged.endpoints).length} endpoints, ${failures.length} failure(s))`);
  if (failures.length > 0) process.exit(1);
}

/**
 * Compare just the structural fields that define the API contract.
 * Editorial prose (summary/description/gotchas), examples, and
 * sourceRun timestamps are expected to drift between runs and don't
 * constitute a contract break.
 */
function diffStructural(existing: EndpointDoc | undefined, incoming: EndpointDoc): string | null {
  if (!existing) return `new endpoint: ${incoming.method} ${incoming.path} (not in committed docset)`;
  const a = normalizeForDrift(existing);
  const b = normalizeForDrift(incoming);
  const aJson = JSON.stringify(a, null, 2);
  const bJson = JSON.stringify(b, null, 2);
  if (aJson === bJson) return null;
  return [
    "  committed:",
    ...aJson.split("\n").map((l) => "    " + l),
    "  probe reported:",
    ...bJson.split("\n").map((l) => "    " + l),
  ].join("\n");
}

function normalizeForDrift(ep: EndpointDoc) {
  return {
    method: ep.method,
    path: ep.path,
    phase: ep.phase,
    parameters: (ep.parameters ?? [])
      .map((p) => ({ in: p.in, name: p.name, required: p.required, type: p.type }))
      .sort((a, b) => (a.in + a.name).localeCompare(b.in + b.name)),
    responses: (ep.responses ?? [])
      .map((r) => ({ status: r.status, schema: r.schema }))
      .sort((a, b) => a.status - b.status),
  };
}

function writeDriftSummary(
  drifts: Array<{ id: string; detail: string }>,
  failures: Array<{ id: string; error: string }>,
  totalRun: number,
): void {
  const lines: string[] = [];
  lines.push(`# Drift check: ${totalRun} probe(s) run`);
  lines.push("");
  if (drifts.length === 0 && failures.length === 0) {
    lines.push("✓ No drift detected. Committed docset matches live server.");
  } else {
    if (drifts.length > 0) {
      lines.push(`## ${drifts.length} endpoint(s) with structural drift`);
      lines.push("");
      for (const d of drifts) {
        lines.push(`### \`${d.id}\``);
        lines.push("```");
        lines.push(d.detail);
        lines.push("```");
        lines.push("");
      }
    }
    if (failures.length > 0) {
      lines.push(`## ${failures.length} probe(s) failed to run`);
      lines.push("");
      for (const f of failures) {
        lines.push(`- \`${f.id}\`: ${f.error}`);
      }
      lines.push("");
    }
    lines.push("Fix by running the relevant probes locally and committing the updated `intermediate/docset.json`:");
    lines.push("```");
    for (const d of drifts) lines.push(`npm run probe -- --endpoint ${d.id}`);
    lines.push("```");
  }

  const summary = lines.join("\n") + "\n";
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try { fs.appendFileSync(summaryPath, summary); } catch { /* ignore */ }
  }
  // Always echo to stdout too, so local runs see the same report.
  console.log("\n" + summary);
}

function loadDocSet(filePath: string, apiUrl: string): DocSet {
  if (!fs.existsSync(filePath)) {
    return {
      generatedAt: new Date().toISOString(),
      source: { privicoreApiUrl: apiUrl },
      endpoints: {},
    };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DocSet;
}

function reportMerge(before: EndpointDoc | undefined, after: EndpointDoc): void {
  if (!before) {
    console.log("[probe] new endpoint record — no existing entry to merge against");
    return;
  }
  const wasStub = before.sourceRun?.tool === "manual";
  if (wasStub) {
    console.log(`[probe] replaced hand-authored stub with probe-recorded wire truth`);
  } else {
    console.log(`[probe] refreshed prior probe recording from ${before.sourceRun?.at ?? "unknown time"}`);
  }
  const editorialFields: Array<keyof EndpointDoc> = ["summary", "description", "auth", "gotchas"];
  for (const f of editorialFields) {
    if (before[f] && !isEmpty(before[f])) {
      console.log(`[probe]   kept editorial "${f}" from existing docset`);
    }
  }
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
