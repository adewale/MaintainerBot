import type { FlueContext } from '@flue/sdk/client';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';

export const triggers = { webhook: true };

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

type DraftPrCandidate = {
	repo: string;
	title: string;
	reason: string;
	verification: string;
	risk: 'low' | 'medium' | 'high';
};

type MaintenanceReport = {
	ok: true;
	mode: 'deterministic-no-model' | 'llm-assisted';
	owner: string;
	repoCount: number;
	summary: string;
	priorityActions: string[];
	draftPrCandidates: DraftPrCandidate[];
	sharedLessons: string[];
	generatedAt: string;
	r2?: {
		bucket: string;
		keys: string[];
	};
};

type R2BucketLike = {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
	put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

const DEFAULT_REJECTIONS = JSON.stringify({ version: 1, rejected: [] }, null, 2);
const DEFAULT_LESSONS = `# MaintainerBot Lessons Ledger

- Prefer small, reviewable PRs.
- Add tests or verification notes with every fix.
- Avoid repeating rejected changes from data/rejections.json.
`;

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
	const reportsBucket = env.MAINTAINERBOT_R2 as R2BucketLike | undefined;
	const githubHeaders: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'MaintainerBot',
	};
	if (env.GITHUB_TOKEN) githubHeaders.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

	const rejections = await readOrSeedR2(reportsBucket, 'data/rejections.json', DEFAULT_REJECTIONS, 'application/json');
	const lessons = await readOrSeedR2(reportsBucket, 'data/lessons.md', DEFAULT_LESSONS, 'text/markdown; charset=utf-8');

	await session.shell('mkdir -p /workspace/data /workspace/reports');
	await session.shell(`cat > /workspace/data/rejections.json <<'EOF'\n${rejections}\nEOF`);
	await session.shell(`cat > /workspace/data/lessons.md <<'EOF'\n${lessons}\nEOF`);

	const reposUrl = `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated`;
	const reposResponse = await fetch(reposUrl, { headers: githubHeaders });
	const reposJson = await reposResponse.text();
	if (!reposResponse.ok) {
		return { ok: false, error: `GitHub API failed: ${reposResponse.status} ${reposResponse.statusText}`, body: reposJson };
	}
	await session.shell(`cat > /workspace/data/repos.json <<'EOF'\n${reposJson}\nEOF`);

	const repos = JSON.parse(reposJson) as Array<Record<string, any>>;
	const filtered = repos
		.filter((repo) => !repo.fork && !repo.archived)
		.map((repo) => ({
			name: repo.name,
			fullName: repo.full_name,
			url: repo.html_url,
			description: repo.description,
			openIssues: repo.open_issues_count ?? 0,
			stars: repo.stargazers_count ?? 0,
			pushedAt: repo.pushed_at,
			language: repo.language,
		})) as RepoSummary[];
	await session.shell(`cat > /workspace/reports/repo-summary.json <<'EOF'\n${JSON.stringify(filtered, null, 2)}\nEOF`);
	const parsed = { repoCount: filtered.length, repos: filtered.slice(0, 50) };
	const generatedAt = new Date().toISOString();
	const deterministic = buildDeterministicReport(parsed.repos);

	let report: MaintenanceReport;
	if (!hasModel) {
		report = {
			ok: true,
			mode: 'deterministic-no-model',
			owner,
			repoCount: parsed.repoCount,
			generatedAt,
			...deterministic,
		};
	} else {
		const llmReport = await session.prompt(
			`Create today's MaintainerBot maintenance report.

Owner: ${owner}
Repositories scanned: ${parsed.repoCount}
Repository summaries JSON:
${JSON.stringify(parsed.repos, null, 2)}

Rejected ideas ledger:
${rejections}

Lessons ledger:
${lessons}

Focus on issues, PRs, best practices, lessons learned, efficiency, code quality, and shared lessons.
Recommend small draft PR candidates, but do not claim PRs were created.`,
			{ role: 'maintainer', result: ReportSchema },
		);

		report = {
			ok: true,
			mode: 'llm-assisted',
			owner,
			repoCount: parsed.repoCount,
			generatedAt,
			...llmReport,
		};
	}

	if (reportsBucket) {
		const keys = await writeReportToR2(reportsBucket, report);
		report.r2 = { bucket: 'MAINTAINERBOT_R2', keys };
	}

	return report;
}

async function readOrSeedR2(
	bucket: R2BucketLike | undefined,
	key: string,
	defaultValue: string,
	contentType: string,
) {
	if (!bucket) return defaultValue;
	const existing = await bucket.get(key);
	if (existing) return await existing.text();
	await bucket.put(key, defaultValue, { httpMetadata: { contentType } });
	return defaultValue;
}

async function writeReportToR2(bucket: R2BucketLike, report: MaintenanceReport) {
	const day = report.generatedAt.slice(0, 10);
	const markdown = renderMarkdown(report);
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const keys = [
		`reports/daily-maintenance-latest.md`,
		`reports/daily-maintenance-latest.json`,
		`reports/history/${day}/daily-maintenance.md`,
		`reports/history/${day}/daily-maintenance.json`,
	];
	await bucket.put(keys[0], markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
	await bucket.put(keys[1], json, { httpMetadata: { contentType: 'application/json' } });
	await bucket.put(keys[2], markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
	await bucket.put(keys[3], json, { httpMetadata: { contentType: 'application/json' } });
	return keys;
}

function renderMarkdown(report: MaintenanceReport) {
	const actions = report.priorityActions.map((action) => `- ${action}`).join('\n') || '- No priority actions.';
	const prs =
		report.draftPrCandidates
			.map(
				(pr) =>
					`### ${pr.repo}: ${pr.title}\n\n- Risk: ${pr.risk}\n- Reason: ${pr.reason}\n- Verification: ${pr.verification}\n`,
			)
			.join('\n') || 'No draft PR candidates.';
	const lessons = report.sharedLessons.map((lesson) => `- ${lesson}`).join('\n') || '- No shared lessons.';
	return `# MaintainerBot Daily Report\n\nGenerated: ${report.generatedAt}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Repositories scanned: ${report.repoCount}\n\n## Priority actions\n\n${actions}\n\n## Draft PR candidates\n\n${prs}\n\n## Shared lessons\n\n${lessons}\n`;
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
