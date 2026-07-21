import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const genderEnum = pgEnum('gender', ['male', 'female', 'other']);
export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);
export const goalTypeEnum = pgEnum('goal_type', ['lose', 'maintain', 'gain']);
export const unitSystemEnum = pgEnum('unit_system', ['metric', 'imperial']);
export const calculationMethodEnum = pgEnum('calculation_method', [
  'dri_2023_eer',
  'mifflin_st_jeor',
]);
export const entrySourceEnum = pgEnum('entry_source', ['manual', 'ai']);
export const mealTypeEnum = pgEnum('meal_type', ['breakfast', 'lunch', 'dinner', 'snack']);
export const intensityEnum = pgEnum('intensity', ['low', 'moderate', 'high']);
export const estimationKindEnum = pgEnum('estimation_kind', ['food', 'exercise']);

const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    ...auditColumns,
  },
  (table) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`)],
);

export interface NotificationPreferences {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  weighIn: boolean;
}

export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    birthDate: date('birth_date').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    gender: genderEnum('gender'),
    heightCm: numeric('height_cm', { precision: 6, scale: 2 }),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    activityLevel: activityLevelEnum('activity_level'),
    goalType: goalTypeEnum('goal_type'),
    targetWeightKg: numeric('target_weight_kg', { precision: 6, scale: 2 }),
    targetDate: date('target_date'),
    dailyCalorieGoal: integer('daily_calorie_goal'),
    suggestedCalorieGoal: integer('suggested_calorie_goal'),
    bmr: numeric('bmr', { precision: 8, scale: 2 }),
    tdee: numeric('tdee', { precision: 8, scale: 2 }),
    calculationMethod: calculationMethodEnum('calculation_method'),
    calculationAssumptions: jsonb('calculation_assumptions')
      .$type<string[]>()
      .notNull()
      .default([]),
    timeZone: varchar('time_zone', { length: 64 }).notNull().default('UTC'),
    unitSystem: unitSystemEnum('unit_system').notNull().default('metric'),
    notificationPreferences: jsonb('notification_preferences')
      .$type<NotificationPreferences>()
      .notNull()
      .default({ breakfast: false, lunch: false, dinner: false, weighIn: false }),
    onboardingComplete: boolean('onboarding_complete').notNull().default(false),
    ...auditColumns,
  },
  (table) => [
    check('user_profiles_country_code_check', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'user_profiles_height_check',
      sql`${table.heightCm} is null or ${table.heightCm} between 50 and 300`,
    ),
    check(
      'user_profiles_weight_check',
      sql`${table.weightKg} is null or ${table.weightKg} between 20 and 500`,
    ),
    check(
      'user_profiles_target_weight_check',
      sql`${table.targetWeightKg} is null or ${table.targetWeightKg} between 20 and 500`,
    ),
    check(
      'user_profiles_daily_goal_check',
      sql`${table.dailyCalorieGoal} is null or ${table.dailyCalorieGoal} between 800 and 10000`,
    ),
    check(
      'user_profiles_suggested_goal_check',
      sql`${table.suggestedCalorieGoal} is null or ${table.suggestedCalorieGoal} > 0`,
    ),
    check('user_profiles_bmr_check', sql`${table.bmr} is null or ${table.bmr} > 0`),
    check('user_profiles_tdee_check', sql`${table.tdee} is null or ${table.tdee} > 0`),
    check(
      'user_profiles_onboarding_check',
      sql`not ${table.onboardingComplete} or (${table.gender} is not null and ${table.heightCm} is not null and ${table.weightKg} is not null and ${table.activityLevel} is not null and ${table.goalType} is not null and ${table.dailyCalorieGoal} is not null and ${table.calculationMethod} is not null)`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByTokenId: uuid('replaced_by_token_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_unique').on(table.tokenHash),
    index('refresh_tokens_user_family_idx').on(table.userId, table.familyId),
  ],
);

export const aiEstimations = pgTable(
  'ai_estimations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestKey: uuid('request_key').notNull(),
    kind: estimationKindEnum('kind').notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cached: boolean('cached').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_estimations_user_request_unique').on(table.userId, table.requestKey),
    index('ai_estimations_user_created_idx').on(table.userId, table.createdAt),
    check('ai_estimations_confidence_check', sql`${table.confidence} between 0 and 1`),
    check(
      'ai_estimations_token_usage_check',
      sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
    ),
  ],
);

export const foodEntries = pgTable(
  'food_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientEntryId: uuid('client_entry_id').notNull(),
    entryDate: date('entry_date').notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    foodName: varchar('food_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unit: varchar('unit', { length: 50 }).notNull(),
    calories: numeric('calories', { precision: 10, scale: 2 }).notNull(),
    proteinG: numeric('protein_g', { precision: 10, scale: 2 }),
    carbsG: numeric('carbs_g', { precision: 10, scale: 2 }),
    fatG: numeric('fat_g', { precision: 10, scale: 2 }),
    source: entrySourceEnum('source').notNull(),
    aiEstimationId: uuid('ai_estimation_id').references(() => aiEstimations.id, {
      onDelete: 'restrict',
    }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('food_entries_user_client_unique').on(table.userId, table.clientEntryId),
    index('food_entries_user_date_idx').on(table.userId, table.entryDate),
    index('food_entries_user_created_idx').on(table.userId, table.createdAt, table.id),
    check('food_entries_quantity_check', sql`${table.quantity} > 0`),
    check('food_entries_calories_check', sql`${table.calories} >= 0`),
    check(
      'food_entries_macros_check',
      sql`(${table.proteinG} is null or ${table.proteinG} >= 0) and (${table.carbsG} is null or ${table.carbsG} >= 0) and (${table.fatG} is null or ${table.fatG} >= 0)`,
    ),
    check(
      'food_entries_source_check',
      sql`(${table.source} = 'manual' and ${table.aiEstimationId} is null) or (${table.source} = 'ai' and ${table.aiEstimationId} is not null)`,
    ),
  ],
);

export const exerciseEntries = pgTable(
  'exercise_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientEntryId: uuid('client_entry_id').notNull(),
    entryDate: date('entry_date').notNull(),
    exerciseName: varchar('exercise_name', { length: 255 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    intensity: intensityEnum('intensity'),
    caloriesBurned: numeric('calories_burned', { precision: 10, scale: 2 }).notNull(),
    notes: text('notes'),
    source: entrySourceEnum('source').notNull(),
    aiEstimationId: uuid('ai_estimation_id').references(() => aiEstimations.id, {
      onDelete: 'restrict',
    }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('exercise_entries_user_client_unique').on(table.userId, table.clientEntryId),
    index('exercise_entries_user_date_idx').on(table.userId, table.entryDate),
    index('exercise_entries_user_created_idx').on(table.userId, table.createdAt, table.id),
    check('exercise_entries_duration_check', sql`${table.durationMinutes} > 0`),
    check('exercise_entries_calories_check', sql`${table.caloriesBurned} >= 0`),
    check(
      'exercise_entries_source_check',
      sql`(${table.source} = 'manual' and ${table.aiEstimationId} is null) or (${table.source} = 'ai' and ${table.aiEstimationId} is not null)`,
    ),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  refreshTokens: many(refreshTokens),
  foodEntries: many(foodEntries),
  exerciseEntries: many(exerciseEntries),
  aiEstimations: many(aiEstimations),
}));

export const profileRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const refreshTokenRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const foodEntryRelations = relations(foodEntries, ({ one }) => ({
  user: one(users, { fields: [foodEntries.userId], references: [users.id] }),
  estimation: one(aiEstimations, {
    fields: [foodEntries.aiEstimationId],
    references: [aiEstimations.id],
  }),
}));

export const exerciseEntryRelations = relations(exerciseEntries, ({ one }) => ({
  user: one(users, { fields: [exerciseEntries.userId], references: [users.id] }),
  estimation: one(aiEstimations, {
    fields: [exerciseEntries.aiEstimationId],
    references: [aiEstimations.id],
  }),
}));

export const aiEstimationRelations = relations(aiEstimations, ({ one, many }) => ({
  user: one(users, { fields: [aiEstimations.userId], references: [users.id] }),
  foodEntries: many(foodEntries),
  exerciseEntries: many(exerciseEntries),
}));
