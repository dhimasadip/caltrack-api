import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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

export const userProfiles = pgTable('user_profiles', {
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
  calculationAssumptions: jsonb('calculation_assumptions').$type<string[]>().notNull().default([]),
  timeZone: varchar('time_zone', { length: 64 }).notNull().default('UTC'),
  unitSystem: unitSystemEnum('unit_system').notNull().default('metric'),
  notificationPreferences: jsonb('notification_preferences')
    .$type<NotificationPreferences>()
    .notNull()
    .default({ breakfast: false, lunch: false, dinner: false, weighIn: false }),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  ...auditColumns,
});

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

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  refreshTokens: many(refreshTokens),
}));

export const profileRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const refreshTokenRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
