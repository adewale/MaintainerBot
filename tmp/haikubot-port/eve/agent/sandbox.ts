import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/justbash";

// Local sandbox for HaikuBot.
//
// Eve's default sandbox auto-picks a backend (Vercel Sandbox / Docker /
// microsandbox / just-bash). Pinning `justbash()` forces the pure-local,
// in-process backend — no Docker, no remote — which also happens to be the
// same engine the original gist used by hand (`just-bash` + `InMemoryFs`).
//
// NOTE: the `eve/sandbox/justbash` import path follows the documented pattern
// for `eve/sandbox/docker`; treat it as inferred rather than copied from a
// published example.
export default defineSandbox({
  backend: justbash(),
});
