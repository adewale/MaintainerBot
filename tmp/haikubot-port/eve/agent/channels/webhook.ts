import { defineChannel } from "eve/channels";

// The original Flue bot was reached by an opaque webhook whose payload was
// `{ theme }`. Eve already exposes the agent over HTTP by default at
// POST /eve/v1/session, so strictly speaking this file is optional.
//
// It exists to preserve the *old contract*: POST a theme, get a haiku, without
// the caller having to know Eve's session envelope. The channel's only job is
// to normalise the inbound payload into a user message and hand it to the
// agent via `send`.
//
// NOTE: defineChannel's exact route handler signature is inferred from the Eve
// docs (which describe routes + an events map + a `send` call) rather than
// copied from a published example — treat this shape as approximate.
export default defineChannel({
  routes: {
    async POST(req, { send }) {
      const { theme, seed } = await req.json().catch(() => ({}));
      const seedLine = seed ? ` (random seed: ${seed})` : "";
      return send({
        message: theme
          ? `Write a haiku about: ${theme}.${seedLine}`
          : `Write a haiku.${seedLine}`,
      });
    },
  },
});
