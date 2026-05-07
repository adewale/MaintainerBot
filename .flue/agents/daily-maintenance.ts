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
	defaultBranch: string;
};

type WorkItem = {
	repo: string;
	number: number;
	title: string;
	url: string;
	state: string;
	createdAt: string;
	updatedAt: string;
	labels: string[];
	comments: number;
	author: string;
	ageDays: number;
	stale: boolean;
};

type Recommendation = {
	fingerprint: string;
	repo: string;
	title: string;
	reason: string;
	verification: string;
	risk: 'low' | 'medium' | 'high';
	rejected?: boolean;
};

type CreatedDraftPr = {
	repo: string;
	url?: string;
	branch?: string;
	status: 'created' | 'skipped' | 'failed';
	reason?: string;
};

type MaintenanceReport = {
	ok: true;
	mode: 'deterministic-no-model' | 'llm-assisted';
	owner: string;
	repoCount: number;
	summary: string;
	priorityActions: string[];
	issues: WorkItem[];
	pullRequests: WorkItem[];
	recommendations: Recommendation[];
	draftPrCandidates: Recommendation[];
	createdDraftPrs: CreatedDraftPr[];
	sharedLessons: string[];
	generatedAt: string;
	r2?: { bucket: string; keys: string[] };
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
			fingerprint: v.string(),
			repo: v.string(),
			title: v.string(),
			reason: v.string(),
			verification: v.string(),
			risk: v.picklist(['low', 'medium', 'high']),
		}),
	),
	sharedLessons: v.array(v.string()),
});

export default async function ({ init, env, payload }: FlueContext) {
	const configuredSecret = env.MAINTAINERBOT_WEBHOOK_SECRET;
	if (configuredSecret && payload?.webhookSecret !== configuredSecret) return { ok: false, error: 'Unauthorized' };

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
	const rejected = rejectedFingerprints(rejections);

	await session.shell('mkdir -p /workspace/data /workspace/reports');
	await session.shell(`cat > /workspace/data/rejections.json <<'EOF'\n${rejections}\nEOF`);
	await session.shell(`cat > /workspace/data/lessons.md <<'EOF'\n${lessons}\nEOF`);

	const repos = await fetchRepos(owner, githubHeaders);
	await session.shell(`cat > /workspace/reports/repo-summary.json <<'EOF'\n${JSON.stringify(repos, null, 2)}\nEOF`);
	const issues = await fetchSearchItems(`user:${owner} is:issue is:open`, githubHeaders);
	const pullRequests = await fetchSearchItems(`user:${owner} is:pr is:open`, githubHeaders);

	const generatedAt = new Date().toISOString();
	const deterministic = buildDeterministicReport(repos, issues, pullRequests, rejected);

	let report: MaintenanceReport;
	if (!hasModel) {
		report = { ok: true, mode: 'deterministic-no-model', owner, repoCount: repos.length, generatedAt, ...deterministic };
	} else {
		const llmReport = await session.prompt(
			`Create today's MaintainerBot maintenance report.

Owner: ${owner}
Repositories scanned: ${repos.length}
Open issues JSON:
${JSON.stringify(issues.slice(0, 50), null, 2)}
Open PRs JSON:
${JSON.stringify(pullRequests.slice(0, 50), null, 2)}
Repository summaries JSON:
${JSON.stringify(repos.slice(0, 50), null, 2)}
Rejected fingerprints:
${JSON.stringify([...rejected], null, 2)}
Lessons ledger:
${lessons}

Focus on issues, PRs, best practices, lessons learned, efficiency, code quality, and shared lessons. Every candidate must have a stable fingerprint and verification step. Do not include rejected fingerprints.`,
			{ role: 'maintainer', result: ReportSchema },
		);
		const candidates = llmReport.draftPrCandidates.filter((candidate) => !rejected.has(candidate.fingerprint));
		report = {
			ok: true,
			mode: 'llm-assisted',
			owner,
			repoCount: repos.length,
			generatedAt,
			summary: llmReport.summary,
			priorityActions: llmReport.priorityActions,
			issues: issues.slice(0, 30),
			pullRequests: pullRequests.slice(0, 30),
			recommendations: candidates,
			draftPrCandidates: candidates,
			createdDraftPrs: [],
			sharedLessons: llmReport.sharedLessons,
		};
	}

	report.createdDraftPrs = await maybeCreateDraftPrs(report, repos, env, githubHeaders);

	if (reportsBucket) {
		const keys = await writeReportToR2(reportsBucket, report);
		report.r2 = { bucket: 'MAINTAINERBOT_R2', keys };
	}
	return report;
}

async function fetchRepos(owner: string, headers: Record<string, string>): Promise<RepoSummary[]> {
	const response = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&sort=updated`, { headers });
	const text = await response.text();
	if (!response.ok) throw new Error(`GitHub repos API failed: ${response.status} ${text}`);
	return (JSON.parse(text) as Array<Record<string, any>>)
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
			defaultBranch: repo.default_branch ?? 'main',
		}));
}

async function fetchSearchItems(query: string, headers: Record<string, string>): Promise<WorkItem[]> {
	const response = await fetch(
		`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100`,
		{ headers },
	);
	const text = await response.text();
	if (!response.ok) return [];
	return (JSON.parse(text).items ?? []).map((item: any) => {
		const created = Date.parse(item.created_at);
		const ageDays = Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
		return {
			repo: item.repository_url.split('/repos/')[1],
			number: item.number,
			title: item.title,
			url: item.html_url,
			state: item.state,
			createdAt: item.created_at,
			updatedAt: item.updated_at,
			labels: (item.labels ?? []).map((label: any) => label.name),
			comments: item.comments ?? 0,
			author: item.user?.login ?? 'unknown',
			ageDays,
			stale: Date.now() - Date.parse(item.updated_at) > 30 * 24 * 60 * 60 * 1000,
		};
	});
}

async function readOrSeedR2(bucket: R2BucketLike | undefined, key: string, defaultValue: string, contentType: string) {
	if (!bucket) return defaultValue;
	const existing = await bucket.get(key);
	if (existing) return await existing.text();
	await bucket.put(key, defaultValue, { httpMetadata: { contentType } });
	return defaultValue;
}

function rejectedFingerprints(rejectionsJson: string) {
	try {
		return new Set((JSON.parse(rejectionsJson).rejected ?? []).map((item: any) => String(item.fingerprint)));
	} catch {
		return new Set<string>();
	}
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
	const issueMd = report.issues.map((item) => `- [${item.repo}#${item.number}](${item.url}) ${item.title} — ${item.ageDays}d old, ${item.comments} comments, labels: ${item.labels.join(', ') || 'none'}`).join('\n') || '- No open issues found.';
	const prMd = report.pullRequests.map((item) => `- [${item.repo}#${item.number}](${item.url}) ${item.title} — ${item.ageDays}d old, ${item.comments} comments, labels: ${item.labels.join(', ') || 'none'}`).join('\n') || '- No open PRs found.';
	const recs = report.draftPrCandidates.map((pr) => `### ${pr.repo}: ${pr.title}\n\n- Fingerprint: \`${pr.fingerprint}\`\n- Risk: ${pr.risk}\n- Reason: ${pr.reason}\n- Verification: ${pr.verification}\n`).join('\n') || 'No draft PR candidates.';
	const created = report.createdDraftPrs.map((pr) => `- ${pr.status}: ${pr.repo}${pr.url ? ` — ${pr.url}` : ''}${pr.reason ? ` — ${pr.reason}` : ''}`).join('\n') || '- No draft PRs created.';
	const lessons = report.sharedLessons.map((lesson) => `- ${lesson}`).join('\n') || '- No shared lessons.';
	return `# MaintainerBot Daily Report\n\nGenerated: ${report.generatedAt}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Repositories scanned: ${report.repoCount}\n\n## Priority actions\n\n${actions}\n\n## Open issues\n\n${issueMd}\n\n## Open pull requests\n\n${prMd}\n\n## Draft PR candidates\n\n${recs}\n\n## Draft PR creation results\n\n${created}\n\n## Shared lessons\n\n${lessons}\n`;
}

function buildDeterministicReport(repos: RepoSummary[], issues: WorkItem[], pullRequests: WorkItem[], rejected: Set<string>) {
	const needsDescription = repos.filter((repo) => !repo.description).slice(0, 10);
	const stale = repos.filter((repo) => repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) > 180 * 24 * 60 * 60 * 1000).slice(0, 10);
	const recommendations = [
		...needsDescription.map((repo) => recommendation(repo.fullName, 'metadata-description', 'Add or improve project description/documentation', 'Repository metadata appears incomplete from the scan.', 'Confirm README accurately states purpose and update GitHub description or docs.', 'low' as const)),
		...stale.map((repo) => recommendation(repo.fullName, 'stale-repo-review', 'Review stale repository status', 'Repository has not been pushed recently.', 'Confirm whether the repo should be archived, refreshed, or documented as complete.', 'low' as const)),
	].filter((item) => !rejected.has(item.fingerprint));
	return {
		summary: `Scanned ${repos.length} public, non-fork, non-archived repositories. Found ${issues.length} open issues, ${pullRequests.length} open PRs, ${needsDescription.length} repos missing descriptions, and ${stale.length} potentially stale repos.`,
		priorityActions: [
			...issues.slice(0, 10).map((issue) => `Triage issue ${issue.repo}#${issue.number}: ${issue.title}`),
			...pullRequests.slice(0, 10).map((pr) => `Review PR ${pr.repo}#${pr.number}: ${pr.title}`),
			...needsDescription.slice(0, 5).map((repo) => `Add a concise GitHub description to ${repo.fullName}.`),
		].slice(0, 20),
		issues: issues.slice(0, 30),
		pullRequests: pullRequests.slice(0, 30),
		recommendations,
		draftPrCandidates: recommendations.slice(0, 8),
		createdDraftPrs: [],
		sharedLessons: [
			'Repositories with clear descriptions are easier to triage and maintain.',
			'Daily maintenance should prioritize small, low-risk fixes and avoid repeating rejected suggestions.',
			'Every proposed PR should include a verification step before it is sent for review.',
		],
	};
}

function recommendation(repo: string, kind: string, title: string, reason: string, verification: string, risk: 'low' | 'medium' | 'high'): Recommendation {
	return { fingerprint: `${repo}:${kind}:${slug(title)}`, repo, title, reason, verification, risk };
}

function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function maybeCreateDraftPrs(report: MaintenanceReport, repos: RepoSummary[], env: Record<string, any>, headers: Record<string, string>): Promise<CreatedDraftPr[]> {
	if (env.CREATE_DRAFT_PRS !== 'true') return [];
	if (!env.GITHUB_TOKEN) return [{ repo: '*', status: 'skipped', reason: 'GITHUB_TOKEN is required to create draft PRs.' }];
	const allowlist = new Set(String(env.DRAFT_PR_REPO_ALLOWLIST || '').split(',').map((x) => x.trim()).filter(Boolean));
	if (!allowlist.size) return [{ repo: '*', status: 'skipped', reason: 'DRAFT_PR_REPO_ALLOWLIST is empty.' }];
	const results: CreatedDraftPr[] = [];
	for (const candidate of report.draftPrCandidates.slice(0, 3)) {
		if (!allowlist.has(candidate.repo)) {
			results.push({ repo: candidate.repo, status: 'skipped', reason: 'Repo is not in DRAFT_PR_REPO_ALLOWLIST.' });
			continue;
		}
		const repo = repos.find((item) => item.fullName === candidate.repo);
		if (!repo) continue;
		results.push(await createDraftPr(repo, candidate, headers));
	}
	return results;
}

async function createDraftPr(repo: RepoSummary, candidate: Recommendation, headers: Record<string, string>): Promise<CreatedDraftPr> {
	try {
		const branch = `maintainerbot/${candidate.fingerprint.split(':').pop()}`;
		const baseRef = await gh(`https://api.github.com/repos/${repo.fullName}/git/ref/heads/${repo.defaultBranch}`, headers);
		await gh(`https://api.github.com/repos/${repo.fullName}/git/refs`, headers, 'POST', { ref: `refs/heads/${branch}`, sha: baseRef.object.sha }).catch(() => undefined);
		const path = 'MAINTAINERBOT.md';
		const body = `# MaintainerBot Recommendation\n\n${candidate.title}\n\nReason: ${candidate.reason}\n\nVerification: ${candidate.verification}\n\nFingerprint: ${candidate.fingerprint}\n`;
		await gh(`https://api.github.com/repos/${repo.fullName}/contents/${path}`, headers, 'PUT', {
			message: candidate.title,
			content: btoa(body),
			branch,
		});
		const pr = await gh(`https://api.github.com/repos/${repo.fullName}/pulls`, headers, 'POST', {
			title: candidate.title,
			head: branch,
			base: repo.defaultBranch,
			body: `${candidate.reason}\n\nVerification: ${candidate.verification}\n\nFingerprint: ${candidate.fingerprint}`,
			draft: true,
		});
		return { repo: repo.fullName, status: 'created', branch, url: pr.html_url };
	} catch (error) {
		return { repo: repo.fullName, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
	}
}

async function gh(url: string, headers: Record<string, string>, method = 'GET', body?: unknown): Promise<any> {
	const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await response.text();
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
	return text ? JSON.parse(text) : null;
}
