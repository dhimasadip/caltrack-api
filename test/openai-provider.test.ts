import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { AIProviderError } from '../src/modules/ai/ai-provider.js';
import { OpenAIProvider } from '../src/modules/ai/openai-provider.js';

const config = loadConfig({
  NODE_ENV: 'test',
  OPENAI_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-with-at-least-thirty-two-characters',
  TOKEN_HASH_SECRET: 'test-hash-secret-with-at-least-thirty-two-characters',
});

function providerFor(response: unknown, inspect?: (input: Record<string, unknown>) => void) {
  const client = {
    responses: {
      create: (input: Record<string, unknown>) => {
        inspect?.(input);
        return Promise.resolve(response);
      },
    },
  };
  return new OpenAIProvider(config, client as unknown as OpenAI);
}

describe('OpenAI estimation adapter', () => {
  it('uses stateless strict structured output and low reasoning', async () => {
    const provider = providerFor(
      {
        status: 'completed',
        model: 'gpt-5.6-luna',
        output_text: JSON.stringify({
          foodName: 'Apple',
          quantity: 1,
          unit: 'medium fruit',
          calories: 95,
          proteinG: 0.5,
          carbsG: 25,
          fatG: 0.3,
          confidence: 0.95,
          assumptions: [],
        }),
        output: [],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      (input) => {
        expect(input).toMatchObject({
          model: 'gpt-5.6-luna',
          store: false,
          reasoning: { effort: 'low' },
          safety_identifier: 'stable-hash',
          text: { format: { type: 'json_schema', strict: true } },
        });
      },
    );
    const estimate = await provider.estimateFood({
      description: 'One apple',
      safetyIdentifier: 'stable-hash',
    });
    expect(estimate.result.calories).toBe(95);
  });

  it('rejects schema-invalid provider output', async () => {
    const provider = providerFor({
      status: 'completed',
      model: 'gpt-5.6-luna',
      output_text: JSON.stringify({ calories: -10 }),
      output: [],
      usage: null,
    });
    await expect(
      provider.estimateFood({ description: 'Food', safetyIdentifier: 'hash' }),
    ).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('surfaces refusals without a usable result', async () => {
    const provider = providerFor({
      status: 'completed',
      model: 'gpt-5.6-luna',
      output_text: '',
      output: [
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Cannot help' }],
        },
      ],
      usage: null,
    });
    await expect(
      provider.estimateExercise({ description: 'Exercise', safetyIdentifier: 'hash' }),
    ).rejects.toBeInstanceOf(AIProviderError);
  });
});
