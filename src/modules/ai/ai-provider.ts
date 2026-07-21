import { z } from 'zod';

export const foodEstimateSchema = z.object({
  foodName: z.string().trim().min(1).max(255),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(50),
  calories: z.number().min(0).max(100_000),
  proteinG: z.number().min(0).max(10_000).nullable(),
  carbsG: z.number().min(0).max(10_000).nullable(),
  fatG: z.number().min(0).max(10_000).nullable(),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const exerciseEstimateSchema = z.object({
  exerciseName: z.string().trim().min(1).max(255),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  intensity: z.enum(['low', 'moderate', 'high']),
  metValue: z.number().min(0.5).max(30),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
});

export type FoodEstimate = z.infer<typeof foodEstimateSchema>;
export type ExerciseEstimate = z.infer<typeof exerciseEstimateSchema>;

export interface AIProviderResult<T> {
  result: T;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AIProviderRequest {
  description: string;
  safetyIdentifier: string;
}

export interface AIProvider {
  estimateFood(request: AIProviderRequest): Promise<AIProviderResult<FoodEstimate>>;
  estimateExercise(request: AIProviderRequest): Promise<AIProviderResult<ExerciseEstimate>>;
}

export class AIProviderError extends Error {
  public constructor(
    public readonly reason: 'refused' | 'invalid_response' | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
