# Privicore Doc Writer

Generates the Privicore API documentation site from a live reference
instance plus a curated editorial layer. Renders a three-column API
reference via [Scalar](https://scalar.com) and a set of editorial
guide pages styled to match. Output is a static `dist/` that deploys
to any host.

## Why this exists

Documentation that lives apart from the server drifts. This project
owns the whole pipeline so drift is caught in CI: probe the live
server → IR → OpenAPI spec → static site, with the repo as the source
of truth.

## Architecture (one paragraph)

Two inputs: a **reachable Privicore CAB instance** (the probe
exercises endpoints against it and records the real wire shape) and
an **editorial layer of hand-written markdown** (`content/guides/*.md`).
The probe normalises its output into an intermediate representation
(`intermediate/docset.json`), which the site builder converts to an
OpenAPI 3.1 spec and hands to Scalar for rendering. Editorial guides
are rendered as separate pages with the same chrome. Nothing dynamic
at runtime — everything is static HTML plus the Scalar CDN script.

## Layout

```
privicore-doc-writer/
├── src/
│   ├── config.ts               # env loader
│   ├── probe/
│   │   ├── http.ts             # HTTP helpers
│   │   ├── ws.ts               # WebSocket awaiter for async-command acks
│   │   ├── auth.ts             # authenticate / session bootstrap
│   │   ├── crypto.ts           # signed Curve25519 key generation
│   │   ├── fixtures.ts         # reusable prerequisite-state helpers
│   │   ├── recorder.ts         # probe result → EndpointExample
│   │   └── endpoints/          # one probe module per documented endpoint
│   ├── ir/
│   │   ├── types.ts            # EndpointDoc / DocSet shapes
│   │   ├── merge.ts            # editorial-preserving merge
│   │   └── to-openapi.ts       # IR → OpenAPI 3.1
│   ├── site/
│   │   ├── build.ts            # orchestrates dist/ generation
│   │   ├── render-home.ts      # landing page template
│   │   ├── render-reference.ts # Scalar reference-shell template
│   │   ├── render-guide.ts     # editorial page template (+ admonition parser)
│   │   ├── site-config.ts      # build-time URL substitution
│   │   ├── theme-boilerplate.ts # shared <head> + toggle markup
│   │   └── shell.css           # shared stylesheet (dark mode aware)
│   └── cli/
│       ├── probe.ts            # probe runner with --endpoint / --all / --verify
│       ├── build.ts            # generate dist/ from IR + content/
│       └── preview.ts          # local static server for dist/
├── content/
│   └── guides/                 # hand-written editorial markdown
├── public/
│   ├── assets/theme.js         # dark-mode toggle (sets class on <html>)
│   └── assets/ai-agent/        # BYOK Anthropic chat panel
├── intermediate/
│   └── docset.json             # committed source of truth (probe-refreshable)
├── dist/                       # generated site (gitignored)
├── .env / .env.example         # config
└── .github/workflows/
    ├── deploy.yml              # build + publish to GitHub Pages on main
    └── drift-check.yml         # probe vs committed IR on every PR
```

## Quickstart

```bash
# 1. Install deps
npm install

# 2. Copy .env.example → .env and fill in values.
cp .env.example .env

# 3. Build the site.
npm run build

# 4. Preview locally
npm run preview
# → http://localhost:4173/
```

## What's here

- Landing, 11 editorial guide pages, and an API reference with 46
  endpoints across 10 tag groups.
- Probe infrastructure: 46 per-endpoint modules, WebSocket ack
  handling, editorial-preserving merge on re-probe.
- Deploy workflow (GitHub Pages) and drift-check workflow (fails PRs
  when the IR and live server disagree).
- Dark-mode toggle that drives both the guide chrome and the Scalar
  reference from a single class on `<html>`.
- A bring-your-own-key AI chat panel — visitor pastes their Anthropic
  key; we call the Messages API directly with the full spec + guides
  as a prompt-cached system block.

## Runtime

- Deploy: builds on push to `main`, publishes `dist/` to GitHub Pages
  (or any static host — the workflow is a 40-line swap for Cloudflare
  Pages / Netlify / S3).
- Drift check: runs every PR against the configured Privicore
  instance. Compares structural fields (method, path, phase,
  parameters, responses) against the committed docset. Editorial
  prose and examples are allowed to differ. Destructive probes are
  skipped by default; run them manually via workflow dispatch.

## Security notes

- `.env` is gitignored. Never commit credentials.
- The probe creates throwaway profiles and storage devices on the
  instance it connects to. Point it at a dev / sandbox instance
  — never at a production vault.
- Destructive probes (delete-data, remove-device, change-password,
  etc.) require `--allow-destructive` on the CLI and are gated off
  by default in CI.
- The AI panel's Anthropic key lives in each visitor's localStorage
  and is sent only to `api.anthropic.com`. It never touches our
  servers.
