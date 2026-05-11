import type { FlueContext } from '@flue/sdk/client';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';

export const triggers = { webhook: true };

type RepoHealth = {
	hasReadme: boolean;
	hasLicense: boolean;
	hasCi: boolean;
	hasPackageJson: boolean;
	hasTests: boolean;
	hasLockfile: boolean;
	packageManager: string | null;
};

type ProjectContext = {
	repo: string;
	url: string;
	description: string | null;
	language: string | null;
	lastPushed: string | null;
	health: RepoHealth;
	openTodos: string[];
	openIssues: WorkItem[];
	openPullRequests: WorkItem[];
	deterministicFindings: Recommendation[];
};

type ProjectRecommendation = Recommendation & {
	priority: 'P0' | 'P1' | 'P2' | 'P3';
	category: 'triage' | 'review' | 'docs' | 'ci' | 'tests' | 'cleanup' | 'investigation';
	evidence: string[];
	recommendedAction: string;
};

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
	health: RepoHealth;
	openTodos: string[];
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

type ProjectAudit = {
	repo: string;
	auditedAt: string;
	inputHash: string;
	status: 'healthy' | 'needs_attention' | 'stale' | 'blocked';
	summary: string;
	recommendations: ProjectRecommendation[];
	sharedLessons: string[];
};

type AuditRunSummary = {
	audited: string[];
	carriedForward: string[];
	skipped: string[];
	results: ProjectAudit[];
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
	bestPractices: string[];
	efficiency: string[];
	codeQuality: string[];
	projectRecommendations: ProjectRecommendation[];
	llmAudits: AuditRunSummary;
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

const ProjectAuditSchema = v.object({
	status: v.picklist(['healthy', 'needs_attention', 'stale', 'blocked']),
	summary: v.string(),
	recommendations: v.array(
		v.object({
			fingerprint: v.string(),
			repo: v.string(),
			priority: v.picklist(['P0', 'P1', 'P2', 'P3']),
			category: v.picklist(['triage', 'review', 'docs', 'ci', 'tests', 'cleanup', 'investigation']),
			title: v.string(),
			evidence: v.array(v.string()),
			recommendedAction: v.string(),
			reason: v.string(),
			verification: v.string(),
			risk: v.picklist(['low', 'medium', 'high']),
		}),
	),
	sharedLessons: v.array(v.string()),
});

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
	projectRecommendations: v.array(
		v.object({
			fingerprint: v.string(),
			repo: v.string(),
			priority: v.picklist(['P0', 'P1', 'P2', 'P3']),
			category: v.picklist(['triage', 'review', 'docs', 'ci', 'tests', 'cleanup', 'investigation']),
			title: v.string(),
			evidence: v.array(v.string()),
			recommendedAction: v.string(),
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
	const useCloudflareAiGateway = Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CF_AI_GATEWAY_ID && env.ANTHROPIC_API_KEY);
	const agent = await init({
		sandbox,
		cwd: '/workspace',
		model: hasModel ? env.FLUE_MODEL || 'anthropic/claude-haiku-4-5' : false,
		providers: useCloudflareAiGateway
			? {
					anthropic: {
						baseUrl: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/anthropic`,
						apiKey: env.ANTHROPIC_API_KEY,
						headers: env.CF_AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.CF_AI_GATEWAY_TOKEN}` } : undefined,
					},
				}
			: undefined,
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

	const cutoff = '2025-11-17T00:00:00.000Z';
	const repos = (await fetchRepos(owner, githubHeaders)).filter((repo) => repo.pushedAt && repo.pushedAt >= cutoff);
	await session.shell(`cat > /workspace/reports/repo-summary.json <<'EOF'\n${JSON.stringify(repos, null, 2)}\nEOF`);
	const repoNames = new Set(repos.map((repo) => repo.fullName));
	const issues = (await fetchSearchItems(`user:${owner} is:issue is:open`, githubHeaders)).filter((item) => repoNames.has(item.repo));
	const pullRequests = (await fetchSearchItems(`user:${owner} is:pr is:open`, githubHeaders)).filter((item) => repoNames.has(item.repo));

	const generatedAt = new Date().toISOString();
	const deterministic = buildDeterministicReport(repos, issues, pullRequests, rejected);
	const projectContexts = buildProjectContexts(repos, issues, pullRequests, deterministic.recommendations, rejected);

	const llmAudits = await auditChangedProjects({
		hasModel,
		bucket: reportsBucket,
		session,
		projectContexts,
		rejected,
		lessons,
		generatedAt,
	});
	const auditRecommendations = llmAudits.results.flatMap((audit) => audit.recommendations).filter((item) => !rejected.has(item.fingerprint));
	const mergedRecommendations = [...auditRecommendations, ...deterministic.recommendations];

	const report: MaintenanceReport = {
		ok: true,
		mode: hasModel ? 'llm-assisted' : 'deterministic-no-model',
		owner,
		repoCount: repos.length,
		generatedAt,
		...deterministic,
		recommendations: mergedRecommendations,
		projectRecommendations: auditRecommendations,
		draftPrCandidates: mergedRecommendations.filter((item) => item.risk === 'low').slice(0, 8),
		llmAudits,
	};

	report.createdDraftPrs = await maybeCreateDraftPrs(report, repos, env, githubHeaders, reportsBucket);
	await maybeSendEmail(report, env);

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
	const baseRepos = (JSON.parse(text) as Array<Record<string, any>>)
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
	return await Promise.all(baseRepos.map(async (repo) => ({ ...repo, health: await fetchRepoHealth(repo.fullName, headers), openTodos: await fetchOpenTodos(repo.fullName, headers) })));
}

async function fetchOpenTodos(fullName: string, headers: Record<string, string>): Promise<string[]> {
	const candidates = ['TODO.md', 'TODOS.md', 'todo.md', 'todo.txt'];
	for (const path of candidates) {
		const file = await ghOptional(`https://api.github.com/repos/${fullName}/contents/${path}`, headers);
		if (file?.content) {
			try {
				return atob(String(file.content).replace(/\n/g, ''))
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter((line) => /^[-*]?\s*\[?\s*\]?\s*(TODO|todo|[/-])/.test(line) || line.startsWith('- [ ]'))
					.slice(0, 20);
			} catch {
				return [];
			}
		}
	}
	return [];
}

async function fetchRepoHealth(fullName: string, headers: Record<string, string>): Promise<RepoHealth> {
	const entries = await ghOptional(`https://api.github.com/repos/${fullName}/contents`, headers);
	const names = Array.isArray(entries) ? new Set(entries.map((entry: any) => String(entry.name).toLowerCase())) : new Set<string>();
	const workflows = await ghOptional(`https://api.github.com/repos/${fullName}/contents/.github/workflows`, headers);
	const pkg = await ghOptional(`https://api.github.com/repos/${fullName}/contents/package.json`, headers);
	let hasTests = false;
	if (pkg?.content) {
		try {
			const parsed = JSON.parse(atob(String(pkg.content).replace(/\n/g, '')));
			hasTests = Boolean(parsed.scripts?.test || parsed.scripts?.check || parsed.scripts?.['check:types']);
		} catch {}
	}
	return {
		hasReadme: [...names].some((name) => name.startsWith('readme')),
		hasLicense: [...names].some((name) => name.startsWith('license')),
		hasCi: Array.isArray(workflows) && workflows.length > 0,
		hasPackageJson: names.has('package.json'),
		hasTests,
		hasLockfile: names.has('pnpm-lock.yaml') || names.has('package-lock.json') || names.has('yarn.lock') || names.has('bun.lockb'),
		packageManager: names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('package-lock.json') ? 'npm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lockb') ? 'bun' : null,
	};
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

function buildProjectContexts(
	repos: RepoSummary[],
	issues: WorkItem[],
	pullRequests: WorkItem[],
	recommendations: Recommendation[],
	rejected: Set<string>,
): ProjectContext[] {
	return repos.map((repo) => ({
		repo: repo.fullName,
		url: repo.url,
		description: repo.description,
		language: repo.language,
		lastPushed: repo.pushedAt,
		health: repo.health,
		openTodos: repo.openTodos,
		openIssues: issues.filter((issue) => issue.repo === repo.fullName),
		openPullRequests: pullRequests.filter((pr) => pr.repo === repo.fullName),
		deterministicFindings: recommendations.filter((item) => item.repo === repo.fullName && !rejected.has(item.fingerprint)),
	}));
}

async function auditChangedProjects(options: {
	hasModel: boolean;
	bucket: R2BucketLike | undefined;
	session: any;
	projectContexts: ProjectContext[];
	rejected: Set<string>;
	lessons: string;
	generatedAt: string;
}): Promise<AuditRunSummary> {
	if (!options.hasModel || !options.bucket) {
		return {
			audited: [],
			carriedForward: [],
			skipped: options.projectContexts.map((project) => project.repo),
			results: [],
		};
	}

	const results: ProjectAudit[] = [];
	const audited: string[] = [];
	const carriedForward: string[] = [];
	const skipped: string[] = [];
	const lessonsHash = await sha256(options.lessons);

	for (const project of options.projectContexts) {
		const auditInput = {
			repo: project.repo,
			lastPushed: project.lastPushed,
			health: project.health,
			openTodos: project.openTodos,
			issues: project.openIssues.map((issue) => ({ number: issue.number, title: issue.title, updatedAt: issue.updatedAt, labels: issue.labels })),
			pullRequests: project.openPullRequests.map((pr) => ({ number: pr.number, title: pr.title, updatedAt: pr.updatedAt, labels: pr.labels })),
			findings: project.deterministicFindings.map((finding) => finding.fingerprint),
			lessonsHash,
		};
		const inputHash = await sha256(stableJson(auditInput));
		const keyPrefix = `audits/projects/${project.repo.replace('/', '__')}`;
		const latestKey = `${keyPrefix}/latest.json`;
		const latest = await options.bucket.get(latestKey);
		if (latest) {
			const existing = JSON.parse(await latest.text()) as ProjectAudit;
			if (existing.inputHash === inputHash) {
				carriedForward.push(project.repo);
				results.push(existing);
				continue;
			}
		}

		const audit = await options.session.prompt(
			`You are MaintainerBot auditing one repository.

Use only the supplied project context. Do not invent files, issues, PRs, or TODOs.
Emit a concise audit with prioritized recommendations. Avoid rejected fingerprints.
Prefer small, reviewable actions. Do not claim draft PRs were created.

Project context JSON:
${JSON.stringify(project, null, 2)}

Rejected fingerprints:
${JSON.stringify([...options.rejected], null, 2)}

Shared lessons:
${options.lessons}`,
			{ role: 'maintainer', result: ProjectAuditSchema },
		);
		const normalized: ProjectAudit = {
			repo: project.repo,
			auditedAt: options.generatedAt,
			inputHash,
			status: audit.status,
			summary: audit.summary,
			recommendations: audit.recommendations.filter((item) => !options.rejected.has(item.fingerprint)),
			sharedLessons: audit.sharedLessons,
		};
		const historyKey = `${keyPrefix}/history/${options.generatedAt.replace(/[:.]/g, '-')}.json`;
		await options.bucket.put(latestKey, `${JSON.stringify(normalized, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
		await options.bucket.put(historyKey, `${JSON.stringify(normalized, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
		audited.push(project.repo);
		results.push(normalized);
	}

	if (options.bucket) {
		const index = {
			lastRunAt: options.generatedAt,
			audited,
			carriedForward,
			skipped,
			projects: Object.fromEntries(results.map((audit) => [audit.repo, {
				latestAuditKey: `audits/projects/${audit.repo.replace('/', '__')}/latest.json`,
				lastInputHash: audit.inputHash,
				lastAuditedAt: audit.auditedAt,
				status: audit.status,
			}])),
		};
		await options.bucket.put('audits/index.json', `${JSON.stringify(index, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
	}

	return { audited, carriedForward, skipped, results };
}

async function sha256(value: string) {
	const bytes = new TextEncoder().encode(value);
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown) {
	return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value: any, keys: Record<string, true> = {}) {
	if (value && typeof value === 'object') {
		for (const key of Object.keys(value)) {
			keys[key] = true;
			flattenKeys(value[key], keys);
		}
	}
	return keys;
}

async function writeReportToR2(bucket: R2BucketLike, report: MaintenanceReport) {
	const day = report.generatedAt.slice(0, 10);
	const markdown = renderMarkdown(report);
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const keys = [
		`MaintainerBotOut.md`,
		`MaintainerBotOut.json`,
		`reports/daily-maintenance-latest.md`,
		`reports/daily-maintenance-latest.json`,
		`reports/history/${day}/daily-maintenance.md`,
		`reports/history/${day}/daily-maintenance.json`,
	];
	await bucket.put(keys[0], markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
	await bucket.put(keys[1], json, { httpMetadata: { contentType: 'application/json' } });
	await bucket.put(keys[2], markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
	await bucket.put(keys[3], json, { httpMetadata: { contentType: 'application/json' } });
	await bucket.put(keys[4], markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
	await bucket.put(keys[5], json, { httpMetadata: { contentType: 'application/json' } });
	return keys;
}

function renderMarkdown(report: MaintenanceReport) {
	const sortedIssues = [...report.issues].sort(compareWorkItems);
	const sortedPrs = [...report.pullRequests].sort(compareWorkItems);
	const sortedCandidates = [...report.draftPrCandidates].sort(compareRecommendations);
	const inbox = buildActionInbox(sortedIssues, sortedPrs, sortedCandidates);
	const actionInbox = inbox.map((item, index) => `${index + 1}. ${item}`).join('\n\n') || 'No urgent actions today.';
	const auditSummary = renderAuditSummary(report.llmAudits);
	const candidates = sortedCandidates
		.map(
			(pr, index) =>
				`### ${index + 1}. [${pr.repo}](https://github.com/${pr.repo}): ${pr.title}\n\n- Fingerprint: \`${pr.fingerprint}\`\n- Risk: ${pr.risk}\n- Why it matters: ${pr.reason}\n- Suggested action: ${candidateAction(pr)}\n- Verification: ${pr.verification}\n`,
		)
		.join('\n') || 'No draft PR candidates.';
	const created = report.createdDraftPrs.map((pr) => `- ${pr.status}: ${pr.repo}${pr.url ? ` — ${pr.url}` : ''}${pr.reason ? ` — ${pr.reason}` : ''}`).join('\n') || '- No draft PRs created.';
	const prMd = sortedPrs.map((item) => workItemLine(item, 'PR')).join('\n') || '- No open PRs found.';
	const issueMd = sortedIssues.map((item) => workItemLine(item, 'issue')).join('\n') || '- No open issues found.';
	const bestPractices = report.bestPractices.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No best-practice findings.';
	const efficiency = report.efficiency.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No efficiency findings.';
	const codeQuality = report.codeQuality.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No code-quality findings.';
	const lessons = report.sharedLessons.map((lesson) => `- ${lesson}`).join('\n') || '- No shared lessons.';
	return `# MaintainerBot Status\n\nLast updated: ${report.generatedAt}\n\n## Action inbox\n\n${actionInbox}\n\n## LLM audit status\n\n${auditSummary}\n\n## Draft PR candidates\n\nDraft PR creation is ${report.createdDraftPrs.length ? 'active for this run' : 'disabled or produced no PRs'}.\n\n${candidates}\n\n## Open PRs needing review\n\n${prMd}\n\n## Open issues needing triage\n\n${issueMd}\n\n## Repo health fixes\n\n### Best practices\n\n${bestPractices}\n\n### Efficiency\n\n${efficiency}\n\n### Code quality\n\n${codeQuality}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Repositories scanned: ${report.repoCount}\n- Open issues: ${report.issues.length}\n- Open PRs: ${report.pullRequests.length}\n\n## Draft PR creation results\n\n${created}\n\n## Shared lessons\n\n${lessons}\n`;
}

function renderAuditSummary(audits: AuditRunSummary) {
	const audited = audits.audited.length ? audits.audited.map((repo) => `- Audited: [${repo}](https://github.com/${repo})`).join('\n') : '- No projects needed a fresh LLM audit.';
	const carried = audits.carriedForward.length ? audits.carriedForward.map((repo) => `- Carried forward: [${repo}](https://github.com/${repo})`).join('\n') : '- No carried-forward audits.';
	const skipped = audits.skipped.length ? `- Skipped ${audits.skipped.length} project(s) because no model/R2 audit path was available.` : '- No projects skipped.';
	return `${audited}\n${carried}\n${skipped}`;
}

function buildActionInbox(issues: WorkItem[], prs: WorkItem[], candidates: Recommendation[]) {
	const items: string[] = [];
	for (const issue of issues.slice(0, 4)) {
		items.push(`${priority(issue)} Triage issue [${issue.repo}#${issue.number}](${issue.url})\n   - Why: ${issueReason(issue)}\n   - Suggested action: ${issueAction(issue)}`);
	}
	for (const pr of prs.slice(0, 6)) {
		items.push(`${priority(pr)} Review PR [${pr.repo}#${pr.number}](${pr.url})\n   - Why: ${prReason(pr)}\n   - Suggested action: review, merge, request changes, or close`);
	}
	for (const candidate of candidates.slice(0, 5)) {
		items.push(`[P3] Candidate fix [${candidate.repo}](https://github.com/${candidate.repo}) — ${candidate.title}\n   - Why: ${candidate.reason}\n   - Suggested action: ${candidateAction(candidate)}`);
	}
	return items.slice(0, 12);
}

function compareWorkItems(a: WorkItem, b: WorkItem) {
	return priorityRank(priority(a)) - priorityRank(priority(b)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function compareRecommendations(a: Recommendation, b: Recommendation) {
	const risk = { high: 0, medium: 1, low: 2 };
	return risk[a.risk] - risk[b.risk] || a.repo.localeCompare(b.repo);
}

function priorityRank(value: string) {
	return value === '[P0]' ? 0 : value === '[P1]' ? 1 : value === '[P2]' ? 2 : 3;
}

function workItemLine(item: WorkItem, kind: 'issue' | 'PR') {
	const labels = item.labels.join(', ') || 'none';
	const why = kind === 'PR' ? prReason(item) : issueReason(item);
	const action = kind === 'PR' ? 'review, merge, request changes, or close' : issueAction(item);
	return `- ${priority(item)} [${item.repo}#${item.number}](${item.url}) — ${item.title}\n  - Why: ${why}\n  - Suggested action: ${action}\n  - Metadata: ${item.ageDays}d old, ${item.comments} comments, labels: ${labels}`;
}

function issueReason(item: WorkItem) {
	if (/p0|critical|security|credential/i.test(item.title)) return 'security/credential-related language suggests higher risk.';
	if (item.stale) return 'stale open issue needs a decision.';
	return 'open issue needs triage or a maintainer response.';
}

function issueAction(item: WorkItem) {
	if (/p0|critical|security|credential/i.test(item.title)) return 'label security/priority, confirm scope, and decide owner.';
	return 'label, confirm expected behavior, assign next action, or close.';
}

function prReason(item: WorkItem) {
	if (item.stale || item.ageDays > 60) return `open for ${item.ageDays} days and likely needs a merge/close decision.`;
	return 'open PR is awaiting maintainer review.';
}

function candidateAction(item: Recommendation) {
	return item.risk === 'low' ? 'approve for draft PR creation or apply manually.' : 'review manually before enabling draft PR creation.';
}

function linkRepoInText(value: string) {
	return value.replace(/(adewale\/[A-Za-z0-9_.-]+)/g, '[$1](https://github.com/$1)');
}

function buildDeterministicReport(repos: RepoSummary[], issues: WorkItem[], pullRequests: WorkItem[], rejected: Set<string>) {
	const needsDescription = repos.filter((repo) => !repo.description).slice(0, 10);
	const missingReadme = repos.filter((repo) => !repo.health.hasReadme).slice(0, 10);
	const missingLicense = repos.filter((repo) => !repo.health.hasLicense).slice(0, 10);
	const missingCi = repos.filter((repo) => repo.health.hasPackageJson && !repo.health.hasCi).slice(0, 10);
	const missingTests = repos.filter((repo) => repo.health.hasPackageJson && !repo.health.hasTests).slice(0, 10);
	const dependencyUnknown = repos.filter((repo) => repo.health.hasPackageJson && !repo.health.hasLockfile).slice(0, 10);
	const stale = repos.filter((repo) => repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) > 180 * 24 * 60 * 60 * 1000).slice(0, 10);
	const recommendations = [
		...needsDescription.map((repo) => recommendation(repo.fullName, 'metadata-description', 'Add or improve project description/documentation', 'Repository metadata appears incomplete from the scan.', 'Confirm README accurately states purpose and update GitHub description or docs.', 'low' as const)),
		...missingReadme.map((repo) => recommendation(repo.fullName, 'missing-readme', 'Add README documentation', 'Repository does not expose a README at the root.', 'Add README with purpose, setup, run/test commands, and maintenance notes.', 'low' as const)),
		...missingCi.map((repo) => recommendation(repo.fullName, 'missing-ci', 'Add basic CI checks', 'Package repository appears to lack GitHub Actions workflows.', 'Add a small CI workflow that installs dependencies and runs tests/build where available.', 'medium' as const)),
		...missingTests.map((repo) => recommendation(repo.fullName, 'missing-test-script', 'Add or document test command', 'Package repository does not advertise a test/check script.', 'Add a test/check script or document why no automated test exists.', 'medium' as const)),
		...stale.map((repo) => recommendation(repo.fullName, 'stale-repo-review', 'Review stale repository status', 'Repository has not been pushed recently.', 'Confirm whether the repo should be archived, refreshed, or documented as complete.', 'low' as const)),
	].filter((item) => !rejected.has(item.fingerprint));
	return {
		summary: `Scanned ${repos.length} public, non-fork, non-archived repositories updated since November 17, 2025. Found ${issues.length} open issues, ${pullRequests.length} open PRs, ${needsDescription.length} repos missing descriptions, ${missingReadme.length} missing READMEs, ${missingCi.length} package repos missing CI, and ${missingTests.length} package repos missing test/check scripts.`,
		priorityActions: [
			...issues.slice(0, 10).map((issue) => `${priority(issue)} Triage issue ${issue.repo}#${issue.number}: ${issue.title}`),
			...pullRequests.slice(0, 10).map((pr) => `${priority(pr)} Review PR ${pr.repo}#${pr.number}: ${pr.title}`),
			...needsDescription.slice(0, 5).map((repo) => `[P3] Add a concise GitHub description to ${repo.fullName}.`),
		].slice(0, 20),
		issues: issues.slice(0, 30),
		pullRequests: pullRequests.slice(0, 30),
		recommendations,
		draftPrCandidates: recommendations.slice(0, 8),
		createdDraftPrs: [],
		bestPractices: [
			...missingReadme.slice(0, 8).map((repo) => `${repo.fullName}: add or improve README.`),
			...missingLicense.slice(0, 8).map((repo) => `${repo.fullName}: clarify license if the project is meant for reuse.`),
		],
		efficiency: [
			...missingCi.slice(0, 8).map((repo) => `${repo.fullName}: add CI so maintenance checks run automatically.`),
			...dependencyUnknown.slice(0, 8).map((repo) => `${repo.fullName}: add/commit a lockfile or clarify package-manager choice.`),
		],
		codeQuality: [
			...missingTests.slice(0, 8).map((repo) => `${repo.fullName}: add a test/check script or document manual verification.`),
			...stale.slice(0, 8).map((repo) => `${repo.fullName}: review stale status and archive/refresh if needed.`),
		],
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

function priorityForRecommendation(item: Recommendation): 'P0' | 'P1' | 'P2' | 'P3' {
	if (/security|credential|p0|critical/i.test(`${item.title} ${item.reason}`)) return 'P0';
	if (item.risk === 'high') return 'P1';
	if (item.risk === 'medium') return 'P2';
	return 'P3';
}

function categoryForRecommendation(item: Recommendation): ProjectRecommendation['category'] {
	if (/ci|workflow|actions/i.test(item.title)) return 'ci';
	if (/test|check/i.test(item.title)) return 'tests';
	if (/readme|description|documentation|docs/i.test(item.title)) return 'docs';
	if (/stale|archive|refresh/i.test(item.title)) return 'cleanup';
	return 'investigation';
}

function priority(item: WorkItem) {
	if (item.stale) return '[P2]';
	if (item.labels.some((label) => /p0|critical|security/i.test(label)) || /p0|critical|security|credential/i.test(item.title)) return '[P0]';
	if (item.ageDays > 60) return '[P1]';
	return '[P3]';
}

function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function maybeCreateDraftPrs(report: MaintenanceReport, repos: RepoSummary[], env: Record<string, any>, headers: Record<string, string>, bucket?: R2BucketLike): Promise<CreatedDraftPr[]> {
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
	if (bucket) await appendCreatedPrLedger(bucket, results);
	return results;
}

async function appendCreatedPrLedger(bucket: R2BucketLike, results: CreatedDraftPr[]) {
	const created = results.filter((result) => result.status === 'created');
	if (!created.length) return;
	const key = 'data/created-prs.json';
	const existing = await bucket.get(key);
	const ledger = existing ? JSON.parse(await existing.text()) : { version: 1, created: [] };
	ledger.created.push(...created.map((result) => ({ ...result, createdAt: new Date().toISOString() })));
	await bucket.put(key, `${JSON.stringify(ledger, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
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

async function maybeSendEmail(report: MaintenanceReport, env: Record<string, any>) {
	if (env.EMAIL_DRY_RUN === 'true') return;
	if (!env.SEND_EMAIL || !env.EMAIL_TO || !env.EMAIL_FROM) return;
	// Use a dynamic import hidden from the Node/esbuild target. The module exists only in Cloudflare Workers.
	const { EmailMessage } = await new Function('return import("cloudflare:email")')();
	const subject = `MaintainerBot Daily Report — ${report.generatedAt.slice(0, 10)}`;
	const message = new EmailMessage(env.EMAIL_FROM, env.EMAIL_TO, rawEmail(env.EMAIL_FROM, env.EMAIL_TO, subject, renderMarkdown(report)));
	await env.SEND_EMAIL.send(message);
}

function rawEmail(from: string, to: string, subject: string, text: string) {
	const headers = [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: 8bit',
	];
	return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

async function ghOptional(url: string, headers: Record<string, string>): Promise<any | null> {
	const response = await fetch(url, { headers });
	if (!response.ok) return null;
	return await response.json();
}

async function gh(url: string, headers: Record<string, string>, method = 'GET', body?: unknown): Promise<any> {
	const response = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const text = await response.text();
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
	return text ? JSON.parse(text) : null;
}
