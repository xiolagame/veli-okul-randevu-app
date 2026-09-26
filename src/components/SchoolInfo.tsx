import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Alert, Button, Dialog } from './ui';

export function SchoolInfo({ schoolId, allowCodeChange = false, onCodeChanged }: { schoolId: string; allowCodeChange?: boolean; onCodeChanged?: () => Promise<void> }) {
  const [school, setSchool] = useState<{ name: string; code: string } | null>(null);
  const [message, setMessage] = useState('');
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    setSchool(null);
    setMessage('');
    api.getSchoolInfo(schoolId).then((result) => { if (!disposed) setSchool(result.school); }).catch(() => { if (!disposed) setMessage('Okul bilgileri alınamadı.'); });
    return () => { disposed = true; };
  }, [schoolId]);
  return <section className="surface min-w-0"><h3>Okul Bilgileri</h3>
    {school && <><dl className="pass-details"><div><dt>Okul Adı</dt><dd className="break-words">{school.name}</dd></div><div><dt>Okul Kodu</dt><dd className="break-all">{school.code}</dd></div></dl>
      <Button variant="secondary" aria-label="Okul kodunu kopyala" onClick={async () => { try { await navigator.clipboard.writeText(school.code); setMessage('Okul kodu kopyalandı.'); } catch { setMessage('Kopyalanamadı. Okul kodunu seçerek kopyalayabilirsiniz.'); } }}>Kopyala</Button>
      {allowCodeChange && <Button variant="secondary" className="ml-2" onClick={() => { setCodeDraft(school.code); setMessage(''); setShowCodeEditor(true); }}>Değiştir</Button>}
      <p className="mt-3 text-sm text-slate-500">Veliler hesap oluştururken bu okul kodunu kullanır.</p></>}
    {message && <p role="status">{message}</p>}
    {showCodeEditor && school && <Dialog title="Okul kodunu değiştir" description="Okul kodu değiştirildiğinde yeni hesap oluşturma ve parola sıfırlama işlemlerinde yeni okul kodu kullanılacaktır. Mevcut hesaplar ve okul verileri etkilenmez." dismissible={!busy} onClose={() => setShowCodeEditor(false)}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setMessage('');
        try { const result = await api.updateSchoolCode(schoolId, codeDraft.trim().toUpperCase()); setSchool({ ...school, code: result.code }); setShowCodeEditor(false); setMessage('Okul kodu güncellendi.'); void onCodeChanged?.().catch(() => {}); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Okul kodu değiştirilemedi.'); }
        finally { setBusy(false); }
      }}>
        <label className="field" htmlFor="platform-school-code">Yeni okul kodu<input id="platform-school-code" value={codeDraft} maxLength={50} pattern="[A-Za-z0-9_-]{3,50}" required onChange={(event) => setCodeDraft(event.target.value)} /></label>
        {message && <Alert tone="danger">{message}</Alert>}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setShowCodeEditor(false)}>Vazgeç</Button><Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Okul kodunu güncelle'}</Button></div>
      </form>
    </Dialog>}
  </section>;
}
