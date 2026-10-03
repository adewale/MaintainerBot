import { describe, expect, it } from "vitest";
import { app, type DailyRunRequest } from "../src/app.ts";
import { FakeWorkflowBinding } from "./support/workflow-binding.ts";

const SECRET = "secret";

const request = (
  body: unknown,
  env: Record<string, unknown>,
  query = "",
  headers: Record<string, string> = {},
) =>
  app.request(
    `http://localhost/workflows/daily-maintenance${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );

const statusRequest = (
  runId: string,
  env: Record<string, unknown>,
  secret = SECRET,
) =>
  app.request(
    `http://localhost/workflows/daily-maintenance/${runId}`,
    { headers: { authorization: `Bearer ${secret}` } },
    env,
  );

const configured = (binding?: FakeWorkflowBinding<DailyRunRequest>) => ({
  MAINTAINERBOT_WEBHOOK_SECRET: SECRET,
  ...(binding ? { MAINTAINERBOT_DAILY: binding } : {}),
});

describe("POST /workflows/daily-maintenance", () => {
  it("fails closed when the webhook secret is not configured", async () => {
    const response = await request({ webhookSecret: SECRET }, {});
    expect(response.status).toBe(503);
  });

  it("rejects an incorrect webhook secret without starting a run", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request({ webhookSecret: "wrong" }, configured(binding));
    expect(response.status).toBe(401);
    expect(binding.created).toEqual([]);
  });

  it("rejects an incorrect bearer token without starting a run", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request({}, configured(binding), "", {
      authorization: "Bearer wrong",
    });
    expect(response.status).toBe(401);
    expect(binding.created).toEqual([]);
  });

  it("accepts the secret as a bearer token instead of in the body", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request({}, configured(binding), "", {
      authorization: `Bearer ${SECRET}`,
    });
    expect(response.status).toBe(202);
    expect(binding.created).toHaveLength(1);
  });

  it("rejects a payload that is not the documented shape", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request(
      { webhookSecret: 42 },
      configured(binding),
      "",
      { authorization: `Bearer ${SECRET}` },
    );
    expect(response.status).toBe(400);
    expect(binding.created).toEqual([]);
  });

  it("starts a Cloudflare Workflow without forwarding the secret", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request({ webhookSecret: SECRET }, configured(binding));

    expect(response.status).toBe(202);
    expect(binding.created).toHaveLength(1);
    const [{ id, params }] = binding.created;
    expect(params).toEqual({ runId: id, generatedAt: expect.any(String) });
    expect(JSON.stringify(params)).not.toContain(SECRET);
    expect(await response.json()).toEqual({
      ok: true,
      runId: id,
      status: "queued",
      statusUrl: `/workflows/daily-maintenance/${id}`,
    });
  });

  // The scheduled GitHub Action sends a fresh `Idempotency-Key: github-<run id>`
  // every day, so this is the production admission path.
  it("starts a new Workflow for an idempotency key it has not seen", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    const response = await request(
      { webhookSecret: SECRET },
      configured(binding),
      "",
      { "idempotency-key": "github-123" },
    );

    expect(response.status).toBe(202);
    expect(binding.created.map(({ id }) => id)).toEqual([
      "maintainerbot-github-123",
    ]);
    expect(await response.json()).toMatchObject({
      runId: "maintainerbot-github-123",
      statusUrl: "/workflows/daily-maintenance/maintainerbot-github-123",
    });
  });

  it("reuses an existing Workflow for the same idempotency key", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.seed("maintainerbot-github-123", [{ status: "running" }]);
    const response = await request(
      { webhookSecret: SECRET },
      configured(binding),
      "",
      { "idempotency-key": "github-123" },
    );

    expect(response.status).toBe(202);
    expect(binding.created).toEqual([]);
    expect(await response.json()).toMatchObject({
      runId: "maintainerbot-github-123",
    });
  });

  it("falls back to the concurrent run when create loses an idempotency race", async () => {
    // Production rejects a duplicate create; Miniflare returns the existing
    // instance instead, so this one case is scripted rather than contract-checked.
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.create = async ({ id }) => {
      binding.seed(id, [{ status: "running" }]);
      throw new Error("instance.already_exists");
    };
    const response = await request(
      { webhookSecret: SECRET },
      configured(binding),
      "",
      { "idempotency-key": "github-456" },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      runId: "maintainerbot-github-456",
    });
  });

  it("rejects an idempotency key that is unsafe as a Workflow id", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    for (const key of ["../escape", "has space", "x".repeat(129)]) {
      const response = await request(
        { webhookSecret: SECRET },
        configured(binding),
        "",
        { "idempotency-key": key },
      );
      expect(response.status, key).toBe(400);
    }
    expect(binding.created).toEqual([]);
  });

  it("returns a completed Workflow result when wait=result", async () => {
    const report = { ok: true, mode: "context-only-no-model" };
    const binding = new FakeWorkflowBinding<DailyRunRequest>(() => [
      { status: "running" },
      { status: "complete", output: report },
    ]);
    const response = await request(
      { webhookSecret: SECRET },
      configured(binding),
      "?wait=result",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
  });
});

describe("GET /workflows/daily-maintenance/:runId", () => {
  it("returns a pending status for an authenticated caller", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.seed("run-1", [{ status: "running" }]);
    const response = await statusRequest("run-1", configured(binding));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      runId: "run-1",
      status: "running",
    });
  });

  it("returns the Workflow output once it completes", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.seed("run-3", [{ status: "complete", output: { ok: true, n: 3 } }]);
    const response = await statusRequest("run-3", configured(binding));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, n: 3 });
  });

  it("rejects a caller with the wrong bearer token", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.seed("run-1", [{ status: "complete", output: { ok: true } }]);
    const response = await statusRequest("run-1", configured(binding), "wrong");
    expect(response.status).toBe(401);
  });

  it("makes a terminal Workflow failure fail the caller", async () => {
    const binding = new FakeWorkflowBinding<DailyRunRequest>();
    binding.seed("run-2", [
      { status: "errored", error: { name: "Error", message: "boom" } },
    ]);
    const response = await statusRequest("run-2", configured(binding));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      runId: "run-2",
      error: "boom",
    });
  });
});
