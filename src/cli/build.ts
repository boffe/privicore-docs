/**
 * Build the static docs site into dist/.
 *
 * Usage:
 *   npm run build
 *   npm run build -- --docset intermediate/custom.json --out dist-staging
 */

import { build } from "../site/build.ts";

interface Args {
  docSetPath: string;
  contentDir: string;
  outDir: string;
  siteTitle?: string;
  tagline?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    docSetPath: "intermediate/docset.json",
    contentDir: "content",
    outDir: "dist",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--docset") out.docSetPath = argv[++i]!;
    else if (a === "--content") out.contentDir = argv[++i]!;
    else if (a === "--out") out.outDir = argv[++i]!;
    else if (a === "--title") out.siteTitle = argv[++i]!;
    else if (a === "--tagline") out.tagline = argv[++i]!;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await build(args);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
