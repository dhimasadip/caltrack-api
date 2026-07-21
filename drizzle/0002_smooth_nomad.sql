ALTER TABLE "exercise_entries" DROP CONSTRAINT "exercise_entries_ai_estimation_id_ai_estimations_id_fk";
--> statement-breakpoint
ALTER TABLE "food_entries" DROP CONSTRAINT "food_entries_ai_estimation_id_ai_estimations_id_fk";
--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD CONSTRAINT "exercise_entries_ai_estimation_id_ai_estimations_id_fk" FOREIGN KEY ("ai_estimation_id") REFERENCES "public"."ai_estimations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_ai_estimation_id_ai_estimations_id_fk" FOREIGN KEY ("ai_estimation_id") REFERENCES "public"."ai_estimations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_estimations" ADD CONSTRAINT "ai_estimations_token_usage_check" CHECK (("ai_estimations"."input_tokens" is null or "ai_estimations"."input_tokens" >= 0) and ("ai_estimations"."output_tokens" is null or "ai_estimations"."output_tokens" >= 0));--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_country_code_check" CHECK ("user_profiles"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_height_check" CHECK ("user_profiles"."height_cm" is null or "user_profiles"."height_cm" between 50 and 300);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_weight_check" CHECK ("user_profiles"."weight_kg" is null or "user_profiles"."weight_kg" between 20 and 500);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_target_weight_check" CHECK ("user_profiles"."target_weight_kg" is null or "user_profiles"."target_weight_kg" between 20 and 500);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_daily_goal_check" CHECK ("user_profiles"."daily_calorie_goal" is null or "user_profiles"."daily_calorie_goal" between 800 and 10000);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_suggested_goal_check" CHECK ("user_profiles"."suggested_calorie_goal" is null or "user_profiles"."suggested_calorie_goal" > 0);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_bmr_check" CHECK ("user_profiles"."bmr" is null or "user_profiles"."bmr" > 0);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_tdee_check" CHECK ("user_profiles"."tdee" is null or "user_profiles"."tdee" > 0);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_onboarding_check" CHECK (not "user_profiles"."onboarding_complete" or ("user_profiles"."gender" is not null and "user_profiles"."height_cm" is not null and "user_profiles"."weight_kg" is not null and "user_profiles"."activity_level" is not null and "user_profiles"."goal_type" is not null and "user_profiles"."daily_calorie_goal" is not null and "user_profiles"."calculation_method" is not null));
