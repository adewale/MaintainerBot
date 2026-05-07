import type { FlueContext } from '@flue/sdk/client';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';

export const triggers = {};

type RepoSummary = {
	name: string;
	fullName: string;
	url: string;
	description: string | null;
	openIssues: number;
	stars: number;
	pushedAt: string | null;
	language: string | null;
};

const ReportSchema = v.object({
	summary: v.string(),
	priorityActions: v.array(v.string()),
	draftPrCandidates: v.array(
		v.object({
			repo: v.string(),
			title: v.string(),
			reason: v.string(),
			verification: v.string(),
			risk: v.picklist(['low', 'medium', 'high']),
		}),
	),
	sharedLessons: v.array(v.string()),
});

export default async function ({ init, env }: FlueContext) {
	const fs = new InMemoryFs();
	const sandbox = () =>
		new Bash({ fs, cwd: '/workspace', python: true, network: { dangerouslyAllowFullInternetAccess: true } });

	const hasModel = Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY);
	const agent = await init({
		sandbox,
		cwd: '/workspace',
		model: hasModel ? env.FLUE_MODEL || 'anthropic/claude-haiku-4-5' : false,
	});
	const session = await agent.session();

	const owner = String(env.GITHUB_OWNER || 'adewale');
	const authHeader = env.GITHUB_TOKEN ? `-H ${JSON.stringify(`Authorization: Bearer ${env.GITHUB_TOKEN}`)}` : '';

	await session.shell('mkdir -p /workspace/data /workspace/reports');
	await session.shell(`cat > /workspace/data/rejections.json <<'EOF'\n${await safeReadHostFile('data/rejections.json')}\nEOF`);
	await session.shell(`cat > /workspace/data/lessons.md <<'EOF'\n${await safeReadHostFile('data/lessons.md')}\nEOF`);

	const reposUrl = `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated`;
	const reposFetch = await session.shell(
		`curl -L -H "Accept: application/vnd.github+json" ${authHeader} ${JSON.stringify(reposUrl)} -o /workspace/data/repos.json`,
		{ timeout: 60_000 },
	);
	if (reposFetch.exitCode !== 0) {
		return { ok: false, error: reposFetch.stderr || 'Failed to fetch GitHub repositories' };
	}

	const scan = await session.shell(`python3 - <<'PY'
import json
from pathlib import Path
repos = json.loads(Path('/workspace/data/repos.json').read_text())
if isinstance(repos, dict) and 'message' in repos:
    raise SystemExit(repos['message'])
filtered = []
for r in repos:
    if r.get('fork') or r.get('archived'):
        continue
    filtered.append({
        'name': r.get('name'),
        'fullName': r.get('full_name'),
        'url': r.get('html_url'),
        'description': r.get('description'),
        'openIssues': r.get('open_issues_count', 0),
        'stars': r.get('stargazers_count', 0),
        'pushedAt': r.get('pushed_at'),
        'language': r.get('language'),
    })
Path('/workspace/reports/repo-summary.json').write_text(json.dumps(filtered, indent=2))
print(json.dumps({'repoCount': len(filtered), 'repos': filtered[:50]}, indent=2))
PY`);

	const parsed = JSON.parse(scan.stdout) as { repoCount: number; repos: RepoSummary[] };
	const deterministic = buildDeterministicReport(parsed.repos);

	if (!hasModel) {
		return {
			ok: true,
			mode: 'deterministic-no-model',
			owner,
			repoCount: parsed.repoCount,
			...deterministic,
		};
	}

	const llmReport = await session.prompt(
		`Create today's MaintainerBot maintenance report.

Owner: ${owner}
Repositories scanned: ${parsed.repoCount}
Repository summaries JSON:
${JSON.stringify(parsed.repos, null, 2)}

Rejected ideas ledger:
${await session.shell('cat /workspace/data/rejections.json').then((r) => r.stdout)}

Lessons ledger:
${await session.shell('cat /workspace/data/lessons.md').then((r) => r.stdout)}

Focus on issues, PRs, best practices, lessons learned, efficiency, code quality, and shared lessons.
Recommend small draft PR candidates, but do not claim PRs were created.`,
		{ role: 'maintainer', result: ReportSchema },
	);

	return {
		ok: true,
		mode: 'llm-assisted',
		owner,
		repoCount: parsed.repoCount,
		...llmReport,
	};
}

async function safeReadHostFile(path: string) {
	const fs = await import('node:fs/promises');
	try {
		return await fs.readFile(path, 'utf8');
	} catch {
		return '';
	}
}

function buildDeterministicReport(repos: RepoSummary[]) {
	const needsDescription = repos.filter((repo) => !repo.description).slice(0, 10);
	const activeIssues = repos.filter((repo) => repo.openIssues > 0).slice(0, 10);
	const stale = repos
		.filter((repo) => repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) > 180 * 24 * 60 * 60 * 1000)
		.slice(0, 10);

	return {
		summary: `Scanned ${repos.length} public, non-fork, non-archived repositories. Found ${activeIssues.length} repos with open issue counts in the top scan window, ${needsDescription.length} repos missing descriptions, and ${stale.length} potentially stale repos.`,
		priorityActions: [
			...activeIssues.map((repo) => `Review open issues in ${repo.fullName} (${repo.openIssues} open).`),
			...needsDescription.map((repo) => `Add a concise GitHub description to ${repo.fullName}.`),
			...stale.map((repo) => `Check whether ${repo.fullName} should be archived, refreshed, or documented as complete.`),
		].slice(0, 15),
		draftPrCandidates: needsDescription.slice(0, 5).map((repo) => ({
			repo: repo.fullName,
			title: 'Add or improve project description/documentation',
			reason: 'Repository metadata or docs appear incomplete from the scan.',
			verification: 'Confirm README accurately states purpose and update metadata manually or via GitHub API.',
			risk: 'low' as const,
		})),
		sharedLessons: [
			'Repositories with clear descriptions are easier to triage and maintain.',
			'Daily maintenance should prioritize small, low-risk fixes and avoid repeating rejected suggestions.',
			'Every proposed PR should include a verification step before it is sent for review.',
		],
	};
}
