/**
 * Commit the staged release, tag it, and push both to `origin`. Run via
 * `npx tsx scripts/release/git-release.ts <version>`.
 *
 * In CI, `actions/checkout` runs with `persist-credentials: false`, so the
 * `origin` remote carries no token. When `GITHUB_TOKEN` and
 * `GITHUB_REPOSITORY` are set, the remote is re-pointed at a URL that embeds
 * the token so `git push` authenticates. Locally, the existing `origin`
 * credentials are used as-is.
 *
 * Idempotent per version: a re-run with no diff exits without committing
 * and restores the tag if a previous run lost it, so an interrupted release
 * can be completed by simply running the workflow again.
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

const tag = `v${version}`;

function tagExists(name: string): boolean {
  try {
    execSync(`git rev-parse -q --verify "refs/tags/${name}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

run('git config user.name "github-actions[bot]"');
run('git config user.email "github-actions[bot]@users.noreply.github.com"');
run('git add -A');

// Skip the commit when the bump produced no diff (re-running a release).
const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
if (staged === '') {
  // A previous run committed the bump but lost the tag (e.g. the tag push
  // failed); restore it so the release stays recoverable.
  if (!tagExists(tag)) {
    run(`git tag "${tag}"`);
    run(`git push -f origin "${tag}"`);
    console.log(`git-release: no changes staged; restored missing tag ${tag}.`);
  } else {
    console.log('git-release: no changes staged; nothing to release.');
  }
  process.exit(0);
}

run(`git commit -m "chore: Release version ${version}"`);
// -f re-points a stale tag left by an incomplete previous run at this
// commit; -f on the push moves the remote tag the same way.
run(`git tag -f "${tag}"`);
run('git push origin HEAD');
run(`git push -f origin "${tag}"`);
console.log(`git-release: pushed commit and tag ${tag}`);
