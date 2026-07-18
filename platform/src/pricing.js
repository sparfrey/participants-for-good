/* One source of truth for the transparent split. The same numbers appear on
   estimates, invoices, and the public open books. Amounts in cents. */

export const TIERS = {
  gen:      { label: 'General population', ops_cents: 3500 },
  targeted: { label: 'Targeted',           ops_cents: 5500 },
  hard:     { label: 'Hard to reach',      ops_cents: 8500 }
};

export const METHODS = {
  interview: { label: 'Interview',      perMinute: 1.45 },
  usability: { label: 'Usability test', perMinute: 1.35 },
  survey:    { label: 'Survey',         perMinute: 0.7 },
  diary:     { label: 'Diary study',    perMinute: 1.8 }
};

const roundTo5Dollars = (cents) => Math.round(cents / 500) * 500;

export function suggestedIncentiveCents(method, lengthMin) {
  const rate = (METHODS[method] || METHODS.interview).perMinute;
  return Math.max(1000, roundTo5Dollars(lengthMin * rate * 100));
}

export function contributionCents(incentiveCents) {
  return roundTo5Dollars(incentiveCents * 0.6);
}

export function estimate({ method, lengthMin, needed, tier, incentiveCents }) {
  const t = TIERS[tier] || TIERS.targeted;
  const incentive = Math.max(1000, incentiveCents || suggestedIncentiveCents(method, lengthMin));
  const contribution = contributionCents(incentive);
  const perSession = incentive + contribution + t.ops_cents;
  const backups = Math.max(1, Math.ceil(needed * 0.15));
  return {
    incentive, contribution, ops: t.ops_cents, perSession,
    backups, total: perSession * (needed + backups)
  };
}

export const QUOTA_VARIABLES = {
  income_under50: 'Household income under $50k',
  rural: 'Lives in a rural area',
  multilingual: 'Speaks 2+ languages',
  assistive: 'Uses assistive technology',
  age55: 'Age 55 or older',
  first_time: 'First-time research participant'
};
