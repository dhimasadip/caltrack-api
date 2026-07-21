import fp from 'fastify-plugin';

import type { AIProvider } from '../modules/ai/ai-provider.js';
import { OpenAIProvider, UnavailableAIProvider } from '../modules/ai/openai-provider.js';

export interface AIProviderPluginOptions {
  provider?: AIProvider;
}

export const aiProviderPlugin = fp<AIProviderPluginOptions>(async (app, options) => {
  const provider =
    options.provider ??
    (app.config.OPENAI_API_KEY === undefined
      ? new UnavailableAIProvider()
      : new OpenAIProvider(app.config));
  app.decorate('aiProvider', provider);
});
