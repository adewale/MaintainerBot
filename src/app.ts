import { Hono } from "hono";
import * as v from "valibot";
import {
  runDailyMaintenance,
  type MaintainerEnv,
} from "./maintenance/daily.ts";
import {
  DailyPayloadSchema,
  type DailyPayload,
} from "./maintenance/schemas.ts";

type WorkflowStatus = {
  status:
    | "queued"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "unknown";
  error?: { name: string; message: string };
  output?: unknown;
};

type WorkflowInstance = {
  id: string;
  status(): Promise<WorkflowStatus>;
};

type DailyWorkflowBinding = {
  create(options: {
    id: string;
    params: DailyRunRequest;
  }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
};

export type DailyRunRequest = {
  runId: string;
  generatedAt: string;
};

type AppBindings = MaintainerEnv & {
  MAINTAINERBOT_DAILY?: DailyWorkflowBinding;
};

export const app = new Hono<{ Bindings: AppBindings }>();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/workflows/daily-maintenance", async (c) => {
  const env = { ...process.env, ...(c.env ?? {}) } as AppBindings;
  const configuredSecret = env.MAINTAINERBOT_WEBHOOK_SECRET;
  if (!configuredSecret)
    return c.json(
      { ok: false, error: "Webhook secret is not configured." },
      503,
    );

  const rawPayload = await c.req.json().catch(() => null);
  const parsed = v.safeParse(DailyPayloadSchema, rawPayload);
  if (!parsed.success)
    return c.json({ ok: false, error: "Invalid request payload." }, 400);
  const payload: DailyPayload = parsed.output;
  if (
    !authorized(
      c.req.header("authorization"),
      payload.webhookSecret,
      configuredSecret,
    )
  )
    return c.json({ ok: false, error: "Unauthorized" }, 401);

  const generatedAt = new Date().toISOString();
  const idempotencyKey = c.req.header("idempotency-key");
  if (idempotencyKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))
    return c.json({ ok: false, error: "Invalid Idempotency-Key header." }, 400);
  const runId = idempotencyKey
    ? `maintainerbot-${idempotencyKey}`
    : `${generatedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const request = { runId, generatedAt };

  if (!env.MAINTAINERBOT_DAILY) {
    const report = await runDailyMaintenance(env, request);
    return c.json(report);
  }

  const instance = await createOrGetWorkflow(
    env.MAINTAINERBOT_DAILY,
    request,
    Boolean(idempotencyKey),
  );
  const statusUrl = `/workflows/daily-maintenance/${encodeURIComponent(runId)}`;
  if (c.req.query("wait") !== "result")
    return c.json({ ok: true, runId, status: "queued", statusUrl }, 202);

  const deadline = Date.now() + 25_000;
  do {
    const status = await instance.status();
    if (status.status === "complete")
      return c.json(status.output ?? { ok: true, runId });
    if (status.status === "errored" || status.status === "terminated") {
      return c.json(
        {
          ok: false,
          runId,
          status: status.status,
          error: status.error?.message ?? `Workflow ${status.status}.`,
        },
        500,
      );
    }
    await delay(250);
  } while (Date.now() < deadline);

  return c.json({ ok: true, runId, status: "running", statusUrl }, 202);
});

app.get("/workflows/daily-maintenance/:runId", async (c) => {
  const env = { ...process.env, ...(c.env ?? {}) } as AppBindings;
  const configuredSecret = env.MAINTAINERBOT_WEBHOOK_SECRET;
  if (!configuredSecret)
    return c.json(
      { ok: false, error: "Webhook secret is not configured." },
      503,
    );
  if (!authorized(c.req.header("authorization"), undefined, configuredSecret))
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  if (!env.MAINTAINERBOT_DAILY)
    return c.json(
      { ok: false, error: "Workflow binding is not configured." },
      503,
    );

  const instance = await env.MAINTAINERBOT_DAILY.get(c.req.param("runId"));
  const status = await instance.status();
  if (status.status === "complete")
    return c.json(status.output ?? { ok: true, runId: instance.id });
  if (status.status === "errored" || status.status === "terminated") {
    return c.json(
      {
        ok: false,
        runId: instance.id,
        status: status.status,
        error: status.error?.message ?? `Workflow ${status.status}.`,
      },
      500,
    );
  }
  return c.json({ ok: true, runId: instance.id, status: status.status }, 202);
});

async function createOrGetWorkflow(
  binding: DailyWorkflowBinding,
  request: DailyRunRequest,
  idempotent: boolean,
) {
  if (idempotent) {
    const existing = await binding.get(request.runId);
    if ((await existing.status()).status !== "unknown") return existing;
  }
  try {
    return await binding.create({ id: request.runId, params: request });
  } catch (error) {
    if (!idempotent) throw error;
    return await binding.get(request.runId);
  }
}

function authorized(
  header: string | undefined,
  payloadSecret: string | undefined,
  configuredSecret: string,
) {
  const bearer = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : undefined;
  return payloadSecret === configuredSecret || bearer === configuredSecret;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default app;
