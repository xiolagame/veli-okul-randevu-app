import { api } from '../services/api';
import { formatTryAmount } from './tr-currency';

export { formatTryAmount };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { amountMinor: number; fetchedAt: number } | null = null;

// Doğrulanmış fiyat yoksa null döner; arayüz asla tahmini fiyat göstermez.
export async function loadYearlyLicensePrice(signal?: AbortSignal): Promise<number | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.amountMinor;
  try {
    const { plans } = await api.getPublicPricing(signal);
    const plan = plans.find((item) => item.code === 'YEARLY_LICENSE');
    if (!plan || plan.currency !== 'TRY' || !Number.isInteger(plan.amountMinor) || plan.amountMinor <= 0) return null;
    cached = { amountMinor: plan.amountMinor, fetchedAt: Date.now() };
    return plan.amountMinor;
  } catch {
    return null;
  }
}

export function resetLicensePriceCacheForTests(): void {
  cached = null;
}
