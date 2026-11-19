import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Alert, Button, Dialog } from './ui';
import { Copy } from 'lucide-react';
import { normalizeSchoolCodeInput } from '../utils/school-code';

export function SchoolInfo({ schoolId, allowCodeChange = false, onCodeChanged, compact = false }: { schoolId: string; allowCodeChange?: boolean; onCodeChanged?: () => Promise<void>; compact?: boolean }) {
  const [school, setSchool] = useState<{ name: string; code: string } | null>(null);
  const [message, setMessage] = useState('');
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let disposed = false;
    setSchool(null);
    setMessage('');
    api.getSchoolInfo(schoolId).then((result) => { if (!disposed) setSchool(result.school); }).catch(() => { if (!disposed) setMessage('Okul bilgileri alınamadı.'); });
    return () => { disposed = true; };
  }, [schoolId]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <section className={`surface school-info-card ${compact ? 'school-info-compact' : ''}`}><h3>Okul Bilgileri</h3>
    {school && <dl className="school-info-list"><div><dt>Okul Adı</dt><dd>{school.name}</dd></div><div><dt>Okul Kodu</dt><dd><span className="school-code-value">{school.code}</span><span className="school-code-actions"><Button variant="secondary" aria-label="Okul kodunu kopyala" onClick={async () => { try { await navigator.clipboard.writeText(school.code); setCopied(true); setMessage(''); } catch { setCopied(false); setMessage('Kopyalanamadı. Okul kodunu seçerek kopyalayabilirsiniz.'); } }}><Copy size={16} />{copied ? 'Kopyalandı ✓' : 'Kopyala'}</Button>{allowCodeChange && <Button variant="secondary" onClick={() => { setCodeDraft(school.code); setMessage(''); setShowCodeEditor(true); }}>Değiştir</Button>}</span></dd>{!compact && <p>Veliler hesap oluştururken bu okul kodunu kullanır.</p>}</div></dl>}
    {message && <p className="school-info-message" role="status">{message}</p>}
    {showCodeEditor && school && <Dialog title="Okul kodunu değiştir" description="Okul kodu değiştirildiğinde yeni hesap oluşturma ve parola sıfırlama işlemlerinde yeni okul kodu kullanılacaktır. Mevcut hesaplar ve okul verileri etkilenmez." dismissible={!busy} onClose={() => setShowCodeEditor(false)}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setMessage('');
        try { const result = await api.updateSchoolCode(schoolId, normalizeSchoolCodeInput(codeDraft.trim())); setSchool({ ...school, code: result.code }); setShowCodeEditor(false); setMessage('Okul kodu güncellendi.'); void onCodeChanged?.().catch(() => {}); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Okul kodu değiştirilemedi.'); }
        finally { setBusy(false); }
      }}>
        <label className="field" htmlFor="platform-school-code">Yeni okul kodu<input id="platform-school-code" value={codeDraft} maxLength={50} pattern="[A-Z0-9_-]{3,50}" required onChange={(event) => setCodeDraft(normalizeSchoolCodeInput(event.target.value))} /></label>
        {message && <Alert tone="danger">{message}</Alert>}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setShowCodeEditor(false)}>Vazgeç</Button><Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Okul kodunu güncelle'}</Button></div>
      </form>
    </Dialog>}
  </section>;
}
