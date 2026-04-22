# Privicore Doc Writer

## What this is

A Node/TypeScript tool that probes a reachable Privicore CAB instance
and generates a static API documentation site. The reference pages
are rendered by Scalar (open-source, Apidog-style three-column
layout); editorial guide pages are hand-authored markdown rendered
with the same chrome. Output is a fully static `dist/` — no backend,
no runtime dependency beyond a static host and Scalar's CDN.

The probe deliberately exercises only happy paths + documented
failure modes. This project is NOT a pentest tool.

## Design principles

1. **The live server is the source of truth**, not any document.
   Every field name, status code, header, and async-ack shape is
   recorded from the wire via the probe.
2. **Editorial prose lives in git, not in a UI.** Hand-written pages
   are `content/guides/*.md`; per-endpoint editorial fields live in
   `intermediate/docset.json` alongside auto-generated fields. The
   merge helper (`src/ir/merge.ts`) preserves editorial content on
   re-probe.
3. **Renderer is swappable.** Scalar is our first choice for the
   reference layout, but the IR → OpenAPI pipeline is vendor-agnostic.
   If we later want a custom-built reference component, we swap the
   shell in `src/site/render-reference.ts` without touching probe
   or IR code.
4. **Keep the CLI dumb.** Three commands (`probe`, `build`, `preview`).
   Composition through the intermediate JSON files, not clever code
   paths.
5. **Partner-facing only.** Public docs cover HTTP-API integration
   against Privicore's reference devices. Internal mechanics
   (RabbitMQ routing, device wire protocol, policy internals) are
   deliberately not documented here.

## Layout

See `README.md` for the tree and per-file purpose.

## External dependencies

- **Reachable Privicore stack.** The probe connects to whatever
  `PRIVICORE_API_URL` + `PRIVICORE_WS_URL` point at (local dev or a
  shared sandbox).
- **Scalar API Reference** — embedded via CDN script in
  `src/site/render-reference.ts`. The CDN URL is pinned to `@1`;
  major-version bumps happen here.
- **marked** — the markdown → HTML renderer for guide pages. Kept
  minimal; swap to `markdown-it` without touching call sites if we
  outgrow it.

The `src/apidog/` module is **dormant**. It was scaffolded for a
possible Apidog export-based IR seeding flow, but we decided to own
the full pipeline. Retained in case we ever want to pull legacy
content forward. Not loaded by the build path.

## Secrets

`.env` holds probe credentials. It is gitignored. See `.env.example`
for the full set of variables the app reads.

## Common tasks

### Build the site

```
npm run build
```

Reads `intermediate/docset.json` (placeholder empty spec if missing)
plus `content/guides/*.md`, writes `dist/`.

### Preview the site

```
npm run preview
```

Serves `dist/` on `http://localhost:4173/`.

### Probe an endpoint

```
npm run probe -- --endpoint profile.authenticate
npm run probe -- --list
npm run probe -- --all --verify --skip-destructive
```

Exercises endpoints against the configured Privicore instance,
merging results into `intermediate/docset.json` and preserving
editorial fields. `--verify` runs the probes without writing and
exits non-zero on drift — used by the CI drift-check workflow.

## Gotchas for this project

- **Scalar's CDN URL is pinned in `render-reference.ts`.** If Scalar
  ships a breaking change, builds may render differently. For a
  reproducible production build, mirror the CDN asset into
  `public/assets/` and point `scalarCdnUrl` at the local copy.
- **`build.ts` inlines a fallback CSS** that mirrors `shell.css` so
  the site is usable even if the CSS file is deleted. If you change
  layout classes, update both.
- **The probe creates real profiles + storage devices** on whatever
  Privicore instance it's pointed at. Point it at a dev / sandbox
  instance, not a production vault. Each endpoint probe is
  responsible for its own cleanup where it mutates state.
- **Windows line endings.** If someone adds a shell script, make sure
  it's LF.
