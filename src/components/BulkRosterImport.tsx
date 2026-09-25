import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';
import { emptyRosterRow, MAX_ROSTER_FILE_BYTES, MAX_ROSTER_ROWS, parseDelimited, RosterDraft, RosterPreview, rowsToDrafts, ROSTER_HEADERS } from '../utils/roster-import';
import { rosterTemplate } from '../utils/roster-files';

export function BulkRosterImport({ schoolId, classes, initialClass, onClose, onChanged }: { schoolId: string; classes: string[]; initialClass: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [className, setClassName] = useState(initialClass);
  const [records, setRecords] = useState<RosterDraft[]>([emptyRosterRow()]);
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<RosterPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  const update = (next: RosterDraft[]) => { setRecords(next); setPreview(null); setMessage(''); };
  const keys: (keyof RosterDraft)[] = ['studentName', 'studentNumber', 'parentName', 'parentPhone', 'birthDate'];
  const loadFile = async (file: File) => {
    setError(''); setBusy(true); setPreview(null);
    try {
      if (file.size > MAX_ROSTER_FILE_BYTES) throw new Error('Dosya en fazla 2 MB olabilir.');
      const buffer = await file.arrayBuffer();
      const worker = new Worker(new URL('../utils/roster-worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const imported = await new Promise<RosterDraft[]>((resolve, reject) => {
        const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('Dosya işleme süresi aşıldı. Daha küçük bir dosya deneyin.')); }, 15000);
        worker.onmessage = (event: MessageEvent<{ records?: RosterDraft[]; error?: string }>) => { clearTimeout(timer); event.data.records ? resolve(event.data.records) : reject(new Error(event.data.error || 'Dosya okunamadı.')); };
        worker.onerror = () => { clearTimeout(timer); reject(new Error('Dosya okunamadı.')); };
        worker.postMessage({ buffer, name: file.name }, [buffer]);
      });
      update(imported); setSelected([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dosya okunamadı.'); }
    finally { workerRef.current?.terminate(); workerRef.current = null; setBusy(false); }
  };
  const submit = async (onlyPreview: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.importRoster(schoolId, className, records, onlyPreview);
      setPreview(result.rows);
      if (!onlyPreview) { setPreview(null); setRecords([emptyRosterRow()]); setMessage(result.addedCount + ' kayıt eklendi; ' + result.skippedCount + ' mevcut kayıt atlandı.'); await onChanged(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  };
  return <Dialog wide className="roster-import-dialog" title="Toplu Kayıt Ekle" description="Sınıf seçin, kayıtları girin veya dosya yükleyin, önizleyip onaylayın." onClose={onClose} dismissible={!busy}>
    <div className="form-stack">
      <label className="field">Sınıf<input list="bulk-classes" value={className} maxLength={50} disabled={busy} placeholder="Örn. 5-A" onChange={(event) => { setClassName(event.target.value); setPreview(null); }} /><datalist id="bulk-classes">{classes.map((entry) => <option key={entry} value={entry} />)}</datalist></label>
      <p className="field-hint">Listeden sınıf seçebilir veya okulunuz için yeni sınıf yazabilirsiniz. Dosyada sınıf sütunu bulunmaz.</p>
      {error && <Alert tone="danger">{error}</Alert>}{message && <Alert tone="success">{message}</Alert>}
      <fieldset disabled={!className.trim() || busy} className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={async () => {
          try {
            const buffer = await rosterTemplate();
            const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const link = document.createElement('a'); link.href = url; link.download = 'veli-randevu-ogrenci-veli-sablonu.xlsx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch { setError('Şablon oluşturulamadı.'); }
        }}>Excel Şablonunu İndir</Button>
        <label className="field">Dosya Seç (XLSX / CSV, en fazla 2 MB)<input type="file" accept=".xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ''; }} /></label></div>
        <p className="field-hint">Excel'den kopyaladığınız 5 sütunu ilk alana yapıştırabilirsiniz. En fazla 500 satır. Mevcut kayıtlar atlanır; hatalı satır varsa aktarım yapılmaz.</p>
        <div className="max-h-[45vh] overflow-y-auto space-y-3">
          {records.map((record, index) => <div key={index} className="rounded-xl border p-3 space-y-2">
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(index)} onChange={(event) => setSelected(event.target.checked ? [...selected, index] : selected.filter((entry) => entry !== index))} />Satır {index + 1}</label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{keys.map((key, column) => <label className="field min-w-0" key={key}>{ROSTER_HEADERS[column]}<input value={record[key]} maxLength={key === 'studentName' || key === 'parentName' ? 150 : 50} onChange={(event) => update(records.map((entry, rowIndex) => rowIndex === index ? { ...entry, [key]: event.target.value } : entry))}
              onPaste={(event) => { const text = event.clipboardData.getData('text'); if (column !== 0 || !text.includes('\t')) return; event.preventDefault(); try { const next = rowsToDrafts(parseDelimited(text, '\t'), false); const merged = [...records.slice(0, index), ...next, ...records.slice(index + 1)]; if (merged.length > MAX_ROSTER_ROWS) throw new Error('En fazla 500 kayıt eklenebilir.'); update(merged); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Satırlar okunamadı.'); } }} /></label>)}</div>
            {preview?.[index] && <p role="status" className={preview[index].status === 'invalid' ? 'text-red-700' : 'text-green-800'}>{preview[index].status === 'valid' ? '✓ Geçerli' : preview[index].status === 'duplicate' ? '⚠ Zaten mevcut' : '✕ Hatalı'} {preview[index].errors.join(' ')}</p>}
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={records.length >= MAX_ROSTER_ROWS} onClick={() => update([...records, emptyRosterRow()])}>Satır Ekle</Button><Button variant="secondary" disabled={!selected.length} onClick={() => { update(records.filter((_, index) => !selected.includes(index))); setSelected([]); }}>Seçili Satırları Sil</Button><Button variant="secondary" onClick={() => { update([emptyRosterRow()]); setSelected([]); }}>Tümünü Temizle</Button></div>
      </fieldset>
      {preview && <p role="status">{preview.length} kayıt okundu · {preview.filter((row) => row.status === 'valid').length} yeni · {preview.filter((row) => row.status === 'invalid').length} hatalı · {preview.filter((row) => row.status === 'duplicate').length} zaten mevcut</p>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Kapat</Button><Button disabled={busy || !className.trim() || !records.length} onClick={() => void submit(true)}>Önizle</Button><Button disabled={busy || !preview || preview.some((row) => row.status === 'invalid') || !preview.some((row) => row.status === 'valid')} onClick={() => void submit(false)}>İçe Aktar</Button></div>
    </div>
  </Dialog>;
}
