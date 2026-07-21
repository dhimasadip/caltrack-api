import { createHash } from 'node:crypto';

import { loadConfig } from '../src/config.js';
import { OpenAIProvider } from '../src/modules/ai/openai-provider.js';

const config = loadConfig();
if (config.OPENAI_API_KEY === undefined) {
  throw new Error('OPENAI_API_KEY is required for the optional live smoke test.');
}

const provider = new OpenAIProvider(config);
const result = await provider.estimateFood({
  description: process.env.AI_SMOKE_DESCRIPTION ?? 'One medium banana',
  safetyIdentifier: createHash('sha256').update('caltrack-manual-smoke').digest('hex'),
});

console.log(
  JSON.stringify(
    {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      result: result.result,
    },
    null,
    2,
  ),
);
