import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Button } from './ui';

export function SchoolInfo({ schoolId }: { schoolId: string }) {
  const [school, setSchool] = useState<{ name: string; code: string } | null>(null);
  const [message, setMessage] = useState('');
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
      <p className="mt-3 text-sm text-slate-500">Veliler hesap oluştururken bu okul kodunu kullanır.</p></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
