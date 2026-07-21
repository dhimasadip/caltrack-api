import { describe, expect, it } from 'vitest';

import { ageOnDate, parseIsoDate } from '../src/lib/date.js';

describe('date utilities', () => {
  it('rejects impossible calendar dates', () => {
    expect(parseIsoDate('2025-02-29')).toBeNull();
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
  });

  it('handles leap-day birthdays consistently', () => {
    expect(ageOnDate('2008-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(17);
    expect(ageOnDate('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });
});
