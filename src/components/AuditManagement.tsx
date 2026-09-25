import React, { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Alert, Button, Dialog, EmptyState } from './ui';
import { api } from '../services/api';
import { AuditLogItem } from '../types';

const events: Record<string, { label: string; tone: string }> = {
  'Randevu Talebi': { label: 'Bekliyor', tone: 'warning' },
  'Randevu Onayı': { label: 'Onaylı', tone: 'success' },
  'Randevu Reddi': { label: 'Reddedildi', tone: 'danger' },
  'Randevu İptali': { label: 'İptal', tone: 'rose' },
  'QR Giriş Doğrulandı': { label: 'Giriş yapıldı', tone: 'teal' },
  'appointment.expired': { label: 'Süresi geçti', tone: 'neutral' },
  'teacher.updated': { label: 'Öğretmen güncellendi', tone: 'info' },
  'parent.updated': { label: 'Veli güncellendi', tone: 'info' },
  'student.updated': { label: 'Öğrenci güncellendi', tone: 'info' },
  'security.updated': { label: 'Personel güncellendi', tone: 'info' },
  'roster.updated': { label: 'Kütük güncellendi', tone: 'info' },
};

export function AuditManagement({ schoolId, logs, onChanged }: { schoolId: string; logs: AuditLogItem[]; onChanged: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const clear = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await api.clearAuditLogs(schoolId); await onChanged(); setConfirm(false); }
    catch { setError('İşlem günlüğü temizlenemedi.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="surface">
    <div className="section-heading"><h3>İşlem günlüğü</h3><Button variant="secondary" disabled={!logs.length} onClick={() => setConfirm(true)}>İşlem Günlüğünü Temizle</Button></div>
    {logs.length ? logs.map((log) => {
      const event = events[log.action] || { label: log.action, tone: 'neutral' };
      return <article key={log.id} className="py-5 border-b"><span className={`status-badge tone-${event.tone}`}>{event.label}</span>
        <p className="mt-2">{log.details}</p><p className="text-xs text-slate-500">{log.actorName} · {log.timestamp}</p></article>;
    }) : <EmptyState icon={FileText} title="Henüz bir işlem kaydı yok" />}
    {confirm && <Dialog title="İşlem günlüğünü temizle" onClose={() => { if (!busy) setConfirm(false); }} dismissible={!busy}>
      <Alert tone="warning">Yalnızca bu okulun işlem günlüğü kalıcı olarak temizlenecek. Bu işlem geri alınamaz.</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</Button><Button disabled={busy} onClick={() => void clear()}>{busy ? 'Temizleniyor…' : 'Temizlemeyi onayla'}</Button></div>
    </Dialog>}
  </section>;
}
