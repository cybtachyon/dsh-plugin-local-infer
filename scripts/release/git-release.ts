/**
 * Commit the staged release, tag it, and push both to `origin`. Run via
 * `npx tsx scripts/release/git-release.ts <version>`.
 *
 * Auth uses the `GITHUB_TOKEN` that `actions/checkout` embeds in the `origin`
 * remote, so `git push` works without a separate credential.
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
