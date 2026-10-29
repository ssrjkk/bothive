import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const allowPath = join(root, 'security/audit-allowlist.json');

const allowlist = JSON.parse(readFileSync(allowPath, 'utf8'));

const isWindows = process.platform === 'win32';
const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
  shell: isWindows,
});
const report = JSON.parse(audit.stdout);

const seen = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || via === null) continue;
    const ghsa = (via.url ?? '').split('/').pop();
    if (!ghsa?.startsWith('GHSA-')) continue;
    if (via.severity !== 'high' && via.severity !== 'critical') continue;
    seen.set(ghsa, { package: via.name, severity: via.severity, title: via.title });
  }
}

const today = new Date().toISOString().slice(0, 10);
const problems = [];

for (const [ghsa, finding] of seen) {
  const allowed = allowlist.entries.find((entry) => entry.ghsa === ghsa);
  if (!allowed) {
    problems.push(
      `${finding.severity.toUpperCase()} ${finding.package} ${ghsa}: ${finding.title} (no exception)`,
    );
    continue;
  }
  if (allowed.package !== finding.package) {
    problems.push(
      `${ghsa}: exception is for ${allowed.package}, but the report names ${finding.package}`,
    );
  }
  if (allowed.reviewBy < today) {
    problems.push(`${ghsa}: exception expired on ${allowed.reviewBy}, re-check upstream`);
  }
}

for (const entry of allowlist.entries) {
  if (!seen.has(entry.ghsa)) {
    problems.push(
      `${entry.ghsa} (${entry.package}): exception is stale, remove it from ${allowPath}`,
    );
  }
}

if (problems.length) {
  console.error('Production dependency audit failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  seen.size
    ? `Production dependencies: ${seen.size} high/critical advisory(s) matched an unexpired exception.`
    : 'Production dependencies: no high/critical advisories.',
);
