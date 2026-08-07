import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) loadEnvFile(".env");

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const dataValue = option(args, "--data");
if (!dataValue) {
  console.error(
    'Usage: pnpm run deep:verify -- --data \'{"repo":"owner/name"}\' [--id <conversation-id>]',
  );
  process.exit(1);
}

let data: unknown;
try {
  data = JSON.parse(dataValue);
} catch {
  console.error("--data must be valid JSON.");
  process.exit(1);
}

const [{ init }, { start }, { DeepVerify }] = await Promise.all([
  import("@flue/runtime"),
  import("@flue/runtime/node"),
  import("../src/cli/deep-verify.ts"),
]);
const id = option(args, "--id") ?? `deep-verify-${Date.now()}`;
const flue = await start({ agents: [DeepVerify] });

try {
  const verifier = init(DeepVerify, { id });
  const receipt = await verifier.dispatch({
    initialData: data,
    message:
      "Run the read-only deep-verification workflow and submit the structured result.",
  });
  const reply = await verifier.read(receipt);
  const verification = reply.data.verification?.at(-1);
  if (!verification)
    throw new Error("The verifier did not submit a structured result.");
  console.log(
    JSON.stringify(
      {
        id,
        uid: reply.uid,
        submissionId: reply.submissionId,
        outcome: "completed",
        verification,
      },
      null,
      2,
    ),
  );
} finally {
  await flue.stop();
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
