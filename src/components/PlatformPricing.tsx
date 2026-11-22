import React, { FormEvent, useEffect, useState } from 'react';
import { api } from '../services/api';
import { formatTryAmount, parseTryInputToMinor } from '../utils/tr-currency';
import { resetLicensePriceCacheForTests } from '../utils/license-price';
import { Alert, Button, Skeleton } from './ui';

const PLAN = 'YEARLY_LICENSE';

export function PlatformPricing() {
  const [current, setCurrent] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.getPlatformPricing()
      .then(({ plans }) => {
        if (cancelled) return;
        const plan = plans.find((item) => item.code === PLAN);
        setCurrent(plan ? plan.amountMinor : null);
      })
      .catch(() => { if (!cancelled) setError('Fiyat bilgisi alınamadı.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setSuccess('');
    const minor = parseTryInputToMinor(input);
    if (minor === null) { setError('Geçerli bir tutar girin. Örnek: 9.900 veya 9.900,50'); return; }
    if (minor === current) { setError('Girilen tutar mevcut fiyatla aynı.'); return; }
    if (!window.confirm(`Yıllık lisans fiyatı ${formatTryAmount(minor)} olarak güncellenecek. Onaylıyor musunuz?`)) return;
    setBusy(true);
    try {
      const { plan } = await api.updatePlatformPricing(PLAN, minor);
      resetLicensePriceCacheForTests();
      setCurrent(plan.amountMinor);
      setInput('');
      setSuccess('Fiyat güncellendi. Uygulamalara yansıması birkaç dakika sürebilir.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fiyat güncellenemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface" aria-labelledby="platform-pricing-title">
      <h3 id="platform-pricing-title">Yıllık Lisans Fiyatı</h3>
      <p>Web, iOS ve Android uygulamalarında gösterilen fiyat. Değişiklik denetim kaydına yazılır.</p>
      {loading ? <Skeleton rows={1} /> : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <p><strong>Güncel fiyat:</strong> {current === null ? 'Tanımlı değil' : formatTryAmount(current)}</p>
          <label htmlFor="platform-pricing-input">Yeni fiyat (TL)</label>
          <input id="platform-pricing-input" inputMode="decimal" autoComplete="off" placeholder="9.900" value={input}
            onChange={(event) => setInput(event.target.value)} disabled={busy} />
          {error && <Alert tone="danger">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
          <Button type="submit" disabled={busy || !input.trim()}>{busy ? 'Kaydediliyor…' : 'Fiyatı güncelle'}</Button>
        </form>
      )}
    </section>
  );
}
