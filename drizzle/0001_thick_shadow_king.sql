CREATE TYPE "public"."entry_source" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."estimation_kind" AS ENUM('food', 'exercise');--> statement-breakpoint
CREATE TYPE "public"."intensity" AS ENUM('low', 'moderate', 'high');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TABLE "ai_estimations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"kind" "estimation_kind" NOT NULL,
	"input_hash" char(64) NOT NULL,
	"result" jsonb NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_estimations_confidence_check" CHECK ("ai_estimations"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "exercise_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_entry_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"exercise_name" varchar(255) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"intensity" "intensity",
	"calories_burned" numeric(10, 2) NOT NULL,
	"notes" text,
	"source" "entry_source" NOT NULL,
	"ai_estimation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_entries_duration_check" CHECK ("exercise_entries"."duration_minutes" > 0),
	CONSTRAINT "exercise_entries_calories_check" CHECK ("exercise_entries"."calories_burned" >= 0),
	CONSTRAINT "exercise_entries_source_check" CHECK (("exercise_entries"."source" = 'manual' and "exercise_entries"."ai_estimation_id" is null) or ("exercise_entries"."source" = 'ai' and "exercise_entries"."ai_estimation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "food_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_entry_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"food_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" varchar(50) NOT NULL,
	"calories" numeric(10, 2) NOT NULL,
	"protein_g" numeric(10, 2),
	"carbs_g" numeric(10, 2),
	"fat_g" numeric(10, 2),
	"source" "entry_source" NOT NULL,
	"ai_estimation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_entries_quantity_check" CHECK ("food_entries"."quantity" > 0),
	CONSTRAINT "food_entries_calories_check" CHECK ("food_entries"."calories" >= 0),
	CONSTRAINT "food_entries_macros_check" CHECK (("food_entries"."protein_g" is null or "food_entries"."protein_g" >= 0) and ("food_entries"."carbs_g" is null or "food_entries"."carbs_g" >= 0) and ("food_entries"."fat_g" is null or "food_entries"."fat_g" >= 0)),
	CONSTRAINT "food_entries_source_check" CHECK (("food_entries"."source" = 'manual' and "food_entries"."ai_estimation_id" is null) or ("food_entries"."source" = 'ai' and "food_entries"."ai_estimation_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai_estimations" ADD CONSTRAINT "ai_estimations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD CONSTRAINT "exercise_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD CONSTRAINT "exercise_entries_ai_estimation_id_ai_estimations_id_fk" FOREIGN KEY ("ai_estimation_id") REFERENCES "public"."ai_estimations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_ai_estimation_id_ai_estimations_id_fk" FOREIGN KEY ("ai_estimation_id") REFERENCES "public"."ai_estimations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_estimations_user_request_unique" ON "ai_estimations" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE INDEX "ai_estimations_user_created_idx" ON "ai_estimations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_entries_user_client_unique" ON "exercise_entries" USING btree ("user_id","client_entry_id");--> statement-breakpoint
CREATE INDEX "exercise_entries_user_date_idx" ON "exercise_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "exercise_entries_user_created_idx" ON "exercise_entries" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_entries_user_client_unique" ON "food_entries" USING btree ("user_id","client_entry_id");--> statement-breakpoint
CREATE INDEX "food_entries_user_date_idx" ON "food_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "food_entries_user_created_idx" ON "food_entries" USING btree ("user_id","created_at","id");