import { z } from 'zod';

import { AppError } from '../errors/app-error.js';

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
}
