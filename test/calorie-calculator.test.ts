import { describe, expect, it } from 'vitest';

import { calculateCalories } from '../src/modules/users/calorie-calculator.js';

describe('calculateCalories', () => {
  it('uses pediatric DRI EER for a 13-year-old', () => {
    const result = calculateCalories({
      age: 13,
      gender: 'male',
      heightCm: 160,
      weightKg: 50,
      activityLevel: 'moderate',
      goalType: 'maintain',
    });

    expect(result.method).toBe('dri_2023_eer');
    expect(result.bmr).toBeNull();
    expect(result.tdee).toBeGreaterThan(2_000);
    expect(result.suggestedDailyCalorieGoal).toBe(result.tdee);
  });

  it('applies the selected loss adjustment for a 17-year-old', () => {
    const result = calculateCalories({
      age: 17,
      gender: 'female',
      heightCm: 165,
      weightKg: 60,
      activityLevel: 'light',
      goalType: 'lose',
    });

    expect(result.method).toBe('dri_2023_eer');
    expect(result.suggestedDailyCalorieGoal).toBe(Math.round(result.tdee * 0.85));
  });

  it('switches to Mifflin-St Jeor at age 18', () => {
    const result = calculateCalories({
      age: 18,
      gender: 'male',
      heightCm: 180,
      weightKg: 75,
      activityLevel: 'active',
      goalType: 'gain',
    });

    expect(result.method).toBe('mifflin_st_jeor');
    expect(result.bmr).not.toBeNull();
    expect(result.suggestedDailyCalorieGoal).toBe(Math.round(result.tdee * 1.1));
  });

  it('uses midpoint assumptions for gender other', () => {
    const result = calculateCalories({
      age: 30,
      gender: 'other',
      heightCm: 170,
      weightKg: 70,
      activityLevel: 'sedentary',
      goalType: 'maintain',
    });

    expect(result.assumptions[0]).toContain('midpoint');
  });
});
