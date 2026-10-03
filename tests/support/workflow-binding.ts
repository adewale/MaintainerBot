/**
 * In-memory stand-in for the Cloudflare Workflows binding (`MAINTAINERBOT_DAILY`).
 *
 * Its lookup semantics are not the author's belief: they are checked against
 * the real Workflows engine (Miniflare/workerd) by
 * tests/workflow-binding.contract.test.ts. In particular, `get()` for an id
 * that was never created rejects with `instance.not_found`; it does not return
 * an instance whose status is "unknown".
 */
export type FakeWorkflowStatus = {
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

type Instance = {
  id: string;
  params: unknown;
  statuses: FakeWorkflowStatus[];
};

export class FakeWorkflowBinding<Params = unknown> {
  readonly created: Array<{ id: string; params: Params }> = [];
  private readonly instances = new Map<string, Instance>();

  /** `statuses` are returned by successive `status()` calls; the last one repeats. */
  constructor(
    private readonly statusesForNewRun: () => FakeWorkflowStatus[] = () => [
      { status: "queued" },
    ],
  ) {}

  /** Adds an instance that already exists before the request under test. */
  seed(id: string, statuses: FakeWorkflowStatus[]) {
    this.instances.set(id, { id, params: undefined, statuses: [...statuses] });
  }

  async create({ id, params }: { id: string; params: Params }) {
    const existing = this.instances.get(id);
    if (existing) return this.handle(existing);
    const instance = { id, params, statuses: this.statusesForNewRun() };
    this.instances.set(id, instance);
    this.created.push({ id, params });
    return this.handle(instance);
  }

  async get(id: string) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error("instance.not_found");
    return this.handle(instance);
  }

  private handle(instance: Instance) {
    return {
      id: instance.id,
      status: async () =>
        instance.statuses.length > 1
          ? instance.statuses.shift()!
          : instance.statuses[0],
    };
  }
}
