import React, { useEffect, useRef, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';
import { emptyRosterRow, formatRosterDraftInput, MAX_ROSTER_FILE_BYTES, MAX_ROSTER_ROWS, parseDelimited, RosterDraft, RosterPreview, rowsToDrafts, ROSTER_HEADERS, validateRosterRow } from '../utils/roster-import';
import { rosterTemplate, ROSTER_TEMPLATE_FILENAME } from '../utils/roster-files';
import { formatTurkishPhoneInput } from '../utils/phone';
import { uppercasePersonNameInput } from '../utils/person-name';

const keys = ['studentName', 'studentNumber', 'className', 'parentName', 'parentPhone'] as const;
type Field = typeof keys[number];
const hasData = (rows: RosterDraft[]) => rows.some(row => Object.values(row).some(value => value.trim()));
const formatValue = (key: Field, value: string) => key === 'parentPhone' ? formatTurkishPhoneInput(value) : key === 'studentName' || key === 'parentName' ? uppercasePersonNameInput(value) : key === 'className' ? value.toLocaleUpperCase('tr-TR') : value;
const fieldPrefixes: Record<Field, string> = { studentName: 'Öğrenci adı', studentNumber: 'Öğrenci numarası', className: 'Sınıf/şube', parentName: 'Veli adı', parentPhone: 'Telefon' };

// Single and bulk entry share the existing server preview and atomic import contract.
export function BulkRosterImport({ schoolId, onClose, onChanged }: { schoolId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [method, setMethod] = useState<'file' | 'manual'>('file');
  const [single, setSingle] = useState<RosterDraft>(emptyRosterRow);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [singleSaved, setSingleSaved] = useState(false);
  const [records, setRecords] = useState<RosterDraft[]>([emptyRosterRow()]);
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<RosterPreview[] | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const locked = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  const focusFirst = () => { if (window.matchMedia('(pointer: fine)').matches) firstInput.current?.focus(); };
  useEffect(() => { if (mode === 'single' && !singleSaved && !busy) focusFirst(); }, [mode, singleSaved, busy]);
  const confirm = (action: () => void) => setConfirmAction(() => action);
  const close = () => { if (locked.current) return; if (hasData([single]) || hasData(records)) confirm(onClose); else onClose(); };
  // Independent drafts survive every tab/method switch.
  const switchMode = (next: typeof mode) => { if (!locked.current) { setMode(next); setError(''); setMessage(''); } };
  const update = (next: RosterDraft[]) => { setRecords(next); setPreview(null); setMessage(''); };
  const refresh = async () => {
    try { await onChanged(); }
    catch { setError('Kayıt tamamlandı ancak liste yenilenemedi. Yeniden kayıt göndermeden listeyi yenileyin.'); }
  };
  const loadFile = async (file: File) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
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
      update(imported.map(formatRosterDraftInput)); setSelected([]); setPage(0); setFileName(file.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dosya okunamadı.'); }
    finally { workerRef.current?.terminate(); workerRef.current = null; locked.current = false; setBusy(false); }
  };
  const saveSingle = async (another: boolean) => {
    if (locked.current || singleSaved) return;
    const validation = validateRosterRow(single);
    setFieldErrors(Object.fromEntries(keys.map(key => [key, validation.errors.find(entry => entry.startsWith(fieldPrefixes[key]))])));
    setError(''); setMessage('');
    if (validation.status === 'invalid') return;
    locked.current = true; setBusy(true);
    try {
      const checked = await api.importRoster(schoolId, [validation.record], true);
      if (!checked.rows.length || checked.rows.some(row => row.status !== 'valid')) { setError(checked.rows.flatMap(row => row.errors).join(' ') || 'Bu kayıt zaten mevcut.'); return; }
      const result = await api.importRoster(schoolId, [validation.record], false);
      if (!result.addedCount) { setError('Kayıt zaten mevcut; yeni kayıt eklenmedi.'); return; }
      setSingle(emptyRosterRow()); setSingleSaved(!another); setFieldErrors({});
      setMessage('Kayıt eklendi. Görünürlük seçili sınıf ve kayıt filtresine bağlıdır.');
      await refresh(); if (another) focusFirst();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kayıt tamamlanamadı.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const submit = async (onlyPreview: boolean) => {
    if (locked.current || (!onlyPreview && (!preview || preview.some(row => row.status === 'invalid') || !preview.some(row => row.status === 'valid')))) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.importRoster(schoolId, records, onlyPreview);
      setPreview(result.rows); setPage(0);
      if (!onlyPreview) { setPreview(null); setRecords([emptyRosterRow()]); setSelected([]); setFileName(''); setMessage(result.addedCount + ' kayıt eklendi; ' + result.skippedCount + ' mevcut kayıt atlandı.'); await refresh(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const download = async () => {
    try {
      const buffer = await rosterTemplate();
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = ROSTER_TEMPLATE_FILENAME; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Şablon indirilemedi. Lütfen tekrar deneyin.'); }
  };
  const currentPage = Math.min(page, Math.max(0, Math.ceil(records.length / 25) - 1));
  return <>
    <Dialog className="record-center" title="Kayıt ekle" description="Tek öğrenci kaydı oluşturun veya Excel ile toplu kayıt aktarın." onClose={close} dismissible={!busy}>
      <div className="record-center-tabs" role="tablist" aria-label="Kayıt yöntemi">{(['single', 'bulk'] as const).map(tab => <button type="button" role="tab" id={`record-tab-${tab}`} aria-selected={mode === tab} aria-controls={`record-panel-${tab}`} tabIndex={mode === tab ? 0 : -1} disabled={busy} key={tab} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = tab === 'single' ? 'bulk' : 'single'; switchMode(next); document.getElementById(`record-tab-${next}`)?.focus(); } }} onClick={() => switchMode(tab)}>{tab === 'single' ? 'Tekli kayıt' : 'Toplu kayıt'}</button>)}</div>
      <div className="record-center-content" role="tabpanel" id={`record-panel-${mode}`} aria-labelledby={`record-tab-${mode}`}>
        {error && <Alert tone="danger">{error}</Alert>}{message && <Alert tone="success">{message}</Alert>}
        {mode === 'single' ? singleSaved ? <div className="record-center-result"><h3>Kayıt tamamlandı</h3><p>Yeni kayıt ekleyebilir veya öğrenci listesine dönebilirsiniz.</p></div> :
          <form id="single-roster-form" noValidate onSubmit={event => { event.preventDefault(); void saveSingle(false); }} className="record-single-form">
            {keys.map((key, index) => <label className="field" key={key} htmlFor={`single-${key}`}>{ROSTER_HEADERS[index]}<input ref={index === 0 ? firstInput : undefined} id={`single-${key}`} aria-label={ROSTER_HEADERS[index]} value={single[key]} disabled={busy} required={key !== 'studentNumber'} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `error-${key}` : undefined} type={key === 'parentPhone' ? 'tel' : 'text'} inputMode={key === 'parentPhone' ? 'tel' : undefined} placeholder={key === 'parentPhone' ? '0555 123 45 67' : key === 'className' ? '5/C' : undefined} maxLength={key === 'parentPhone' ? 18 : key === 'studentName' || key === 'parentName' ? 150 : 50} onChange={event => { setSingle({ ...single, [key]: formatValue(key, event.target.value) }); setFieldErrors({ ...fieldErrors, [key]: undefined }); }} />{fieldErrors[key] && <span className="record-field-error" id={`error-${key}`}>{fieldErrors[key]}</span>}</label>)}
          </form> : <>
          <ol className="record-center-steps" aria-label="İşlem adımları">{['Veri / Dosya', 'Önizleme', 'Kaydet'].map((step, index) => <li key={step} aria-current={(message ? 2 : preview ? 1 : 0) === index ? 'step' : undefined}>{index + 1}. {step}</li>)}</ol>
          {!message && !preview && <>
            <div className="record-methods" role="group" aria-label="Toplu giriş yöntemi"><Button variant={method === 'file' ? 'primary' : 'secondary'} disabled={busy} aria-pressed={method === 'file'} onClick={() => setMethod('file')}>Dosyadan aktar</Button><Button variant={method === 'manual' ? 'primary' : 'secondary'} disabled={busy} aria-pressed={method === 'manual'} onClick={() => setMethod('manual')}>Elle giriş / Yapıştır</Button></div>
            {method === 'file' ? <div className="record-file-tools"><Button variant="secondary" disabled={busy} onClick={() => void download()}><Download size={18} aria-hidden="true" />Excel Şablonunu İndir</Button><div className="file-picker"><input id="bulk-roster-file" className="sr-only" disabled={busy} type="file" accept=".xlsx,.csv" aria-label="XLSX veya CSV dosyası yükle" onChange={event => { const file = event.target.files?.[0]; if (file) { const action = () => void loadFile(file); if (hasData(records)) confirm(action); else action(); } event.target.value = ''; }} /><label className="ui-button ui-button-secondary" htmlFor="bulk-roster-file"><Upload size={18} aria-hidden="true" />Dosya seç / yükle</label><span className="file-picker-name" aria-live="polite">{fileName || 'Dosya seçilmedi'}</span></div><p className="field-hint">Excel veya CSV dosyası yükleyin. En fazla 500 öğrenci · 2 MB.</p></div> : <p className="field-hint">Excel'den kopyaladığınız satırları ilk öğrenci adı alanına yapıştırın.</p>}
            <details className="record-import-help"><summary>Dosya ve aktarım yardımı</summary><p>Beş sütunlu güncel şablon ve eski altı sütunlu dosyalar desteklenir. Hatalı satır varsa aktarım yapılmaz. Yöntem değiştirildiğinde taslağınız korunur.</p></details>
          </>}
          {!message && (preview || method === 'manual' || hasData(records)) && <>
            <div className="record-table-scroll" tabIndex={0} aria-label={preview ? 'Kayıt önizleme tablosu' : 'Elle kayıt tablosu'}><table className="record-import-table"><thead><tr>{!preview && <th>Seç</th>}{ROSTER_HEADERS.map(header => <th key={header}>{header}</th>)}{preview && <th>Durum</th>}</tr></thead><tbody>{records.slice(currentPage * 25, currentPage * 25 + 25).map((record, offset) => {
              const index = currentPage * 25 + offset;
              return <tr key={index} className={preview?.[index]?.status === 'invalid' ? 'record-invalid' : ''}>{!preview && <td><input type="checkbox" aria-label={`Satır ${index + 1}`} disabled={busy} checked={selected.includes(index)} onChange={event => setSelected(event.target.checked ? [...selected, index] : selected.filter(entry => entry !== index))} /></td>}{keys.map((key, column) => <td key={key} data-label={ROSTER_HEADERS[column]}>{preview ? record[key] || '—' : <input aria-label={`${ROSTER_HEADERS[column]} — satır ${index + 1}`} disabled={busy} value={record[key]} type={key === 'parentPhone' ? 'tel' : 'text'} maxLength={key === 'parentPhone' ? 18 : key === 'studentName' || key === 'parentName' ? 150 : 50} onChange={event => update(records.map((entry, rowIndex) => rowIndex === index ? { ...entry, [key]: formatValue(key, event.target.value) } : entry))} onPaste={event => { const text = event.clipboardData.getData('text'); if (column !== 0 || !text.includes('\t')) return; event.preventDefault(); try { const next = rowsToDrafts(parseDelimited(text, '\t'), false).map(formatRosterDraftInput); const merged = [...records.slice(0, index), ...next, ...records.slice(index + 1)]; if (merged.length > MAX_ROSTER_ROWS) throw new Error('En fazla 500 kayıt eklenebilir.'); update(merged); setSelected([]); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Satırlar okunamadı.'); } }} />}</td>)}{preview && <td data-label="Durum"><strong>{preview[index].status === 'valid' ? 'Geçerli' : preview[index].status === 'duplicate' ? 'Zaten mevcut' : 'Hatalı'}</strong><p>{preview[index].errors.join(' ')}</p></td>}</tr>;
            })}</tbody></table></div>
            <div className="record-table-tools"><span role="status">{records.length} kayıt{preview && ` · ${preview.filter(row => row.status === 'valid').length} yeni · ${preview.filter(row => row.status === 'invalid').length} hatalı · ${preview.filter(row => row.status === 'duplicate').length} zaten mevcut`}</span><div className="management-pagination"><Button variant="quiet" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Önceki</Button><span>{currentPage + 1} / {Math.max(1, Math.ceil(records.length / 25))}</span><Button variant="quiet" disabled={busy || (currentPage + 1) * 25 >= records.length} onClick={() => setPage(currentPage + 1)}>Sonraki</Button></div></div>
            {!preview && <div className="record-table-tools"><Button variant="secondary" disabled={busy || records.length >= MAX_ROSTER_ROWS} onClick={() => { update([...records, emptyRosterRow()]); setPage(Math.floor(records.length / 25)); }}><Plus size={16} aria-hidden="true" />Satır Ekle</Button><Button variant="quiet" disabled={busy || !selected.length} onClick={() => confirm(() => { update(records.filter((_, index) => !selected.includes(index))); setSelected([]); })}>Seçili Satırları Sil</Button><Button variant="quiet" disabled={busy || !hasData(records)} onClick={() => confirm(() => { update([emptyRosterRow()]); setSelected([]); setFileName(''); setPage(0); })}>Tümünü Temizle</Button></div>}
          </>}
        </>}
      </div>
      <footer className="record-center-footer"><span className="field-hint">{busy ? 'İşlem sürüyor…' : preview && mode === 'bulk' ? 'Henüz kaydedilmedi. Kontrol edip içe aktarın.' : 'Kayıtlar seçili okula eklenir.'}</span><div className="record-center-actions">
        <Button variant="secondary" disabled={busy} onClick={close}>{message || singleSaved ? 'Kapat' : 'İptal'}</Button>
        {mode === 'single' ? singleSaved ? <Button onClick={() => { setSingleSaved(false); setMessage(''); }}>Yeni kayıt</Button> : <><Button variant="secondary" disabled={busy} onClick={() => void saveSingle(true)}>Kaydet ve yeni ekle</Button><Button type="submit" form="single-roster-form" disabled={busy}>Kaydet</Button></> : message ? <Button onClick={() => setMessage('')}>Yeni aktarım</Button> : preview ? <><Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>Geri</Button><Button disabled={busy || preview.some(row => row.status === 'invalid') || !preview.some(row => row.status === 'valid')} onClick={() => void submit(false)}>İçe Aktar</Button></> : <Button disabled={busy || !hasData(records)} onClick={() => void submit(true)}>Önizle</Button>}
      </div></footer>
    </Dialog>
    {confirmAction && <Dialog title="Kaydedilmemiş veriler" description="Bu işlem kaydedilmemiş verileri kaldıracak. Devam etmek istiyor musunuz?" onClose={() => setConfirmAction(null)}><div className="form-actions"><Button variant="secondary" onClick={() => setConfirmAction(null)}>Vazgeç</Button><Button variant="danger" onClick={() => { const action = confirmAction; setConfirmAction(null); action(); }}>Devam et</Button></div></Dialog>}
  </>;
}
