# CalTrack API

Production-oriented backend for age-gated calorie and exercise tracking. It uses TypeScript, Fastify 5, Drizzle ORM, PostgreSQL, Redis, and the OpenAI Responses API. There is no frontend in this repository.

## WSL and Docker quick start

The supported development environment is WSL2 with Docker Desktop integration. All Node.js commands run in the Node 24 container, so a Windows or WSL host Node installation is not used.

```bash
cp .env.example .env
docker compose build api
docker compose up -d postgres redis
docker compose run --rm api npm run db:migrate
docker compose up api
```

The API listens on `http://localhost:3000`. Interactive Swagger documentation is at `http://localhost:3000/docs`; the generated OpenAPI JSON is at `http://localhost:3000/openapi.json`. PostgreSQL and Redis are exposed to WSL on ports `5433` and `6380`.

`GET /health` is process liveness. `GET /ready` returns 200 only when PostgreSQL, all expected migrations, and Redis are available.

## API conventions

- Application routes use `/v1`; operations and documentation routes are unversioned.
- Dates are local ISO calendar dates (`YYYY-MM-DD`); timestamps are UTC ISO-8601.
- Protected routes use `Authorization: Bearer <accessToken>`.
- Authentication tokens are returned in JSON for secure mobile storage.
- List cursors are opaque and `limit` is bounded to 100.
- Food and exercise creation require a client-generated UUID `clientEntryId` for retry-safe idempotency.
- AI requests require a client-generated UUID `requestKey`. Suggestions are never saved automatically.
- `netCalories = caloriesIn - caloriesOut`; `remainingCalories = goalCalories - netCalories`.

All failures use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [],
    "requestId": "req-1"
  }
}
```

## Endpoint reference

| Method         | Path                               | Purpose                                                       |
| -------------- | ---------------------------------- | ------------------------------------------------------------- |
| POST           | `/v1/auth/eligibility`             | Verify age 13+ and issue a short-lived eligibility token      |
| POST           | `/v1/auth/register`                | Register with an eligibility token                            |
| POST           | `/v1/auth/login`                   | Issue access and refresh tokens                               |
| POST           | `/v1/auth/refresh`                 | Rotate a refresh token with replay detection                  |
| POST           | `/v1/auth/logout`                  | Revoke a refresh token                                        |
| GET            | `/v1/users/me`                     | Get identity, age-band metadata, profile, and settings        |
| PUT            | `/v1/users/me/profile`             | Replace profile inputs and recalculate energy goals           |
| PUT            | `/v1/users/me/settings`            | Update time zone, units, and notification preferences         |
| DELETE         | `/v1/users/me`                     | Permanently purge the account and its data                    |
| POST/GET       | `/v1/food-entries`                 | Create/replay or cursor-list food entries                     |
| GET/PUT/DELETE | `/v1/food-entries/:id`             | Read, replace, or delete one owned food entry                 |
| POST/GET       | `/v1/exercise-entries`             | Create/replay or cursor-list exercise entries                 |
| GET/PUT/DELETE | `/v1/exercise-entries/:id`         | Read, replace, or delete one owned exercise entry             |
| GET            | `/v1/reports/summary`              | Daily, ISO-weekly, monthly, or custom (up to 366 days) report |
| POST           | `/v1/food-entries/ai-estimate`     | Return an editable nutrition suggestion                       |
| POST           | `/v1/exercise-entries/ai-estimate` | Extract exercise/MET and deterministically calculate calories |
| GET            | `/v1/ai/quota`                     | Return the combined user-local daily estimation quota         |

The Swagger document contains request/response schemas, examples, operation summaries, authentication requirements, and field validation. A typical entry request is:

```bash
curl -X POST http://localhost:3000/v1/food-entries \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "clientEntryId":"c8ef25f8-2850-44aa-849f-905841581966",
    "entryDate":"2026-07-21",
    "mealType":"lunch",
    "foodName":"Chicken rice",
    "quantity":1,
    "unit":"plate",
    "calories":560,
    "proteinG":32,
    "carbsG":65,
    "fatG":18
  }'
```

## Configuration

| Variable                   | Default                | Purpose                                                                         |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development`          | `development`, `test`, or `production`                                          |
| `HOST` / `PORT`            | `0.0.0.0` / `3000`     | Listener address                                                                |
| `LOG_LEVEL`                | `info`                 | Structured log level                                                            |
| `DATABASE_URL`             | local PostgreSQL URL   | PostgreSQL connection string                                                    |
| `REDIS_URL`                | local Redis URL        | Redis connection string                                                         |
| `JWT_SECRET`               | development-only value | JWT signing secret; a distinct production value is mandatory                    |
| `TOKEN_HASH_SECRET`        | development-only value | HMAC secret for tokens, inputs, and safety IDs; mandatory in production         |
| `REPORT_CACHE_TTL_SECONDS` | `300`                  | Report cache lifetime                                                           |
| `OPENAI_API_KEY`           | unset                  | Enables live AI estimation; not required for CI                                 |
| `OPENAI_MODEL`             | `gpt-5.6-luna`         | Responses API model                                                             |
| `OPENAI_TIMEOUT_MS`        | `15000`                | Provider timeout; SDK retries are bounded to two                                |
| `AI_DAILY_QUOTA`           | `5`                    | Combined food/exercise estimates per user-local day                             |
| `AI_CACHE_TTL_SECONDS`     | `604800`               | Normalized estimate cache lifetime (seven days)                                 |
| `CORS_ALLOWED_ORIGINS`     | empty                  | Comma-separated browser origin allowlist; origin-less mobile calls are accepted |
| `BODY_LIMIT_BYTES`         | `1048576`              | Maximum request body size                                                       |
| `REQUEST_TIMEOUT_MS`       | `30000`                | HTTP request timeout                                                            |
| `SHUTDOWN_TIMEOUT_MS`      | `10000`                | Maximum graceful shutdown period                                                |
| `TRUST_PROXY`              | `false`                | Trust proxy headers; enable only behind a configured trusted proxy              |
| `API_RATE_LIMIT_MAX`       | `300`                  | Per-IP requests per rate window                                                 |
| `AUTH_RATE_LIMIT_MAX`      | `20`                   | Stricter per-IP authentication-route limit                                      |
| `RATE_LIMIT_WINDOW`        | `1 minute`             | Rate-limit window                                                               |

Logs redact authorization/cookie headers and token/password field names. AI input descriptions are sent with `store: false`, are never logged or persisted, and are represented locally only by an HMAC. Redis quota failure disables AI calls to prevent uncontrolled provider spending.

## Quality and tests

Run the full local gate through Docker Compose:

```bash
docker compose run --rm api npm run format:check
docker compose run --rm api npm run lint
docker compose run --rm api npm run typecheck
docker compose run --rm api npm run db:check
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm test
docker compose run --rm api npm run test:performance
docker compose run --rm api npm run build
docker build --target production -t caltrack-api:test .
docker build --target migration -t caltrack-api-migration:test .
```

The performance command seeds 4,392 entries across a 366-day range, executes an uncached report, asserts the two-second target, and cleans up. CI uses a deterministic AI provider and requires no OpenAI secret. An explicitly manual live smoke call is available when a key is set:

```bash
docker compose run --rm -e OPENAI_API_KEY api npm run ai:smoke
```

## Database and deployment

Migrations are append-only SQL under `drizzle/`. Generate one after a schema change, inspect it, validate the migration history, then apply it:

```bash
docker compose run --rm --user 1000:1000 api npm run db:generate
docker compose run --rm api npm run db:check
docker compose run --rm api npm run db:migrate
```

For a production-like local deployment, populate `.env` with unique secrets and the CORS allowlist, then run:

```bash
docker compose --profile production up --build api-production
```

The production profile builds a non-root application image and a separate one-shot migration image. The API waits for successful migrations and healthy Redis, has a container health check, and receives a 15-second stop grace period. See [deployment operations](docs/deployment.md) for rollout, rollback, backup, and observability notes.
