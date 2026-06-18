import { createAgent, type FlueContext } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

// CLI-only, read-only workflow. Intended for local or GitHub Actions use via:
// flue run deep-verify --target node --payload '{"repo":"adewale/project"}'

const CUTOFF = '2025-11-17T00:00:00.000Z';

const PayloadSchema = v.object({
	repo: v.string(),
	ref: v.optional(v.string()),
});

type DeepVerifyPayload = v.InferOutput<typeof PayloadSchema>;

const PlanSchema = v.object({
	commands: v.array(v.string()),
	rationale: v.string(),
});

const VerificationSchema = v.object({
	status: v.picklist(['verified', 'failed', 'skipped']),
	summary: v.string(),
	commandsRun: v.array(v.string()),
	findings: v.array(
		v.object({
			severity: v.picklist(['info', 'warning', 'failure']),
			title: v.string(),
			evidence: v.array(v.string()),
			recommendedAction: v.string(),
		}),
	),
	cliOnlyOpportunities: v.array(v.string()),
});

type RepoApiResponse = { pushed_at?: string; clone_url?: string; default_branch?: string };

const verifierAgent = createAgent<DeepVerifyPayload, Record<string, any>>(({ env }) => ({
	model: String(env.FLUE_MODEL || 'anthropic/claude-haiku-4-5'),
	sandbox: local(),
	instructions: `You are MaintainerBot's CLI-only deep verifier. Stay read-only with respect to GitHub: never push, open PRs, comment, label, or mutate remote state. Prefer existing project checks over speculative commands. Summarize concrete evidence and skipped checks honestly.`,
}));

function headers(env: Record<string, any>) {
	const result: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'MaintainerBot',
	};
	if (env.GITHUB_TOKEN) result.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
	return result;
}

export async function run({ init, payload, env }: FlueContext<DeepVerifyPayload>) {
	const parsedPayload = v.parse(PayloadSchema, payload);
	const repo = String(parsedPayload.repo || '');
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('payload.repo must be owner/name');

	const metadataResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(env) });
	if (!metadataResponse.ok) throw new Error(`Failed to fetch ${repo}: HTTP ${metadataResponse.status}`);
	const metadata = (await metadataResponse.json()) as RepoApiResponse;
	if (!metadata.pushed_at || metadata.pushed_at < CUTOFF) {
		return { ok: true, repo, skipped: true, reason: `Repository has not changed since ${CUTOFF}`, pushedAt: metadata.pushed_at };
	}

	const agent = await init(verifierAgent);
	const session = await agent.session();
	const ref = String(parsedPayload.ref || metadata.default_branch || 'main');
	const cloneUrl = metadata.clone_url || `https://github.com/${repo}.git`;

	await session.shell(`rm -rf /tmp/maintainerbot-deep-verify && mkdir -p /tmp/maintainerbot-deep-verify`);
	await session.shell(`git clone --depth 1 --branch ${JSON.stringify(ref)} ${JSON.stringify(cloneUrl)} /tmp/maintainerbot-deep-verify/repo`);

	const inventory = await session.shell(
		`cd /tmp/maintainerbot-deep-verify/repo && find . -maxdepth 2 -type f \\
\t\t\t\( -name package.json -o -name pnpm-lock.yaml -o -name package-lock.json -o -name bun.lockb -o -name pyproject.toml -o -name README.md -o -name TODO.md -o -path './.github/workflows/*' \\
\t\t\t\) | sort | head -200`,
	);
	const packageJson = await session.shell(`cd /tmp/maintainerbot-deep-verify/repo && if [ -f package.json ]; then cat package.json; fi`);

	const { data: plan } = await session.prompt(
		`Plan up to five safe verification commands for ${repo}@${ref}.

Repository pushed at: ${metadata.pushed_at}

Inventory:
${inventory.stdout}

package.json:
${packageJson.stdout || '(none)'}

Return only commands that start with pnpm, npm, bun, node, or python3 and are appropriate to run inside the temporary clone. Prefer existing test/check/build scripts.`,
		{ result: PlanSchema },
	);

	const commandsRun: string[] = [];
	const commandOutputs: string[] = [];
	for (const command of plan.commands.slice(0, 5)) {
		if (!/^(pnpm|npm|bun|node|python3)( |$)/.test(command)) continue;
		commandsRun.push(command);
		const result = await session.shell(`cd /tmp/maintainerbot-deep-verify/repo && ${command}`);
		commandOutputs.push(`$ ${command}\nexit=${result.exitCode}\n${`${result.stdout}\n${result.stderr}`.slice(-6000)}`);
	}

	const { data: verification } = await session.prompt(
		`Summarize this read-only verification run.

Repository: ${repo}
Ref: ${ref}
Pushed at: ${metadata.pushed_at}
Plan:
${JSON.stringify(plan, null, 2)}

Commands run:
${JSON.stringify(commandsRun, null, 2)}

Command outputs:
${commandOutputs.join('\n\n---\n\n') || '(none)'}

Classify status as verified only when relevant checks passed, failed when relevant checks failed, and skipped when no meaningful checks ran.`,
		{ result: VerificationSchema },
	);

	return { ok: true, repo, ref, pushedAt: metadata.pushed_at, ...verification };
}
