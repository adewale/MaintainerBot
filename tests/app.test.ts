import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app.ts";

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
  secret = "secret",
) =>
  app.request(
    `http://localhost/workflows/daily-maintenance/${runId}`,
    { headers: { authorization: `Bearer ${secret}` } },
    env,
  );

describe("POST /workflows/daily-maintenance", () => {
  it("fails closed when the webhook secret is not configured", async () => {
    const response = await request({ webhookSecret: "secret" }, {});
    expect(response.status).toBe(503);
  });

  it("rejects an incorrect webhook secret", async () => {
    const response = await request(
      { webhookSecret: "wrong" },
      { MAINTAINERBOT_WEBHOOK_SECRET: "secret" },
    );
    expect(response.status).toBe(401);
  });

  it("starts a Cloudflare Workflow without forwarding the secret", async () => {
    const create = vi.fn(
      async ({
        id,
      }: {
        id: string;
        params: { runId: string; generatedAt: string };
      }) => ({ id, status: async () => ({ status: "queued" as const }) }),
    );
    const response = await request(
      { webhookSecret: "secret" },
      {
        MAINTAINERBOT_WEBHOOK_SECRET: "secret",
        MAINTAINERBOT_DAILY: { create, get: vi.fn() },
      },
    );

    expect(response.status).toBe(202);
    expect(create).toHaveBeenCalledOnce();
    const options = create.mock.calls[0][0];
    expect(options.params).toEqual({
      runId: options.id,
      generatedAt: expect.any(String),
    });
    expect(JSON.stringify(options.params)).not.toContain("secret");
  });

  it("reuses an existing Workflow for the same idempotency key", async () => {
    const existing = {
      id: "maintainerbot-github-123",
      status: async () => ({ status: "running" as const }),
    };
    const get = vi.fn(async () => existing);
    const create = vi.fn();
    const response = await request(
      { webhookSecret: "secret" },
      {
        MAINTAINERBOT_WEBHOOK_SECRET: "secret",
        MAINTAINERBOT_DAILY: { create, get },
      },
      "",
      { "idempotency-key": "github-123" },
    );

    expect(response.status).toBe(202);
    expect(get).toHaveBeenCalledWith("maintainerbot-github-123");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a completed Workflow result when wait=result", async () => {
    const report = { ok: true, mode: "context-only-no-model" };
    const create = vi.fn(async ({ id }: { id: string }) => ({
      id,
      status: async () => ({ status: "complete" as const, output: report }),
    }));
    const response = await request(
      { webhookSecret: "secret" },
      {
        MAINTAINERBOT_WEBHOOK_SECRET: "secret",
        MAINTAINERBOT_DAILY: { create, get: vi.fn() },
      },
      "?wait=result",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
  });
});

describe("GET /workflows/daily-maintenance/:runId", () => {
  it("returns a pending status for an authenticated caller", async () => {
    const get = vi.fn(async (id: string) => ({
      id,
      status: async () => ({ status: "running" as const }),
    }));
    const response = await statusRequest("run-1", {
      MAINTAINERBOT_WEBHOOK_SECRET: "secret",
      MAINTAINERBOT_DAILY: { create: vi.fn(), get },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      runId: "run-1",
      status: "running",
    });
  });

  it("makes a terminal Workflow failure fail the caller", async () => {
    const get = vi.fn(async (id: string) => ({
      id,
      status: async () => ({
        status: "errored" as const,
        error: { name: "Error", message: "boom" },
      }),
    }));
    const response = await statusRequest("run-2", {
      MAINTAINERBOT_WEBHOOK_SECRET: "secret",
      MAINTAINERBOT_DAILY: { create: vi.fn(), get },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      runId: "run-2",
      error: "boom",
    });
  });
});
