import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Local sandbox for HaikuBot.
//
// Eve's default backend is whichever of Vercel Sandbox, Docker, microsandbox,
// or just-bash it resolves first. Pinning justbash() runs the sandbox in this
// Node process, so it needs no Docker daemon and no network call. It is the
// same engine the original gist imported directly (`just-bash` + `InMemoryFs`).
//
// The subpath is `eve/sandbox/just-bash` (hyphenated) and exports `justbash`.
// `eve/sandbox/justbash` throws ERR_PACKAGE_PATH_NOT_EXPORTED; checked against
// eve@0.11.8.
export default defineSandbox({
  backend: justbash(),
});
