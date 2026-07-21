import { z } from 'zod';

import { isoDateSchema } from '../../lib/date.js';

export const reportQuerySchema = z
  .object({
    period: z.enum(['daily', 'weekly', 'monthly', 'custom']),
    anchor: isoDateSchema.optional(),
    start: isoDateSchema.optional(),
    end: isoDateSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.period === 'custom') {
      if (value.start === undefined || value.end === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Custom reports require `start` and `end`.',
        });
      }
    } else if (value.anchor === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Daily, weekly, and monthly reports require `anchor`.',
      });
    }
  });

export const dailyReportSchema = z.object({
  date: isoDateSchema,
  caloriesIn: z.number(),
  caloriesOut: z.number(),
  netCalories: z.number(),
  goalCalories: z.number().int(),
  remainingCalories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});

export const reportResponseSchema = z.object({
  range: z.object({
    period: z.enum(['daily', 'weekly', 'monthly', 'custom']),
    start: isoDateSchema,
    end: isoDateSchema,
  }),
  totals: z.object({
    days: z.number().int(),
    caloriesIn: z.number(),
    caloriesOut: z.number(),
    netCalories: z.number(),
    goalCalories: z.number().int(),
    remainingCalories: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
  series: z.array(dailyReportSchema),
});

export type ReportPeriod = z.infer<typeof reportQuerySchema>['period'];
export type ReportResponse = z.infer<typeof reportResponseSchema>;
