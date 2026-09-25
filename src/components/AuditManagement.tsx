import { formatDateTime } from '../utils/dates';
import { auditDisplay } from '../utils/audit-display';
import React, { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Alert, Button, Dialog, EmptyState } from './ui';
import { api } from '../services/api';
import { AuditLogItem } from '../types';


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
      const event = auditDisplay(log.action, log.details);
      return <article key={log.id} className="py-5 border-b"><span className={`status-badge tone-${event.tone}`}>{event.label}</span>
        {event.summary && <p className="mt-2">{event.summary}</p>}<p className="text-xs text-slate-500">{log.actorName} · {formatDateTime(log.timestamp)}</p></article>;
    }) : <EmptyState icon={FileText} title="Henüz bir işlem kaydı yok" />}
    {confirm && <Dialog title="İşlem günlüğünü temizle" onClose={() => { if (!busy) setConfirm(false); }} dismissible={!busy}>
      <Alert tone="warning">Yalnızca bu okulun işlem günlüğü kalıcı olarak temizlenecek. Bu işlem geri alınamaz.</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</Button><Button disabled={busy} onClick={() => void clear()}>{busy ? 'Temizleniyor…' : 'Temizlemeyi onayla'}</Button></div>
    </Dialog>}
  </section>;
}
