"use agent";

import {
  useAgentFinish,
  useDataWriter,
  useInitialData,
  useModel,
  useTool,
} from "@flue/runtime";
import "../providers.ts";
import {
  AnalysisAgentDataSchema,
  AnalysisResultSchema,
  AnalysisToolInputSchema,
  type AnalysisAgentData,
} from "../maintenance/schemas.ts";

const INSTRUCTIONS = `You are MaintainerBot's structured analysis agent.

Use only the normalized evidence in the user message. Never invent repositories, files, issues, pull requests, TODOs, CI results, code behavior, or verification results. MaintainerBot is read-only: never claim it created or changed GitHub state. Prefer small, evidence-backed actions; when evidence is weak, recommend investigation.

Before recommending work, compare it with supplied open PRs and rejected fingerprints. A matching title is insufficient: cite the supplied evidence of overlap. Prefer reviewing or extending an existing PR when its scope fits; do not suggest a competing PR. Never resurrect a rejected proposal without new evidence that addresses its rejection. If the context lacks a PR diff or rejection rationale needed to decide, request that investigation instead of claiming overlap is proven.

For cleanup, identify a current cost and the behavior that must survive, then name a concrete verification step and the existing command, workflow, or module that owns it. Do not invent an owner. Put incident regression checks at the boundary that owns the failure; another schedule or wrapper needs evidence of distinct coverage. Similar commands alone do not establish redundancy. There is no quota: empty recommendations and draftPrCandidates arrays are valid when nothing actionable is supported. Keep necessary independent checks and documented operational constraints.

You must finish by calling submit_analysis_result exactly once with the requested result kind. Do not provide the final result only as prose.`;

export function ReportAnalyst() {
  const request = useInitialData<AnalysisAgentData>();
  useModel(request.model);
  const writeAnalysisResult = useDataWriter("analysis-result", {
    schema: AnalysisResultSchema,
  });

  useTool({
    name: "submit_analysis_result",
    description: `Submit the final ${request.kind} result. This is the only way to complete the analysis.`,
    input: AnalysisToolInputSchema,
    run({ data }) {
      if (data.result.kind !== request.kind)
        throw new Error(
          `Expected a ${request.kind} result, received ${data.result.kind}.`,
        );
      writeAnalysisResult(data.result);
      return { output: "Structured analysis submitted.", terminate: true };
    },
  });

  useAgentFinish(({ response, append }) => {
    const submitted = response.toolCalls.some(
      (call) => call.tool === "submit_analysis_result" && !call.isError,
    );
    if (submitted) return;
    append({
      kind: "signal",
      type: "analysis.result.required",
      body: `Your response is incomplete. Call submit_analysis_result with a valid ${request.kind} result now.`,
    });
  });

  return INSTRUCTIONS;
}

ReportAnalyst.agentName = "report-analyst";
ReportAnalyst.initialData = AnalysisAgentDataSchema;
ReportAnalyst.durability = { maxAttempts: 5, timeoutMs: 30 * 60 * 1000 };
