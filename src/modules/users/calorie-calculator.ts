export type Gender = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain';

export interface CalorieCalculationInput {
  age: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
}

export interface CalorieCalculation {
  bmr: number | null;
  tdee: number;
  suggestedDailyCalorieGoal: number;
  method: 'dri_2023_eer' | 'mifflin_st_jeor';
  assumptions: string[];
}

const adultActivityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

type PediatricActivity = 'inactive' | 'low_active' | 'active' | 'very_active';

const pediatricActivityMap: Record<ActivityLevel, PediatricActivity> = {
  sedentary: 'inactive',
  light: 'low_active',
  moderate: 'active',
  active: 'active',
  very_active: 'very_active',
};

const pediatricMaleCoefficients: Record<PediatricActivity, [number, number, number]> = {
  inactive: [-447.51, 13.01, 13.15],
  low_active: [19.12, 8.62, 20.28],
  active: [-388.19, 12.66, 20.46],
  very_active: [-671.75, 15.38, 23.25],
};

const pediatricFemaleCoefficients: Record<PediatricActivity, [number, number, number]> = {
  inactive: [55.59, 8.43, 17.07],
  low_active: [-297.54, 12.77, 14.73],
  active: [-189.55, 11.74, 18.34],
  very_active: [-709.59, 18.22, 14.25],
};

function goalMultiplier(goalType: GoalType): number {
  if (goalType === 'lose') return 0.85;
  if (goalType === 'gain') return 1.1;
  return 1;
}

function pediatricEstimate(sex: 'male' | 'female', input: CalorieCalculationInput): number {
  const activity = pediatricActivityMap[input.activityLevel];
  const coefficients =
    sex === 'male' ? pediatricMaleCoefficients[activity] : pediatricFemaleCoefficients[activity];
  const [constant, heightCoefficient, weightCoefficient] = coefficients;
  const ageCoefficient = sex === 'male' ? 3.68 : -22.25;
  const growth = input.age < 14 ? (sex === 'male' ? 25 : 30) : 20;

  return (
    constant +
    ageCoefficient * input.age +
    heightCoefficient * input.heightCm +
    weightCoefficient * input.weightKg +
    growth
  );
}

function adultBmr(sex: 'male' | 'female', input: CalorieCalculationInput): number {
  const sexConstant = sex === 'male' ? 5 : -161;
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + sexConstant;
}

export function calculateCalories(input: CalorieCalculationInput): CalorieCalculation {
  const assumptions: string[] = [];

  if (input.age < 18) {
    const male = pediatricEstimate('male', input);
    const female = pediatricEstimate('female', input);
    const tdee =
      input.gender === 'male' ? male : input.gender === 'female' ? female : (male + female) / 2;

    if (input.gender === 'other') {
      assumptions.push('Used the midpoint of male and female DRI equations.');
    }
    assumptions.push('Pediatric DRI 2023 EER estimate; individual needs may differ.');

    return {
      bmr: null,
      tdee: Math.round(tdee),
      suggestedDailyCalorieGoal: Math.round(tdee * goalMultiplier(input.goalType)),
      method: 'dri_2023_eer',
      assumptions,
    };
  }

  const male = adultBmr('male', input);
  const female = adultBmr('female', input);
  const bmr =
    input.gender === 'male' ? male : input.gender === 'female' ? female : (male + female) / 2;
  const tdee = bmr * adultActivityMultipliers[input.activityLevel];

  if (input.gender === 'other') {
    assumptions.push('Used the midpoint of male and female Mifflin-St Jeor equations.');
  }
  assumptions.push('Mifflin-St Jeor estimate; individual needs may differ.');

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    suggestedDailyCalorieGoal: Math.round(tdee * goalMultiplier(input.goalType)),
    method: 'mifflin_st_jeor',
    assumptions,
  };
}
