import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().default('postgres://caltrack:caltrack@localhost:5432/caltrack'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32).default('local-development-jwt-secret-change-me'),
  TOKEN_HASH_SECRET: z.string().min(32).default('local-development-token-hash-secret'),
  REPORT_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6-luna'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  AI_DAILY_QUOTA: z.coerce.number().int().min(1).max(100).default(5),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(604_800),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
