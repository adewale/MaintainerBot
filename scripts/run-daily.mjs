import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const reportsDir = join(root, 'reports');
mkdirSync(reportsDir, { recursive: true });

const args = ['exec', 'flue', 'run', 'daily-maintenance', '--target', 'node', '--payload', '{}'];
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
  const sortedIssues = [...(report.issues ?? [])].sort(compareWorkItems);
  const sortedPrs = [...(report.pullRequests ?? [])].sort(compareWorkItems);
  const sortedCandidates = [...(report.draftPrCandidates ?? [])].sort(compareRecommendations);
  const inbox = buildActionInbox(sortedIssues, sortedPrs, sortedCandidates);
  const actionInbox = inbox.map((item, index) => `${index + 1}. ${item}`).join('\n\n') || 'No urgent actions today.';
  const candidates = sortedCandidates.map((pr, index) => `### ${index + 1}. [${pr.repo}](https://github.com/${pr.repo}): ${pr.title}\n\n- Fingerprint: \`${pr.fingerprint ?? 'n/a'}\`\n- Risk: ${pr.risk}\n- Why it matters: ${pr.reason}\n- Suggested action: ${candidateAction(pr)}\n- Verification: ${pr.verification}\n`).join('\n') || 'No draft PR candidates.';
  const created = (report.createdDraftPrs ?? []).map((pr) => `- ${pr.status}: ${pr.repo}${pr.url ? ` — ${pr.url}` : ''}${pr.reason ? ` — ${pr.reason}` : ''}`).join('\n') || '- No draft PRs created.';
  const openPrs = sortedPrs.map((item) => workItemLine(item, 'PR')).join('\n') || '- No open PRs found.';
  const issues = sortedIssues.map((item) => workItemLine(item, 'issue')).join('\n') || '- No open issues found.';
  const bestPractices = (report.bestPractices ?? []).map((x) => `- ${linkRepoInText(x)}`).join('\n') || '- No best-practice findings.';
  const efficiency = (report.efficiency ?? []).map((x) => `- ${linkRepoInText(x)}`).join('\n') || '- No efficiency findings.';
  const codeQuality = (report.codeQuality ?? []).map((x) => `- ${linkRepoInText(x)}`).join('\n') || '- No code-quality findings.';
  const lessons = (report.sharedLessons ?? []).map((x) => `- ${x}`).join('\n') || '- No shared lessons.';
  return `# MaintainerBot Status\n\nLast updated: ${report.generatedAt ?? new Date().toISOString()}\n\n## Action inbox\n\n${actionInbox}\n\n## Draft PR candidates\n\nDraft PR creation is ${(report.createdDraftPrs ?? []).length ? 'active for this run' : 'disabled or produced no PRs'}.\n\n${candidates}\n\n## Open PRs needing review\n\n${openPrs}\n\n## Open issues needing triage\n\n${issues}\n\n## Repo health fixes\n\n### Best practices\n\n${bestPractices}\n\n### Efficiency\n\n${efficiency}\n\n### Code quality\n\n${codeQuality}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Repositories scanned: ${report.repoCount}\n- Open issues: ${(report.issues ?? []).length}\n- Open PRs: ${(report.pullRequests ?? []).length}\n\n## Draft PR creation results\n\n${created}\n\n## Shared lessons\n\n${lessons}\n`;
}

function buildActionInbox(issues, prs, candidates) {
  return [
    ...issues.slice(0, 4).map((issue) => `${priority(issue)} Triage issue [${issue.repo}#${issue.number}](${issue.url})\n   - Why: ${issueReason(issue)}\n   - Suggested action: ${issueAction(issue)}`),
    ...prs.slice(0, 6).map((pr) => `${priority(pr)} Review PR [${pr.repo}#${pr.number}](${pr.url})\n   - Why: ${prReason(pr)}\n   - Suggested action: review, merge, request changes, or close`),
    ...candidates.slice(0, 5).map((candidate) => `[P3] Candidate fix [${candidate.repo}](https://github.com/${candidate.repo}) — ${candidate.title}\n   - Why: ${candidate.reason}\n   - Suggested action: ${candidateAction(candidate)}`),
  ].slice(0, 12);
}

function compareWorkItems(a, b) { return priorityRank(priority(a)) - priorityRank(priority(b)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt); }
function compareRecommendations(a, b) { const risk = { high: 0, medium: 1, low: 2 }; return risk[a.risk] - risk[b.risk] || a.repo.localeCompare(b.repo); }
function priorityRank(value) { return value === '[P0]' ? 0 : value === '[P1]' ? 1 : value === '[P2]' ? 2 : 3; }
function priority(item) { if (item.stale) return '[P2]'; if ((item.labels ?? []).some((label) => /p0|critical|security/i.test(label)) || /p0|critical|security|credential/i.test(item.title)) return '[P0]'; if (item.ageDays > 60) return '[P1]'; return '[P3]'; }
function workItemLine(item, kind) { const labels = (item.labels ?? []).join(', ') || 'none'; const why = kind === 'PR' ? prReason(item) : issueReason(item); const action = kind === 'PR' ? 'review, merge, request changes, or close' : issueAction(item); return `- ${priority(item)} [${item.repo}#${item.number}](${item.url}) — ${item.title}\n  - Why: ${why}\n  - Suggested action: ${action}\n  - Metadata: ${item.ageDays}d old, ${item.comments} comments, labels: ${labels}`; }
function issueReason(item) { if (/p0|critical|security|credential/i.test(item.title)) return 'security/credential-related language suggests higher risk.'; if (item.stale) return 'stale open issue needs a decision.'; return 'open issue needs triage or a maintainer response.'; }
function issueAction(item) { if (/p0|critical|security|credential/i.test(item.title)) return 'label security/priority, confirm scope, and decide owner.'; return 'label, confirm expected behavior, assign next action, or close.'; }
function prReason(item) { if (item.stale || item.ageDays > 60) return `open for ${item.ageDays} days and likely needs a merge/close decision.`; return 'open PR is awaiting maintainer review.'; }
function candidateAction(item) { return item.risk === 'low' ? 'approve for draft PR creation or apply manually.' : 'review manually before enabling draft PR creation.'; }
function linkRepoInText(value) { return value.replace(/(adewale\/[A-Za-z0-9_.-]+)/g, '[$1](https://github.com/$1)'); }

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
