import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "test") return { plugins: [] };
  const fluePlugin = flue();
  return {
    plugins:
      mode === "cloudflare"
        ? [fluePlugin, cloudflare({ config: flueWorkerConfig() })]
        : [fluePlugin],
  };
});
