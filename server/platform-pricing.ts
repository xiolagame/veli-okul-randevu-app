import { Router } from 'express';
import type { AuthenticatedRequest } from './auth';
import { getDb } from './database/postgres';

export const PRICING_PLAN_CODES = ['YEARLY_LICENSE'] as const;
export type PricingPlanCode = (typeof PRICING_PLAN_CODES)[number];

export interface PlanPrice {
  code: PricingPlanCode;
  amountMinor: number;
  currency: 'TRY';
  revision: number;
  updatedAt: string;
}

const MAX_AMOUNT_MINOR = 100_000_000;

function mapPrice(row: { plan_code: PricingPlanCode; amount_minor: number; currency: string; revision: number; updated_at: Date | string }): PlanPrice {
  return {
    code: row.plan_code,
    amountMinor: Number(row.amount_minor),
    currency: 'TRY',
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function listPrices(): Promise<PlanPrice[]> {
  const db = await getDb();
  const result = await db.query<any>(
    'SELECT plan_code, amount_minor, currency, revision, updated_at FROM platform_pricing ORDER BY plan_code',
  );
  return result.rows.map(mapPrice);
}

// Herkese açık, yalnızca okuma. Yönetim alanı veya kullanıcı verisi döndürmez.
export const publicPricingRouter = Router();
publicPricingRouter.get('/', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ plans: await listPrices() });
  } catch {
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Fiyat bilgisi şu anda alınamıyor.' });
  }
});

// /api/platform/pricing altında bağlanır; yetki kontrolü platformManagementRouter'dadır.
export const platformPricingRouter = Router();
platformPricingRouter.get('/', async (_req, res) => {
  try {
    res.json({ plans: await listPrices() });
  } catch {
    res.status(500).json({ error: 'Fiyatlar alınamadı.' });
  }
});

platformPricingRouter.patch('/:planCode', async (req: AuthenticatedRequest, res) => {
  const planCode = String(req.params.planCode) as PricingPlanCode;
  if (!PRICING_PLAN_CODES.includes(planCode)) return res.status(404).json({ error: 'Plan bulunamadı.' });
  const amountMinor = req.body?.amountMinor;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) {
    return res.status(400).json({ error: 'Geçerli bir tutar girin.' });
  }
  try {
    const db = await getDb();
    const price = await db.transaction(async (tx) => {
      const before = await tx.query<any>('SELECT amount_minor FROM platform_pricing WHERE plan_code=$1 FOR UPDATE', [planCode]);
      if (!before.rows[0]) return null;
      const updated = await tx.query<any>(
        `UPDATE platform_pricing SET amount_minor=$2, revision=revision+1, updated_at=NOW(), updated_by_user_id=$3
         WHERE plan_code=$1 RETURNING plan_code, amount_minor, currency, revision, updated_at`,
        [planCode, amountMinor, req.user!.id],
      );
      await tx.query(
        `INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, actor_user_id, details, audit_scope)
         VALUES ($1, NULL, NOW(), 'platform_pricing.updated', $2, $3, $4, 'PLATFORM')`,
        [
          `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          `${req.user!.firstName} ${req.user!.lastName} (Platform Yönetimi)`.trim(),
          req.user!.id,
          JSON.stringify({ planCode, fromMinor: Number(before.rows[0].amount_minor), toMinor: amountMinor }),
        ],
      );
      return mapPrice(updated.rows[0]);
    });
    if (!price) return res.status(404).json({ error: 'Plan bulunamadı.' });
    return res.json({ plan: price });
  } catch {
    return res.status(500).json({ error: 'Fiyat güncellenemedi.' });
  }
});
