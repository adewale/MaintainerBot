/**
 * Contract check for tests/support/workflow-binding.ts: the fake must agree
 * with the real Workflows engine on the lookups src/app.ts depends on.
 *
 * The real engine is Miniflare (workerd), which wrangler already ships; it is
 * resolved through wrangler so no extra dependency is needed. A wrangler
 * upgrade therefore also upgrades this engine: if this file starts failing
 * after one, the runtime's behavior (or Miniflare's options) changed, and the
 * fake and src/app.ts need to follow it.
 */
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeWorkflowBinding } from "./support/workflow-binding.ts";

type Binding = {
  create(options: { id: string; params: unknown }): Promise<{ id: string }>;
  get(id: string): Promise<{ id: string }>;
};

const WORKER = `
import { WorkflowEntrypoint } from "cloudflare:workers";
export class Probe extends WorkflowEntrypoint {
  async run(event, step) {
    return await step.do("echo", async () => event.payload);
  }
}
export default {
  async fetch(request, env) {
    const { op, id } = await request.json();
    try {
      const instance = op === "create"
        ? await env.WF.create({ id, params: { runId: id } })
        : await env.WF.get(id);
      return Response.json({ ok: true, id: instance.id });
    } catch (error) {
      return Response.json({ ok: false, message: String(error?.message ?? error) });
    }
  },
};
`;

type Miniflare = {
  dispatchFetch(url: string, init: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};
let miniflare: Miniflare;

// Exposes the real binding inside workerd as a Binding-shaped object.
const realBinding: Binding = {
  create: ({ id }) => call("create", id),
  get: (id) => call("get", id),
};

async function call(op: "create" | "get", id: string) {
  const response = await miniflare.dispatchFetch("http://probe/", {
    method: "POST",
    body: JSON.stringify({ op, id }),
  });
  const result = (await response.json()) as {
    ok: boolean;
    id?: string;
    message?: string;
  };
  if (!result.ok) throw new Error(result.message);
  return { id: result.id! };
}

beforeAll(async () => {
  const wrangler = createRequire(import.meta.url).resolve("wrangler");
  const { Miniflare } = await import(
    createRequire(wrangler).resolve("miniflare")
  );
  miniflare = new Miniflare({
    modules: true,
    script: WORKER,
    compatibilityDate: "2026-04-01",
    workflows: { WF: { name: "contract-probe", className: "Probe" } },
  });
}, 30_000);

afterAll(async () => {
  await miniflare?.dispose();
});

describe.each([
  ["Miniflare Workflows engine", () => realBinding],
  ["FakeWorkflowBinding", () => new FakeWorkflowBinding() as Binding],
])("Workflow binding contract: %s", (_name, makeBinding) => {
  it("rejects get() for an id that was never created", async () => {
    await expect(makeBinding().get("never-created")).rejects.toThrow(
      "instance.not_found",
    );
  });

  it("finds an instance by the id it was created with", async () => {
    const binding = makeBinding();
    const id = `run-${crypto.randomUUID()}`;
    expect((await binding.create({ id, params: { runId: id } })).id).toBe(id);
    expect((await binding.get(id)).id).toBe(id);
  });
});
