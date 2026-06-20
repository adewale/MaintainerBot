import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Local sandbox for HaikuBot.
//
// Eve's default sandbox auto-picks a backend (Vercel Sandbox / Docker /
// microsandbox / just-bash). Pinning `justbash()` forces the pure-local,
// in-process backend — no Docker, no remote — which also happens to be the
// same engine the original gist used by hand (`just-bash` + `InMemoryFs`).
//
// Subpath is `eve/sandbox/just-bash` (hyphenated) exporting `justbash` —
// verified against eve@0.11.8's package exports.
export default defineSandbox({
  backend: justbash(),
});
