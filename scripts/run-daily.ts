import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start, type Flue } from "@flue/runtime/node";
import { ReportAnalyst } from "../src/agents/report-analyst.ts";
import {
  renderMarkdown,
  runDailyMaintenance,
} from "../src/maintenance/daily.ts";

const root = process.cwd();
const reportsDir = join(root, "reports");
await mkdir(reportsDir, { recursive: true });

const hasModel = Boolean(
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENROUTER_API_KEY,
);
let flue: Flue | undefined;

try {
  if (hasModel) flue = await start({ agents: [ReportAnalyst] });
  const report = await runDailyMaintenance(process.env);
  const markdown = renderMarkdown(report);
  const today = report.generatedAt.slice(0, 10);

  await Promise.all([
    writeFile(
      join(reportsDir, "daily-maintenance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(
      join(reportsDir, `daily-maintenance-${today}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(join(reportsDir, "daily-maintenance.md"), markdown),
    writeFile(join(reportsDir, `daily-maintenance-${today}.md`), markdown),
    writeFile("/tmp/MaintainerBotOut.md", markdown),
  ]);

  console.log("Saved primary report: /tmp/MaintainerBotOut.md");
  console.log("Saved reports/daily-maintenance.md");
  console.log("Saved reports/daily-maintenance.json");
  console.log(`Repos scanned: ${report.repoCount}`);
} finally {
  await flue?.stop();
}
