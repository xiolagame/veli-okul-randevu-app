import React, { useRef, useState } from 'react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';
import {
  readStaffImportFile,
  STAFF_IMPORT_MAX_ROWS,
  StaffImportRow,
} from '../utils/staff-import';

type ExistingStaff = { phone?: string; email?: string };
type RowResult = { line: number; status: 'added' | 'failed'; message: string };

interface Props {
  schoolId: string;
  existing: ExistingStaff[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export const BulkStaffImport: React.FC<Props> = ({
  schoolId,
  existing,
  onClose,
  onChanged,
}) => {
  const [rows, setRows] = useState<StaffImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<RowResult[]>([]);
  const [finished, setFinished] = useState(false);
  const running = useRef(false);

  const invalidCount = rows.filter((row) => row.errors.length > 0).length;
  const addedCount = results.filter((row) => row.status === 'added').length;

  const loadFile = async (file: File) => {
    if (running.current) return;
    setBusy(true);
    setError('');
    setMessage('');
    setRows([]);
    setResults([]);
    setFinished(false);
    try {
      const parsed = await readStaffImportFile(file, existing);
      setRows(parsed);
      setFileName(file.name);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Excel dosyası okunamadı.');
    } finally {
      setBusy(false);
    }
  };

  const importRows = async () => {
    if (running.current || busy || finished || !rows.length || invalidCount) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setResults([]);

    let created = 0;
    let stopped = false;

    try {
      for (const row of rows) {
        try {
          await api.createStaff(schoolId, {
            fullName: row.draft.fullName.trim(),
            role: row.draft.role as 'teacher' | 'security',
            ...(row.draft.role === 'teacher'
              ? { branch: row.draft.branch.trim() }
              : {}),
            phone: row.draft.phone,
            email: row.draft.email.trim().toLowerCase(),
          });

          created++;
          setResults((previous) => [
            ...previous,
            { line: row.line, status: 'added', message: 'Kaydedildi' },
          ]);
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : 'Bilinmeyen hata';
          setResults((previous) => [
            ...previous,
            { line: row.line, status: 'failed', message: detail },
          ]);
          setError(
            `Excel satırı ${row.line}: ${detail} İşlem durduruldu. ` +
            'Kaydın oluşmuş olabileceğini dikkate alarak personel listesini kontrol edin. ' +
            'Bu dosyayı doğrudan yeniden göndermeyin.',
          );
          stopped = true;
          break;
        }
      }

      if (!stopped) {
        setMessage(`${created} personel kaydı oluşturuldu. Aktivasyon gönderimleri mevcut API üzerinden işlendi.`);
      }
    } finally {
      setFinished(true);
      try {
        await onChanged();
      } catch {
        setError((previous) =>
          `${previous} Personel listesi yenilenemedi. Sayfayı yeniden yükleyerek kayıtları kontrol edin.`.trim(),
        );
      }
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title="Toplu Personel Ekle"
      description="Excel dosyasını yükleyin, tüm kayıtları kontrol edin ve ardından aktarımı onaylayın."
      onClose={onClose}
      dismissible={!busy}
    >
      <div className="form-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {message && <Alert tone="success">{message}</Alert>}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="field" htmlFor="bulk-staff-file">
            Personel Excel dosyası
            <input
              id="bulk-staff-file"
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <p className="mt-2 text-xs text-slate-600">
            Yalnızca XLSX. En fazla {STAFF_IMPORT_MAX_ROWS} personel ve 2 MB.
            Öğretmen için branş zorunludur.
          </p>
          {fileName && <p className="mt-2 text-sm font-medium">{fileName}</p>}
        </div>

        {rows.length > 0 && (
          <>
            <p role="status" className="text-sm font-semibold text-slate-700">
              {rows.length} kayıt okundu · {invalidCount} hatalı · {addedCount} kaydedildi
            </p>
            <div className="max-h-[48vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    {['Satır', 'Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta', 'Durum'].map(
                      (title) => <th key={title} className="p-3">{title}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const result = results.find((item) => item.line === row.line);
                    const detail = result?.message
                      || (row.errors.length ? row.errors.join(' ') : 'Aktarıma hazır');
                    return (
                      <tr key={row.line} className="border-t border-slate-200">
                        <td className="p-3">{row.line}</td>
                        <td className="p-3">{row.draft.fullName}</td>
                        <td className="p-3">
                          {row.draft.role === 'teacher' ? 'Öğretmen'
                            : row.draft.role === 'security' ? 'Güvenlik' : 'Geçersiz'}
                        </td>
                        <td className="p-3">{row.draft.branch || '—'}</td>
                        <td className="p-3">{row.draft.phone}</td>
                        <td className="p-3">{row.draft.email}</td>
                        <td
                          className={
                            'p-3 ' + (
                              row.errors.length || result?.status === 'failed'
                                ? 'text-red-700'
                                : result?.status === 'added'
                                  ? 'text-green-700'
                                  : 'text-slate-600'
                            )
                          }
                        >
                          {detail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!finished && (
              <p className="text-sm text-slate-600">
                Henüz hiçbir kayıt eklenmedi. Aktarımı başlattığınızda geçerli kayıtlar
                sırayla oluşturulur ve mevcut personel aktivasyon sistemi kullanılır.
              </p>
            )}
          </>
        )}

        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Kapat
          </Button>
          <Button
            disabled={busy || !rows.length || invalidCount > 0 || finished}
            onClick={() => void importRows()}
          >
            {busy ? `Kaydediliyor (${addedCount}/${rows.length})…` : 'Onayla ve Personeli Ekle'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};