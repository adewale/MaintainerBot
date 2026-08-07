import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  runDailyMaintenance,
  type MaintainerEnv,
} from "./maintenance/daily.ts";
import type { DailyRunRequest } from "./app.ts";

export class MaintainerDailyWorkflow extends WorkflowEntrypoint<
  MaintainerEnv,
  DailyRunRequest
> {
  async run(
    event: Readonly<WorkflowEvent<DailyRunRequest>>,
    step: WorkflowStep,
  ) {
    return await step.do(
      "run daily maintenance",
      {
        // This coarse step includes external writes and model admission. Do not replay it
        // automatically; operators can inspect/restart a failed Workflow deliberately.
        retries: { limit: 0, delay: "1 second" },
        timeout: "30 minutes",
      },
      async () => await runDailyMaintenance(this.env, event.payload),
    );
  }
}
