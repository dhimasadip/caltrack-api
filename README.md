# CalTrack API

Backend service for CalTrack, built with TypeScript, Fastify, PostgreSQL, Drizzle ORM, and Redis.

## WSL development

The development toolchain is containerized; a host Node.js installation is not required.

```bash
cp .env.example .env
docker compose build api
docker compose run --rm api npm run format:check
docker compose run --rm api npm run lint
docker compose run --rm api npm run typecheck
docker compose run --rm api npm test
docker compose up api
```

The API is available at `http://localhost:3000`, Swagger UI at `/docs`, and the OpenAPI document at `/openapi.json`.
PostgreSQL and Redis are exposed to WSL on ports `5433` and `6380` respectively.

Run database migrations before starting a new environment:

```bash
docker compose run --rm api npm run db:migrate
```

Authentication starts with `POST /v1/auth/eligibility`, followed by registration. Access tokens use the `Authorization: Bearer <token>` header for protected profile and settings routes.
