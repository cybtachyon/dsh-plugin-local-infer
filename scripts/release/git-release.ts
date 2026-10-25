/**
 * Commit the staged release, tag it, and push both to `origin`. Run via
 * `npx tsx scripts/release/git-release.ts <version>`.
 *
 * In CI, `actions/checkout` runs with `persist-credentials: false`, so the
 * `origin` remote carries no token. When `GITHUB_TOKEN` and
 * `GITHUB_REPOSITORY` are set, the remote is re-pointed at a URL that embeds
 * the token so `git push` authenticates. Locally, the existing `origin`
 * credentials are used as-is.
 */
import { execSync } from 'node:child_process';

const version = process.argv[2];
if (!version) {
  console.error('git-release: missing version argument');
  process.exit(1);
}

function run(cmd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

// Re-point origin at a URL that carries the token. The shell expands the
// env vars, so the echoed command line never shows the token value.
if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
  run('git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"');
}

run('git config user.name "github-actions[bot]"');
run('git config user.email "github-actions[bot]@users.noreply.github.com"');
run('git add -A');

// Skip the commit when the bump produced no diff (re-running a release).
const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
if (staged === '') {
  console.log('git-release: no changes staged; nothing to release.');
  process.exit(0);
}

run(`git commit -m "chore: Release version ${version}"`);
run(`git tag "v${version}"`);
run('git push origin HEAD');
run(`git push origin "v${version}"`);
console.log(`git-release: pushed commit and tag v${version}`);
