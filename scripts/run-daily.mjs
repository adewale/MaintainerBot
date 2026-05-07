import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const reportsDir = join(root, 'reports');
mkdirSync(reportsDir, { recursive: true });

const args = ['exec', 'flue', 'run', 'daily-maintenance', '--target', 'node', '--id', 'daily', '--payload', '{}', '--output', '.'];
if (existsSync(join(root, '.env'))) args.push('--env', '.env');

const result = spawnSync('pnpm', args, { cwd: root, env: process.env, encoding: 'utf8' });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
writeFileSync(join(reportsDir, 'daily-maintenance.log'), output);

if (result.status !== 0) {
  console.error(output);
  process.exit(result.status ?? 1);
}

function parseObjectAt(text, start) {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Could not parse JSON object from Flue output.');
}

const okIndex = output.indexOf('"ok"');
const start = output.lastIndexOf('{', okIndex);
const report = parseObjectAt(output, start);
const today = new Date().toISOString().slice(0, 10);

function md(report) {
  const actions = (report.priorityActions ?? []).map((x) => `- ${x}`).join('\n') || '- No priority actions.';
  const prs = (report.draftPrCandidates ?? []).map((pr) => `### ${pr.repo}: ${pr.title}\n\n- Risk: ${pr.risk}\n- Reason: ${pr.reason}\n- Verification: ${pr.verification}\n`).join('\n') || 'No draft PR candidates.';
  const lessons = (report.sharedLessons ?? []).map((x) => `- ${x}`).join('\n') || '- No shared lessons.';
  return `# MaintainerBot Daily Report\n\nGenerated: ${new Date().toISOString()}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Repositories scanned: ${report.repoCount}\n\n## Priority actions\n\n${actions}\n\n## Draft PR candidates\n\n${prs}\n\n## Shared lessons\n\n${lessons}\n`;
}

const markdown = md(report);
const primaryOut = '/tmp/MaintainerBotOut.md';

writeFileSync(join(reportsDir, 'daily-maintenance.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(reportsDir, `daily-maintenance-${today}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(reportsDir, 'daily-maintenance.md'), markdown);
writeFileSync(join(reportsDir, `daily-maintenance-${today}.md`), markdown);
writeFileSync(primaryOut, markdown);

console.log(`Saved primary report: ${primaryOut}`);
console.log(`Saved reports/daily-maintenance.md`);
console.log(`Saved reports/daily-maintenance.json`);
console.log(`Repos scanned: ${report.repoCount}`);
