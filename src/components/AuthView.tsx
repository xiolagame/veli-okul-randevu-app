import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Lock, Phone, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';

interface AuthViewProps {
  onSuccess?: () => void;
  onOpenOnboarding?: () => void;
}

type CodeFlow = 'activation' | 'reset' | null;

export const AuthView: React.FC<AuthViewProps> = () => {
  const { login, schools, settings } = useApp();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [codeFlow, setCodeFlow] = useState<CodeFlow>(null);
  const [schoolId, setSchoolId] = useState('');
  const [codePhone, setCodePhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeCodeFlow = () => {
    setCodeFlow(null);
    setSchoolId('');
    setCodePhone('');
    setCode('');
    setNewPassword('');
    setPasswordConfirmation('');
  };

  const openCodeFlow = (flow: Exclude<CodeFlow, null>) => {
    setError('');
    setSuccessMessage('');
    setCodePhone(phone);
    setCodeFlow(flow);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      const success = await login(phone, password);
      if (!success) setError('Telefon numarası veya şifre hatalı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeFlow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!codeFlow) return;
    setError('');
    if (newPassword !== passwordConfirmation) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Yeni şifre en az 8 karakter olmalıdır.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = codeFlow === 'activation'
        ? await api.activateAccount(schoolId, codePhone, code, newPassword)
        : await api.resetPasswordWithCode(schoolId, codePhone, code, newPassword);
      setPhone(codePhone);
      setPassword('');
      closeCodeFlow();
      setSuccessMessage(result.message);
    } catch (requestError: any) {
      setError(requestError.message || 'Bilgiler doğrulanamadı veya kodun süresi dolmuş olabilir.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 text-white">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-2xl font-black mb-3">V</div>
          <h1 className="text-2xl font-black">{settings.appName} <span className="font-light text-blue-400">Randevu</span></h1>
          <p className="mt-1 text-xs text-slate-300">{settings.schoolName}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          {successMessage && <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{successMessage}</div>}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Telefon Numarası</label>
              <div className="relative"><Phone className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+90 5XX XXX XX XX" required className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Parola</label>
              <div className="relative"><Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-gradient-to-r from-blue-700 to-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-sm">Giriş Yap</button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-100 text-center space-y-2">
            <button type="button" onClick={() => openCodeFlow('reset')} className="block w-full text-xs text-blue-700 font-semibold">Şifremi Unuttum</button>
            <button type="button" onClick={() => openCodeFlow('activation')} className="block w-full text-xs text-slate-600 hover:text-blue-700 font-semibold">İlk kez giriş / Hesabımı etkinleştir</button>
          </div>
        </div>
      </div>

      {codeFlow && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 flex items-start sm:items-center justify-center p-4">
          <div className="w-full max-w-md my-auto bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-blue-700"><ShieldCheck className="w-5 h-5" /><h2 className="font-bold text-slate-900">{codeFlow === 'activation' ? 'Hesabımı Etkinleştir' : 'Parolamı Sıfırla'}</h2></div>
            <p className="text-xs text-slate-600">Okul yönetiminizin verdiği tek kullanımlık kodu kullanın. Kod veya parola tekrar gösterilmez.</p>
            <form onSubmit={handleCodeFlow} className="space-y-3">
              <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} required className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
                <option value="">Okulunuzu seçin</option>
                {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
              <input type="tel" value={codePhone} onChange={(event) => setCodePhone(event.target.value)} placeholder="Telefon numarası" required className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
              <div className="relative"><KeyRound className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input type="text" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Aktivasyon / sıfırlama kodu" required className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" /></div>
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Yeni parola (8-128 karakter)" minLength={8} maxLength={128} required className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
              <input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Yeni parola tekrar" minLength={8} maxLength={128} required className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
              <div className="flex gap-2 pt-1"><button type="button" onClick={closeCodeFlow} className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold">Vazgeç</button><button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold">{codeFlow === 'activation' ? 'Hesabı Etkinleştir' : 'Parolayı Güncelle'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
