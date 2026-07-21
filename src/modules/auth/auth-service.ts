import { createHmac, randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { argon2id, hash as hashPassword, verify as verifyPassword } from 'argon2';

import { refreshTokens, userProfiles, users } from '../../db/schema.js';
import { AppError } from '../../errors/app-error.js';
import { ageOnDate } from '../../lib/date.js';

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const ELIGIBILITY_TOKEN_SECONDS = 15 * 60;

interface EligibilityClaims {
  type: 'eligibility';
  birthDate: string;
  countryCode: string;
}

interface AuthClaims {
  type: 'access' | 'refresh';
  sub: string;
  jti?: string;
  familyId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(app: FastifyInstance, token: string): string {
  return createHmac('sha256', app.config.TOKEN_HASH_SECRET).update(token).digest('hex');
}

async function issueTokenPair(
  app: FastifyInstance,
  userId: string,
  familyId = randomUUID(),
): Promise<TokenPair> {
  const tokenId = randomUUID();
  const accessToken = app.jwt.sign(
    { type: 'access' satisfies AuthClaims['type'], sub: userId },
    { expiresIn: ACCESS_TOKEN_SECONDS },
  );
  const refreshToken = app.jwt.sign(
    { type: 'refresh' satisfies AuthClaims['type'], sub: userId, jti: tokenId, familyId },
    { expiresIn: REFRESH_TOKEN_SECONDS },
  );

  await app.db.insert(refreshTokens).values({
    id: tokenId,
    userId,
    familyId,
    tokenHash: tokenHash(app, refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
    refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
  };
}

export function createEligibilityToken(
  app: FastifyInstance,
  birthDate: string,
  countryCode: string,
  now = new Date(),
): { eligibilityToken: string; expiresIn: number; minimumAge: number } {
  if (ageOnDate(birthDate, now) < 13) {
    throw new AppError(403, 'AGE_RESTRICTED', 'You must be at least 13 years old to register.');
  }

  return {
    eligibilityToken: app.jwt.sign(
      { type: 'eligibility', birthDate, countryCode } satisfies EligibilityClaims,
      { expiresIn: ELIGIBILITY_TOKEN_SECONDS },
    ),
    expiresIn: ELIGIBILITY_TOKEN_SECONDS,
    minimumAge: 13,
  };
}

export async function registerUser(
  app: FastifyInstance,
  input: { eligibilityToken: string; email: string; password: string },
): Promise<{ userId: string; profileComplete: false; tokens: TokenPair }> {
  let eligibility: EligibilityClaims;
  try {
    eligibility = app.jwt.verify<EligibilityClaims>(input.eligibilityToken);
  } catch {
    throw new AppError(
      401,
      'INVALID_ELIGIBILITY_TOKEN',
      'Eligibility token is invalid or expired.',
    );
  }

  if (eligibility.type !== 'eligibility' || ageOnDate(eligibility.birthDate) < 13) {
    throw new AppError(
      401,
      'INVALID_ELIGIBILITY_TOKEN',
      'Eligibility token is invalid or expired.',
    );
  }

  const passwordHashResult: unknown = await hashPassword(input.password, { type: argon2id });
  if (typeof passwordHashResult !== 'string') {
    throw new AppError(500, 'PASSWORD_HASH_FAILED', 'Password hashing failed.');
  }
  const passwordHash = passwordHashResult;
  const userId = randomUUID();

  try {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({ id: userId, email: normalizeEmail(input.email), passwordHash });
      await tx.insert(userProfiles).values({
        userId,
        birthDate: eligibility.birthDate,
        countryCode: eligibility.countryCode,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw error;
  }

  return { userId, profileComplete: false, tokens: await issueTokenPair(app, userId) };
}

export async function loginUser(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<{ userId: string; profileComplete: boolean; tokens: TokenPair }> {
  const [record] = await app.db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      profileComplete: userProfiles.onboardingComplete,
    })
    .from(users)
    .innerJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  if (record === undefined || !(await verifyPassword(record.passwordHash, password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  return {
    userId: record.id,
    profileComplete: record.profileComplete,
    tokens: await issueTokenPair(app, record.id),
  };
}

export async function rotateRefreshToken(app: FastifyInstance, token: string): Promise<TokenPair> {
  let claims: AuthClaims;
  try {
    claims = app.jwt.verify<AuthClaims>(token);
  } catch {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  if (claims.type !== 'refresh' || claims.jti === undefined || claims.familyId === undefined) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  const [stored] = await app.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.id, claims.jti))
    .limit(1);

  if (stored === undefined || stored.tokenHash !== tokenHash(app, token)) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  if (stored.revokedAt !== null) {
    await app.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, stored.userId), eq(refreshTokens.familyId, stored.familyId)),
      );
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse was detected.');
  }

  const nextId = randomUUID();
  const accessToken = app.jwt.sign(
    { type: 'access' satisfies AuthClaims['type'], sub: stored.userId },
    { expiresIn: ACCESS_TOKEN_SECONDS },
  );
  const refreshToken = app.jwt.sign(
    {
      type: 'refresh' satisfies AuthClaims['type'],
      sub: stored.userId,
      jti: nextId,
      familyId: stored.familyId,
    },
    { expiresIn: REFRESH_TOKEN_SECONDS },
  );

  await app.db.transaction(async (tx) => {
    const revoked = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedByTokenId: nextId })
      .where(and(eq(refreshTokens.id, stored.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });

    if (revoked.length !== 1) {
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse was detected.');
    }

    await tx.insert(refreshTokens).values({
      id: nextId,
      userId: stored.userId,
      familyId: stored.familyId,
      tokenHash: tokenHash(app, refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
    });
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
    refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
  };
}

export async function logoutUser(app: FastifyInstance, token: string): Promise<void> {
  await app.db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(refreshTokens.tokenHash, tokenHash(app, token)), isNull(refreshTokens.revokedAt)),
    );
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && (error as { code?: unknown }).code === '23505') return true;
  return 'cause' in error && isUniqueViolation((error as { cause?: unknown }).cause);
}
