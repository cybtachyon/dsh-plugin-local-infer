/**
 * Bump the `version` field of every package.json in the workspace to a single
 * release version. Run via `npx tsx scripts/release/bump-versions.ts <version>`.
 *
 * The root package.json is the installable bundle (`dsh-plugin-local-infer`);
 * the packages/* workspace members ship inside it, so a release bumps them all
 * to the same version.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+([-+].*)?$/.test(version)) {
  console.error(`bump-versions: invalid version "${version}" (expected e.g. 0.1.3)`);
  process.exit(1);
}

function findPackageJson(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      found.push(...findPackageJson(abs));
    } else if (entry === 'package.json') {
      found.push(abs);
    }
  }
  return found;
}

const files = findPackageJson(root).sort();
if (files.length === 0) {
  console.error('bump-versions: no package.json files found');
  process.exit(1);
}

for (const abs of files) {
  const pkg = JSON.parse(readFileSync(abs, 'utf8'));
  const prev = pkg.version;
  pkg.version = version;
  // Preserve the repo's 2-space indentation and trailing newline.
  writeFileSync(abs, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${relative(root, abs)}: ${prev} -> ${version}`);
}

console.log(`bump-versions: updated ${files.length} package.json file(s) to ${version}`);
