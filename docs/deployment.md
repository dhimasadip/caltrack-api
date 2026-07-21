# Deployment operations

## Release sequence

1. Build immutable `production` and `migration` image targets from the same commit.
2. Back up PostgreSQL and verify restore procedures before applying a migration.
3. Run the migration image once. Migrations use PostgreSQL advisory locking through Drizzle and must finish successfully before new application tasks start.
4. Start application tasks with unique `JWT_SECRET` and `TOKEN_HASH_SECRET` values supplied by a secret manager.
5. Route traffic only after `/ready` is 200. Keep `/health` for process liveness.
6. Stop old tasks with at least the configured shutdown window so HTTP, PostgreSQL, and Redis connections close cleanly.

Do not place secrets in an image, Compose file, repository, or CI variables that are exposed to pull requests. `OPENAI_API_KEY` is optional: without it, non-AI features operate normally and AI endpoints return a controlled 503.

## Migration policy and rollback

Migration files are immutable after release. Prefer backward-compatible expand/migrate/contract changes: add new structures, deploy compatible code, backfill, and remove old structures only in a later release. Application rollback is safe only while its expected database contract remains present. Database rollback should use a reviewed corrective forward migration; restoring a backup is the disaster-recovery path.

Before deployment:

```bash
docker compose run --rm api npm run db:check
docker compose run --rm api npm run db:migrate
```

After deployment, `/ready` validates database connectivity, the minimum migration count for this release, and Redis connectivity.

## Scaling and proxies

The API is stateless apart from PostgreSQL and Redis, so multiple replicas can run behind a load balancer. Set `TRUST_PROXY=true` only when the service is reachable exclusively through a trusted proxy that overwrites forwarded headers; rate limits use the resulting client IP. Terminate TLS at the load balancer, use private database/cache networks, and keep CORS restricted to known browser applications.

Redis stores report versions/caches, AI caches, locks, and quota counters. Configure persistence and monitoring appropriate to the environment. AI estimation fails closed when Redis quota enforcement cannot be reached.

## Backups and observability

- Take encrypted PostgreSQL backups and regularly test point-in-time restoration.
- Monitor readiness, HTTP 5xx/429 rates, request latency, PostgreSQL pool pressure, Redis latency/errors, and graceful-shutdown failures.
- Alert on AI provider timeout/refusal/error rates and quota-enforcement availability without recording user descriptions.
- Centralize JSON logs. Authorization, cookie, password, and token fields are redacted, but access to logs should still be restricted.
- Capacity-test representative data before materially increasing pagination, custom-range, or body-size limits.

## Incident controls

Unset `OPENAI_API_KEY` to disable provider calls without taking tracking/reporting offline. Reduce `AI_DAILY_QUOTA` to lower spend. Restrict `CORS_ALLOWED_ORIGINS` during a browser-client incident. Rotate JWT and HMAC secrets using a coordinated session invalidation plan; changing them immediately invalidates outstanding tokens and hashes.
