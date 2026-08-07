import * as v from "valibot";

export const DailyPayloadSchema = v.object({
  webhookSecret: v.optional(v.string()),
});

export type DailyPayload = v.InferOutput<typeof DailyPayloadSchema>;

export const ProjectRecommendationSchema = v.object({
  fingerprint: v.string(),
  repo: v.string(),
  priority: v.picklist(["P0", "P1", "P2", "P3"]),
  category: v.picklist([
    "triage",
    "review",
    "docs",
    "ci",
    "tests",
    "cleanup",
    "investigation",
  ]),
  title: v.string(),
  evidence: v.array(v.string()),
  recommendedAction: v.string(),
  reason: v.string(),
  verification: v.string(),
  risk: v.picklist(["low", "medium", "high"]),
});

export const ProjectAuditResultSchema = v.object({
  kind: v.literal("project-audit"),
  status: v.picklist(["healthy", "needs_attention", "stale", "blocked"]),
  summary: v.string(),
  recommendations: v.array(ProjectRecommendationSchema),
  sharedLessons: v.array(v.string()),
});

export const RunSynthesisResultSchema = v.object({
  kind: v.literal("run-synthesis"),
  summary: v.string(),
  priorityActions: v.array(v.string()),
  draftPrCandidates: v.array(
    v.object({
      fingerprint: v.string(),
      repo: v.string(),
      title: v.string(),
      reason: v.string(),
      verification: v.string(),
      risk: v.picklist(["low", "medium", "high"]),
    }),
  ),
  projectRecommendations: v.array(ProjectRecommendationSchema),
  sharedLessons: v.array(v.string()),
});

export const AnalysisResultSchema = v.variant("kind", [
  ProjectAuditResultSchema,
  RunSynthesisResultSchema,
]);

export const AnalysisToolInputSchema = v.object({
  result: AnalysisResultSchema,
});

export type AnalysisResult = v.InferOutput<typeof AnalysisResultSchema>;
export type ProjectAuditResult = v.InferOutput<typeof ProjectAuditResultSchema>;
export type RunSynthesisResult = v.InferOutput<typeof RunSynthesisResultSchema>;

export const AnalysisAgentDataSchema = v.object({
  kind: v.picklist(["project-audit", "run-synthesis"]),
  model: v.string(),
});

export type AnalysisAgentData = v.InferOutput<typeof AnalysisAgentDataSchema>;
