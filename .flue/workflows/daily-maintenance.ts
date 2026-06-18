import { createAgent, registerProvider, type FlueContext, type FlueSession, type WorkflowRouteHandler } from '@flue/runtime';
import * as v from 'valibot';

export const route: WorkflowRouteHandler = async (c, next) => {
	const configuredSecret = (c.env as MaintainerEnv | undefined)?.MAINTAINERBOT_WEBHOOK_SECRET;
	if (configuredSecret) {
		const body = await c.req.raw.clone().json().catch(() => null) as DailyPayload | null;
		if (body?.webhookSecret !== configuredSecret) return c.json({ ok: false, error: 'Unauthorized' }, 401);
	}
	await next();
};

type DailyPayload = { webhookSecret?: string } | undefined;

type MaintainerEnv = Record<string, any> & {
	MAINTAINERBOT_R2?: R2BucketLike;
};

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
	stateFingerprint: string;
	inputHash: string;
	rebuiltThisRun: boolean;
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

type BaseRepoSummary = Omit<RepoSummary, 'health' | 'openTodos'>;

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
	contextKey: string;
	promptVersion: string;
	model: string;
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

type RunContextBundle = {
	schemaVersion: 1;
	kind: 'maintainerbot.run-context';
	runId: string;
	generatedAt: string;
	owner: string;
	cutoff: string;
	promptVersion: string;
	model: string;
	deterministicSnapshot: {
		repos: RepoSummary[];
		openIssues: WorkItem[];
		openPullRequests: WorkItem[];
		deterministicRecommendations: Recommendation[];
	};
	projectBundles: Array<{
		repo: string;
		stateFingerprint: string;
		inputHash: string;
		r2Key: string;
		rebuiltThisRun: boolean;
		latestAuditKey?: string;
	}>;
	latestProjectAudits: ProjectAudit[];
};

type ContextSummary = {
	llmConfigured: boolean;
	rebuiltContextBundles: string[];
	reusedContextBundles: string[];
	projectsWithTodos: Array<{ repo: string; todos: string[] }>;
	healthGaps: {
		missingDescription: string[];
		missingLicense: string[];
		missingCi: string[];
		missingTests: string[];
	};
	projectContextRefs: Array<{ repo: string; inputHash: string; stateFingerprint: string; rebuiltThisRun: boolean; r2Key: string }>;
};

type MaintenanceReport = {
	ok: true;
	mode: 'llm-assisted' | 'context-only-no-model';
	runId: string;
	promptVersion: string;
	model: string;
	contextSummary: ContextSummary;
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

type ContextIndex = {
	version: 1;
	lastRunAt: string;
	projects: Record<string, {
		stateFingerprint: string;
		inputHash: string;
		latestContextKey: string;
		latestAuditKey?: string;
		lastBuiltAt: string;
	}>;
};

type PreparedContexts = {
	repos: RepoSummary[];
	projectContexts: ProjectContext[];
	rebuilt: string[];
	reused: string[];
};

type R2BucketLike = {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
	put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

const PROJECT_AUDIT_PROMPT_VERSION = 'project-audit-v2';
const RUN_SYNTHESIS_PROMPT_VERSION = 'run-synthesis-v2';
const DEFAULT_CUTOFF = '2025-11-17T00:00:00.000Z';

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

function defaultModel(env: Record<string, any>) {
	if (env.OPENAI_API_KEY) return 'openai/gpt-4.1-mini';
	if (env.OPENROUTER_API_KEY) return 'openrouter/anthropic/claude-3.5-haiku';
	return 'anthropic/claude-haiku-4-5';
}

function hasLlmCredentials(env: Record<string, any>) {
	return Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY);
}

function selectedModel(env: Record<string, any>) {
	return hasLlmCredentials(env) ? String(env.FLUE_MODEL || defaultModel(env)) : 'none';
}

function configureProviderOverrides(env: Record<string, any>) {
	if (!(env.CLOUDFLARE_ACCOUNT_ID && env.CF_AI_GATEWAY_ID && env.ANTHROPIC_API_KEY)) return;
	registerProvider('anthropic', {
		baseUrl: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/anthropic`,
		apiKey: env.ANTHROPIC_API_KEY,
		headers: env.CF_AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.CF_AI_GATEWAY_TOKEN}` } : undefined,
	});
}

const MAINTAINER_INSTRUCTIONS = `You are a senior open-source maintainer. Prioritize high-signal, low-risk improvements.

Review categories:
- Issues
- Pull requests
- Best practices and lessons learned
- Efficiency
- Code quality
- Shared lessons across repositories

Rules:
- Do not repeat rejected ideas.
- Prefer small draft PRs over large rewrites.
- Verify fixes with tests, builds, or clear static checks.
- If evidence is weak, recommend investigation instead of making a change.`;

const maintainerAgent = createAgent<DailyPayload, MaintainerEnv>(({ env }) => {
	configureProviderOverrides(env);
	const model = selectedModel(env);
	return {
		cwd: '/workspace',
		model: model === 'none' ? false : model,
		instructions: MAINTAINER_INSTRUCTIONS,
	};
});

export async function run({ init, env, payload }: FlueContext<DailyPayload, MaintainerEnv>) {
	const configuredSecret = env.MAINTAINERBOT_WEBHOOK_SECRET;
	if (configuredSecret && payload?.webhookSecret !== configuredSecret) return { ok: false, error: 'Unauthorized' };

	const hasModel = hasLlmCredentials(env);
	const model = selectedModel(env);
	const harness = await init(maintainerAgent);
	const session = await harness.session();

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

	await harness.fs.writeFile('/workspace/data/rejections.json', rejections);
	await harness.fs.writeFile('/workspace/data/lessons.md', lessons);

	const cutoff = DEFAULT_CUTOFF;
	const baseRepos = (await fetchRepos(owner, githubHeaders)).filter((repo) => repo.pushedAt && repo.pushedAt >= cutoff);
	const repoNames = new Set(baseRepos.map((repo) => repo.fullName));
	const issues = (await fetchSearchItems(`user:${owner} is:issue is:open`, githubHeaders)).filter((item) => repoNames.has(item.repo));
	const pullRequests = (await fetchSearchItems(`user:${owner} is:pr is:open`, githubHeaders)).filter((item) => repoNames.has(item.repo));

	const generatedAt = new Date().toISOString();
	const runId = generatedAt.replace(/[:.]/g, '-');
	const prepared = await prepareProjectContexts({
		bucket: reportsBucket,
		baseRepos,
		issues,
		pullRequests,
		rejected,
		lessons,
		generatedAt,
		headers: githubHeaders,
		owner,
	});
	const repos = prepared.repos;
	await harness.fs.writeFile('/workspace/reports/repo-summary.json', `${JSON.stringify(repos, null, 2)}\n`);
	const deterministic = buildDeterministicReport(repos, issues, pullRequests, rejected);
	const projectContexts = await finalizeProjectContexts({
		bucket: reportsBucket,
		prepared,
		repos,
		issues,
		pullRequests,
		recommendations: deterministic.recommendations,
		rejected,
		lessons,
		generatedAt,
	});

	const llmAudits = hasModel
		? await auditChangedProjects({
				bucket: reportsBucket,
				session,
				projectContexts,
				rejected,
				lessons,
				generatedAt,
				model,
			})
		: await loadExistingProjectAudits(reportsBucket, projectContexts, generatedAt);
	const auditRecommendations = llmAudits.results.flatMap((audit) => audit.recommendations).filter((item) => !rejected.has(item.fingerprint));
	const contextSummary = buildContextSummary({ repos, projectContexts, prepared, llmConfigured: hasModel });
	const runContext = buildRunContextBundle({ runId, generatedAt, owner, cutoff, model, repos, issues, pullRequests, deterministic, projectContexts, llmAudits });
	if (reportsBucket) await writeRunContextBundle(reportsBucket, runContext);
	const llmReport = hasModel ? await synthesizeRunReport(session, runContext, rejected, lessons) : null;
	const llmProjectRecommendations = llmReport?.projectRecommendations.filter((item) => !rejected.has(item.fingerprint)) ?? [];
	const manualActionCandidates = llmReport?.draftPrCandidates.filter((item) => !rejected.has(item.fingerprint)) ?? [];
	const mergedRecommendations = [...llmProjectRecommendations, ...auditRecommendations, ...deterministic.recommendations];

	const report: MaintenanceReport = {
		ok: true,
		mode: hasModel ? 'llm-assisted' : 'context-only-no-model',
		runId,
		promptVersion: hasModel ? RUN_SYNTHESIS_PROMPT_VERSION : 'no-llm-context-summary-v1',
		model,
		contextSummary,
		owner,
		repoCount: repos.length,
		generatedAt,
		...deterministic,
		summary: llmReport?.summary ?? `LLM is not configured. Built and stored ${projectContexts.length} project context bundle(s); showing deterministic facts and context summary only.`,
		priorityActions: llmReport?.priorityActions ?? deterministic.priorityActions.filter((action) => /issue|PR|TODO|failed|stale/i.test(action)),
		recommendations: mergedRecommendations,
		projectRecommendations: [...llmProjectRecommendations, ...auditRecommendations],
		draftPrCandidates: hasModel ? manualActionCandidates : [],
		sharedLessons: llmReport?.sharedLessons ?? deterministic.sharedLessons,
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

async function fetchRepos(owner: string, headers: Record<string, string>): Promise<BaseRepoSummary[]> {
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
	return baseRepos;
}

async function fetchOpenTodos(fullName: string, headers: Record<string, string>): Promise<string[]> {
	const candidates = ['TODO.md', 'TODOS.md', 'todo.md', 'todo.txt'];
	for (const path of candidates) {
		const file = await ghOptional(`https://api.github.com/repos/${fullName}/contents/${path}`, headers);
		if (file?.content) {
			try {
				return decodeBase64Text(String(file.content).replace(/\n/g, ''))
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

function decodeBase64Text(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
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

function rejectedFingerprints(rejectionsJson: string): Set<string> {
	try {
		return new Set<string>((JSON.parse(rejectionsJson).rejected ?? []).map((item: any) => String(item.fingerprint)));
	} catch {
		return new Set<string>();
	}
}

async function prepareProjectContexts(options: {
	bucket: R2BucketLike | undefined;
	baseRepos: BaseRepoSummary[];
	issues: WorkItem[];
	pullRequests: WorkItem[];
	rejected: Set<string>;
	lessons: string;
	generatedAt: string;
	headers: Record<string, string>;
	owner: string;
}): Promise<PreparedContexts> {
	const previousIndex = await readContextIndex(options.bucket);
	const memoryHash = await sha256(stableJson({ lessons: options.lessons, rejected: [...options.rejected].sort() }));
	const repos: RepoSummary[] = [];
	const projectContexts: ProjectContext[] = [];
	const rebuilt: string[] = [];
	const reused: string[] = [];

	for (const repo of options.baseRepos) {
		const stateFingerprint = await projectStateFingerprint(repo, options.issues, options.pullRequests, memoryHash);
		const previous = previousIndex.projects[repo.fullName];
		const previousContext = previous?.stateFingerprint === stateFingerprint ? await readJson<ProjectContext>(options.bucket, previous.latestContextKey) : null;
		if (previousContext) {
			repos.push({ ...repo, health: previousContext.health, openTodos: previousContext.openTodos });
			projectContexts.push({ ...previousContext, rebuiltThisRun: false });
			reused.push(repo.fullName);
			continue;
		}

		const health = await fetchRepoHealth(repo.fullName, options.headers);
		const openTodos = await fetchOpenTodos(repo.fullName, options.headers);
		repos.push({ ...repo, health, openTodos });
		rebuilt.push(repo.fullName);
	}

	return { repos, projectContexts, rebuilt, reused };
}

async function finalizeProjectContexts(options: {
	bucket: R2BucketLike | undefined;
	prepared: PreparedContexts;
	repos: RepoSummary[];
	issues: WorkItem[];
	pullRequests: WorkItem[];
	recommendations: Recommendation[];
	rejected: Set<string>;
	lessons: string;
	generatedAt: string;
}): Promise<ProjectContext[]> {
	const byRepo = new Map(options.prepared.projectContexts.map((context) => [context.repo, context]));
	for (const context of await buildProjectContexts(options.repos, options.issues, options.pullRequests, options.recommendations, options.rejected, options.lessons)) {
		const existing = byRepo.get(context.repo);
		if (existing && existing.stateFingerprint === context.stateFingerprint) continue;
		byRepo.set(context.repo, context);
	}
	const contexts = options.repos.map((repo) => byRepo.get(repo.fullName)).filter(Boolean) as ProjectContext[];
	if (options.bucket) await writeContextBundles(options.bucket, contexts, options.generatedAt);
	return contexts;
}

async function projectStateFingerprint(repo: BaseRepoSummary | RepoSummary, issues: WorkItem[], pullRequests: WorkItem[], memoryHash: string) {
	return sha256(stableJson({
		repo: repo.fullName,
		pushedAt: repo.pushedAt,
		description: repo.description,
		language: repo.language,
		defaultBranch: repo.defaultBranch,
		openIssues: repo.openIssues,
		issues: issues.filter((issue) => issue.repo === repo.fullName).map((issue) => [issue.number, issue.updatedAt, issue.title, issue.labels]).sort(),
		pullRequests: pullRequests.filter((pr) => pr.repo === repo.fullName).map((pr) => [pr.number, pr.updatedAt, pr.title, pr.labels]).sort(),
		memoryHash,
	}));
}

async function readContextIndex(bucket: R2BucketLike | undefined): Promise<ContextIndex> {
	const existing = await readJson<ContextIndex>(bucket, 'contexts/index.json');
	return existing ?? { version: 1, lastRunAt: '', projects: {} };
}

async function readJson<T>(bucket: R2BucketLike | undefined, key: string): Promise<T | null> {
	if (!bucket) return null;
	const existing = await bucket.get(key);
	if (!existing) return null;
	try {
		return JSON.parse(await existing.text()) as T;
	} catch {
		return null;
	}
}

async function writeContextBundles(bucket: R2BucketLike, contexts: ProjectContext[], generatedAt: string) {
	const runId = generatedAt.replace(/[:.]/g, '-');
	const index: ContextIndex = { version: 1, lastRunAt: generatedAt, projects: {} };
	for (const context of contexts) {
		const prefix = `contexts/projects/${context.repo.replace('/', '__')}`;
		const latestContextKey = `${prefix}/latest.json`;
		const historyKey = `${prefix}/history/${runId}.json`;
		if (context.rebuiltThisRun) {
			await bucket.put(latestContextKey, `${JSON.stringify(context, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
			await bucket.put(historyKey, `${JSON.stringify(context, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
		}
		index.projects[context.repo] = {
			stateFingerprint: context.stateFingerprint,
			inputHash: context.inputHash,
			latestContextKey,
			latestAuditKey: `audits/projects/${context.repo.replace('/', '__')}/latest.json`,
			lastBuiltAt: context.rebuiltThisRun ? generatedAt : context.lastPushed ?? generatedAt,
		};
	}
	await bucket.put('contexts/index.json', `${JSON.stringify(index, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
	await bucket.put(`contexts/runs/${runId}.json`, `${JSON.stringify({ generatedAt, projects: contexts.map((context) => ({ repo: context.repo, stateFingerprint: context.stateFingerprint, inputHash: context.inputHash, r2Key: `contexts/projects/${context.repo.replace('/', '__')}/latest.json`, rebuiltThisRun: context.rebuiltThisRun })) }, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
}

async function buildProjectContexts(
	repos: RepoSummary[],
	issues: WorkItem[],
	pullRequests: WorkItem[],
	recommendations: Recommendation[],
	rejected: Set<string>,
	lessons: string,
): Promise<ProjectContext[]> {
	const memoryHash = await sha256(stableJson({ lessons, rejected: [...rejected].sort() }));
	return await Promise.all(repos.map(async (repo) => {
		const stateFingerprint = await projectStateFingerprint(repo, issues, pullRequests, memoryHash);
		const base = {
			repo: repo.fullName,
			stateFingerprint,
			rebuiltThisRun: true,
			url: repo.url,
			description: repo.description,
			language: repo.language,
			lastPushed: repo.pushedAt,
			health: repo.health,
			openTodos: repo.openTodos,
			openIssues: issues.filter((issue) => issue.repo === repo.fullName),
			openPullRequests: pullRequests.filter((pr) => pr.repo === repo.fullName),
			deterministicFindings: recommendations.filter((item) => item.repo === repo.fullName && !rejected.has(item.fingerprint)),
		};
		return { ...base, inputHash: await sha256(stableJson(base)) };
	}));
}

function buildRunContextBundle(options: {
	runId: string;
	generatedAt: string;
	owner: string;
	cutoff: string;
	model: string;
	repos: RepoSummary[];
	issues: WorkItem[];
	pullRequests: WorkItem[];
	deterministic: ReturnType<typeof buildDeterministicReport>;
	projectContexts: ProjectContext[];
	llmAudits: AuditRunSummary;
}): RunContextBundle {
	return {
		schemaVersion: 1,
		kind: 'maintainerbot.run-context',
		runId: options.runId,
		generatedAt: options.generatedAt,
		owner: options.owner,
		cutoff: options.cutoff,
		promptVersion: RUN_SYNTHESIS_PROMPT_VERSION,
		model: options.model,
		deterministicSnapshot: {
			repos: options.repos,
			openIssues: options.issues,
			openPullRequests: options.pullRequests,
			deterministicRecommendations: options.deterministic.recommendations,
		},
		projectBundles: options.projectContexts.map((context) => ({
			repo: context.repo,
			stateFingerprint: context.stateFingerprint,
			inputHash: context.inputHash,
			r2Key: `contexts/projects/${context.repo.replace('/', '__')}/latest.json`,
			rebuiltThisRun: context.rebuiltThisRun,
			latestAuditKey: `audits/projects/${context.repo.replace('/', '__')}/latest.json`,
		})),
		latestProjectAudits: options.llmAudits.results,
	};
}

async function writeRunContextBundle(bucket: R2BucketLike, bundle: RunContextBundle) {
	await bucket.put(`contexts/runs/${bundle.runId}.json`, `${JSON.stringify(bundle, null, 2)}\n`, { httpMetadata: { contentType: 'application/json' } });
}

async function synthesizeRunReport(session: FlueSession, bundle: RunContextBundle, rejected: Set<string>, lessons: string): Promise<v.InferOutput<typeof ReportSchema>> {
	const response = await session.prompt(
		`Create today's read-only MaintainerBot handoff from this stored run context bundle.

Run context bundle JSON:
${JSON.stringify(bundle, null, 2)}

Rejected fingerprints:
${JSON.stringify([...rejected], null, 2)}

Lessons ledger:
${lessons}

Use only supplied facts. Do not invent repositories, files, issues, PRs, TODOs, CI results, code behavior, or verification results.
MaintainerBot is read-only: do not claim it created branches, commits, PRs, comments, labels, or other GitHub changes.
Lean on deterministic findings and latest project audits. Rank the human handoff by evidence, urgency, and likely impact.
If evidence is weak, recommend investigation rather than action.
Return concise, actionable recommendations with stable fingerprints and evidence.`,
		{ result: ReportSchema },
	);
	return response.data;
}

function buildContextSummary(options: { repos: RepoSummary[]; projectContexts: ProjectContext[]; prepared: PreparedContexts; llmConfigured: boolean }): ContextSummary {
	return {
		llmConfigured: options.llmConfigured,
		rebuiltContextBundles: options.prepared.rebuilt,
		reusedContextBundles: options.prepared.reused,
		projectsWithTodos: options.repos
			.filter((repo) => repo.openTodos.length > 0)
			.map((repo) => ({ repo: repo.fullName, todos: repo.openTodos.slice(0, 5) })),
		healthGaps: {
			missingDescription: options.repos.filter((repo) => !repo.description).map((repo) => repo.fullName),
			missingLicense: options.repos.filter((repo) => !repo.health.hasLicense).map((repo) => repo.fullName),
			missingCi: options.repos.filter((repo) => repo.health.hasPackageJson && !repo.health.hasCi).map((repo) => repo.fullName),
			missingTests: options.repos.filter((repo) => repo.health.hasPackageJson && !repo.health.hasTests).map((repo) => repo.fullName),
		},
		projectContextRefs: options.projectContexts.map((context) => ({
			repo: context.repo,
			inputHash: context.inputHash,
			stateFingerprint: context.stateFingerprint,
			rebuiltThisRun: context.rebuiltThisRun,
			r2Key: `contexts/projects/${context.repo.replace('/', '__')}/latest.json`,
		})),
	};
}

async function loadExistingProjectAudits(bucket: R2BucketLike | undefined, projectContexts: ProjectContext[], generatedAt: string): Promise<AuditRunSummary> {
	if (!bucket) return { audited: [], carriedForward: [], skipped: projectContexts.map((project) => project.repo), results: [] };
	const results: ProjectAudit[] = [];
	const carriedForward: string[] = [];
	const skipped: string[] = [];
	for (const project of projectContexts) {
		const key = `audits/projects/${project.repo.replace('/', '__')}/latest.json`;
		const audit = await readJson<ProjectAudit>(bucket, key);
		if (audit) {
			results.push(audit);
			carriedForward.push(project.repo);
		} else {
			skipped.push(project.repo);
		}
	}
	return { audited: [], carriedForward, skipped, results };
}

async function auditChangedProjects(options: {
	bucket: R2BucketLike | undefined;
	session: FlueSession;
	projectContexts: ProjectContext[];
	rejected: Set<string>;
	lessons: string;
	generatedAt: string;
	model: string;
}): Promise<AuditRunSummary> {
	if (!options.bucket) {
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

	for (const project of options.projectContexts) {
		const inputHash = project.inputHash;
		const keyPrefix = `audits/projects/${project.repo.replace('/', '__')}`;
		const latestKey = `${keyPrefix}/latest.json`;
		const contextKey = `contexts/projects/${project.repo.replace('/', '__')}/latest.json`;
		const latest = await options.bucket.get(latestKey);
		if (latest) {
			const existing = JSON.parse(await latest.text()) as ProjectAudit;
			if (existing.inputHash === inputHash) {
				carriedForward.push(project.repo);
				results.push(existing);
				continue;
			}
		}

		const { data: audit } = await options.session.prompt(
			`You are MaintainerBot auditing one repository.

Use only the supplied project context. Do not invent files, issues, PRs, or TODOs.
Emit a concise audit with prioritized recommendations. Avoid rejected fingerprints.
Prefer small, reviewable actions. Do not claim GitHub state was changed.

Project context JSON:
${JSON.stringify(project, null, 2)}

Rejected fingerprints:
${JSON.stringify([...options.rejected], null, 2)}

Shared lessons:
${options.lessons}`,
			{ result: ProjectAuditSchema },
		);
		const normalized: ProjectAudit = {
			repo: project.repo,
			auditedAt: options.generatedAt,
			inputHash,
			contextKey,
			promptVersion: PROJECT_AUDIT_PROMPT_VERSION,
			model: options.model,
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
	const modeNotice = report.mode === 'context-only-no-model'
		? `\n> **LLM not configured.** This is a degraded surface-audit report. MaintainerBot still built/reused context bundles and emitted deterministic facts, but no LLM synthesized recommendations.\n`
		: '';
	const contextMd = renderContextSummary(report.contextSummary);
	const auditSummary = renderAuditSummary(report.llmAudits, report.mode);
	const candidates = sortedCandidates
		.map(
			(pr, index) =>
				`### ${index + 1}. [${pr.repo}](https://github.com/${pr.repo}): ${pr.title}\n\n- Fingerprint: \`${pr.fingerprint}\`\n- Risk: ${pr.risk}\n- Why it matters: ${pr.reason}\n- Suggested action: ${candidateAction(pr)}\n- Verification: ${pr.verification}\n`,
		)
		.join('\n') || 'No manual action candidates.';
	const created = report.createdDraftPrs.map((pr) => `- ${pr.status}: ${pr.repo}${pr.url ? ` — ${pr.url}` : ''}${pr.reason ? ` — ${pr.reason}` : ''}`).join('\n') || '- Read-only mode: no GitHub mutations created.';
	const prMd = sortedPrs.map((item) => workItemLine(item, 'PR')).join('\n') || '- No open PRs found.';
	const issueMd = sortedIssues.map((item) => workItemLine(item, 'issue')).join('\n') || '- No open issues found.';
	const bestPractices = report.bestPractices.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No best-practice findings.';
	const efficiency = report.efficiency.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No efficiency findings.';
	const codeQuality = report.codeQuality.map((item) => `- ${linkRepoInText(item)}`).join('\n') || '- No code-quality findings.';
	const lessons = report.sharedLessons.map((lesson) => `- ${lesson}`).join('\n') || '- No shared lessons.';
	return `# MaintainerBot Status\n\nLast updated: ${report.generatedAt}\n${modeNotice}\n## Action inbox\n\n${actionInbox}\n\n## Loaded context\n\n${contextMd}\n\n## LLM audit status\n\n${auditSummary}\n\n## Manual action candidates\n\nMaintainerBot is read-only; these are suggestions for a human to apply.\n\n${candidates}\n\n## Open PRs needing review\n\n${prMd}\n\n## Open issues needing triage\n\n${issueMd}\n\n## Repo health fixes\n\n### Best practices\n\n${bestPractices}\n\n### Efficiency\n\n${efficiency}\n\n### Code quality\n\n${codeQuality}\n\n## Summary\n\n${report.summary}\n\n- Owner: ${report.owner}\n- Mode: ${report.mode}\n- Run ID: ${report.runId}\n- Model: ${report.model}\n- Repositories scanned: ${report.repoCount}\n- Open issues: ${report.issues.length}\n- Open PRs: ${report.pullRequests.length}\n\n## Read-only mutation status\n\n${created}\n\n## Shared lessons\n\n${lessons}\n`;
}

function renderContextSummary(summary: ContextSummary) {
	const todos = summary.projectsWithTodos.length
		? summary.projectsWithTodos.map((project) => `- [${project.repo}](https://github.com/${project.repo}): ${project.todos.slice(0, 3).join('; ')}`).join('\n')
		: '- No root TODO items found in loaded context.';
	const refs = summary.projectContextRefs.slice(0, 12).map((ref) => `- [${ref.repo}](https://github.com/${ref.repo}) — ${ref.rebuiltThisRun ? 'rebuilt' : 'reused'} context, input \`${ref.inputHash.slice(0, 12)}\``).join('\n') || '- No project context refs.';
	return `- LLM configured: ${summary.llmConfigured ? 'yes' : 'no'}\n- Context bundles rebuilt: ${summary.rebuiltContextBundles.length}\n- Context bundles reused: ${summary.reusedContextBundles.length}\n- Projects with root TODOs: ${summary.projectsWithTodos.length}\n- Missing descriptions: ${summary.healthGaps.missingDescription.length}\n- Missing licenses: ${summary.healthGaps.missingLicense.length}\n- Package repos missing CI: ${summary.healthGaps.missingCi.length}\n- Package repos missing tests/check scripts: ${summary.healthGaps.missingTests.length}\n\n### TODO-backed context\n\n${todos}\n\n### Project context refs\n\n${refs}`;
}

function renderAuditSummary(audits: AuditRunSummary, mode: MaintenanceReport['mode']) {
	const audited = audits.audited.length ? audits.audited.map((repo) => `- Audited: [${repo}](https://github.com/${repo})`).join('\n') : mode === 'llm-assisted' ? '- No projects needed a fresh LLM audit.' : '- No fresh LLM audits ran because no model is configured.';
	const carried = audits.carriedForward.length ? audits.carriedForward.map((repo) => `- Carried forward: [${repo}](https://github.com/${repo})`).join('\n') : '- No carried-forward audits.';
	const skipped = audits.skipped.length ? mode === 'llm-assisted' ? `- Skipped ${audits.skipped.length} project(s) because R2 audit persistence was unavailable.` : `- No previous LLM audit found for ${audits.skipped.length} project(s). Configure a model key to generate audits.` : '- No projects skipped.';
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
	return item.risk === 'low' ? 'consider applying manually after verification.' : 'review manually and gather more evidence before acting.';
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

async function maybeCreateDraftPrs(_report: MaintenanceReport, _repos: RepoSummary[], _env: Record<string, any>, _headers: Record<string, string>, _bucket?: R2BucketLike): Promise<CreatedDraftPr[]> {
	// MaintainerBot is intentionally read-only. It may recommend actions, but it must not
	// create branches, commits, pull requests, comments, labels, or other GitHub mutations.
	return [];
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
