import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { setProvider } from "@flue/runtime";

export function configureProviderOverrides(
  env: Record<string, string | undefined> = process.env,
) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId = env.CF_AI_GATEWAY_ID;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!(accountId && gatewayId && apiKey)) return;

  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`;
  const gatewayToken = env.CF_AI_GATEWAY_TOKEN;
  setProvider(
    createProvider({
      id: "anthropic",
      auth: {
        apiKey: {
          name: "Anthropic through Cloudflare AI Gateway",
          resolve: async () => ({
            auth: {
              apiKey,
              headers: gatewayToken
                ? { "cf-aig-authorization": `Bearer ${gatewayToken}` }
                : undefined,
            },
            source: "ANTHROPIC_API_KEY",
          }),
        },
      },
      models: anthropicProvider()
        .getModels()
        .map((model) => ({ ...model, baseUrl })),
      api: anthropicMessagesApi(),
    }),
  );
}

configureProviderOverrides();
