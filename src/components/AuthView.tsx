import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { UserRole } from '../types';
import { SECURITY_QUESTIONS_LIST } from '../data/mockData';
import { Phone, Lock, User as UserIcon, Shield, ArrowRight, HelpCircle, CheckCircle2, AlertCircle, QrCode } from 'lucide-react';

interface AuthViewProps {
  onSuccess?: () => void;
  onOpenOnboarding?: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onOpenOnboarding }) => {
  const { login, registerUser, users, resetUserPassword, settings } = useApp();
  const [isRegister, setIsRegister] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  // Login form state
  const [phone, setPhone] = useState('+905551234567');
  const [password, setPassword] = useState('12345678');
  const [selectedRole, setSelectedRole] = useState<UserRole>('parent');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Register form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regPhone, setRegPhone] = useState('+905');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('parent');
  const [branch, setBranch] = useState('Matematik');
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('7-A');
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS_LIST[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');

  // Forgot Password state
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotPhone, setForgotPhone] = useState('+905551234567');
  const [foundUserQuestion, setFoundUserQuestion] = useState('');
  const [forgotAnswer, setForgotAnswer] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const ok = login(phone, selectedRole);
    if (!ok) {
      setError('Telefon numarası veya şifre hatalı! Lütfen kontrol ediniz.');
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!firstName || !lastName || !regPhone || !regPassword) {
      setError('Lütfen tüm zorunlu alanları doldurunuz.');
      return;
    }

    const students = regRole === 'parent' && studentName ? [{ id: 's-' + Date.now(), name: studentName, className }] : [];

    registerUser({
      firstName,
      lastName,
      phone: regPhone,
      role: regRole,
      branch: regRole === 'teacher' ? branch : undefined,
      students,
      securityQuestion,
    });

    setSuccessMsg('Kaydınız başarıyla oluşturuldu ve sisteme giriş yapıldı.');
  };

  const handleForgotStep1 = () => {
    setError('');
    const clean = forgotPhone.replace(/\s+/g, '');
    const user = users.find((u) => u.phone.replace(/\s+/g, '') === clean);
    if (!user) {
      setError('Bu telefon numarasına ait kullanıcı kaydı bulunamadı.');
      return;
    }
    setFoundUserQuestion(user.securityQuestion || SECURITY_QUESTIONS_LIST[0]);
    setForgotStep(2);
  };

  const handleForgotStep2 = () => {
    if (!forgotAnswer.trim()) {
      setError('Lütfen güvenlik sorusunun cevabını giriniz.');
      return;
    }
    setError('');
    setForgotStep(3);
  };

  const handleForgotStep3 = () => {
    if (forgotNewPass.length < 6) {
      setError('Yeni şifre en az 6 karakter olmalıdır.');
      return;
    }
    resetUserPassword(forgotPhone, forgotNewPass);
    setSuccessMsg('Şifreniz başarıyla sıfırlandı! Yeni şifreniz ile giriş yapabilirsiniz.');
    setShowForgot(false);
    setForgotStep(1);
    setPhone(forgotPhone);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center relative overflow-hidden py-12 px-4 sm:px-6 lg:px-8">
      {/* Background Image / Ambient styling */}
      <div className="absolute inset-0 z-0 opacity-20 bg-cover bg-center" style={{ backgroundImage: "url('/school-hero.jpg'), radial-gradient(circle at center, #1e3a8a, #0f172a)" }} />
      <div className="absolute inset-0 z-0 bg-gradient-to-t from-slate-950 via-slate-900/90 to-slate-900/80" />

      <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black text-2xl shadow-lg shadow-blue-500/20 mb-3 border border-blue-400/30">
            V
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            {settings.appName} <span className="font-light text-blue-400">Randevu</span>
          </h1>
          <p className="mt-1 text-xs text-slate-300 max-w-sm mx-auto font-medium">
            {settings.schoolName}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-6 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* QR / Invite Code Onboarding Banner */}
          {onOpenOnboarding && (
            <div className="mb-4 p-3 bg-blue-50/80 border border-blue-200 rounded-xl text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-blue-900 font-medium">
                <QrCode className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Okul QR veya davet kodunuz mu var?</span>
              </div>
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[11px] transition-colors cursor-pointer shrink-0"
              >
                Kayıt Ol
              </button>
            </div>
          )}

          {!isRegister ? (
            /* Login Form */
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Giriş Yapılacak Rol
                </label>
                <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
                  {(['parent', 'teacher', 'security'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setSelectedRole(r);
                        if (r === 'parent') setPhone('+905551234567');
                        if (r === 'teacher') setPhone('+905321112233');
                        if (r === 'security') setPhone('+905550001122');
                      }}
                      className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                        selectedRole === r ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {r === 'parent' ? 'Veli' : r === 'teacher' ? 'Öğretmen' : 'Güvenlik'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Telefon Numarası
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+90 5XX XXX XX XX"
                    required
                    className="block w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Şifre
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgot(true)}
                    className="text-xs text-blue-700 hover:underline font-medium"
                  >
                    Şifremi Unuttum?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="block w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white font-bold rounded-xl text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                Giriş Yap <ArrowRight className="w-4 h-4" />
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(true);
                    setError('');
                  }}
                  className="text-xs text-slate-600 hover:text-blue-700 font-medium"
                >
                  Hesabınız yok mu? <span className="font-bold text-blue-700">Kayıt Olun</span>
                </button>
              </div>

              {/* Demo Accounts Helper */}
              <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500">
                <p className="font-semibold text-slate-700 mb-1">Test Giriş Bilgileri:</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
                  <span className="text-slate-600">Veli: +905551234567</span>
                  <span className="text-slate-600">Öğretmen: +905321112233</span>
                  <span className="text-slate-600">Güvenlik: +905550001122</span>
                  <span className="text-slate-600">Şifre: 12345678</span>
                </div>
              </div>
            </form>
          ) : (
            /* Register Form */
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Adınız</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Ahmet"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Soyadınız</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Yılmaz"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Rolünüz</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRegRole('parent')}
                    className={`py-2 text-xs font-semibold rounded-xl border ${
                      regRole === 'parent' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Veli
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegRole('teacher')}
                    className={`py-2 text-xs font-semibold rounded-xl border ${
                      regRole === 'teacher' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Öğretmen
                  </button>
                </div>
              </div>

              {regRole === 'teacher' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Branş</label>
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="Matematik">Matematik</option>
                    <option value="Türkçe">Türkçe</option>
                    <option value="Fen Bilimleri">Fen Bilimleri</option>
                    <option value="İngilizce">İngilizce</option>
                    <option value="Sosyal Bilgiler">Sosyal Bilgiler</option>
                    <option value="Rehberlik">Rehberlik</option>
                    <option value="Beden Eğitimi">Beden Eğitimi</option>
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Öğrenci Adı</label>
                    <input
                      type="text"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="Emre Yılmaz"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Sınıfı</label>
                    <input
                      type="text"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="7-B"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Telefon Numarası</label>
                <input
                  type="text"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="+905XXXXXXXXX"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Şifre</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="En az 8 karakter"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Güvenlik Sorusu</label>
                <select
                  value={securityQuestion}
                  onChange={(e) => setSecurityQuestion(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                >
                  {SECURITY_QUESTIONS_LIST.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Güvenlik Cevabı</label>
                <input
                  type="text"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  placeholder="Kurtarma için cevabınız"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-500/20 cursor-pointer"
              >
                Kayıt Ol ve Başla
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  className="text-xs text-slate-600 hover:text-blue-700 font-medium"
                >
                  Zaten hesabınız var mı? <span className="font-bold text-blue-700">Giriş Yapın</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-2 text-blue-700">
              <HelpCircle className="w-5 h-5" />
              <h3 className="font-bold text-slate-900">Şifre Kurtarma</h3>
            </div>

            {forgotStep === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Kayıtlı telefon numaranızı girin. Sistem güvenlik sorunuzu getirecektir.
                </p>
                <input
                  type="text"
                  value={forgotPhone}
                  onChange={(e) => setForgotPhone(e.target.value)}
                  placeholder="+90 5XX XXX XX XX"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <button
                  type="button"
                  onClick={handleForgotStep1}
                  className="w-full py-2 bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Doğrula ve İlerle
                </button>
              </div>
            )}

            {forgotStep === 2 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-800">
                  {foundUserQuestion}
                </p>
                <input
                  type="text"
                  value={forgotAnswer}
                  onChange={(e) => setForgotAnswer(e.target.value)}
                  placeholder="Cevabınız"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <button
                  type="button"
                  onClick={handleForgotStep2}
                  className="w-full py-2 bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cevabı Onayla
                </button>
              </div>
            )}

            {forgotStep === 3 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Güvenlik sorusu doğrulandı. Lütfen yeni şifrenizi belirleyin:
                </p>
                <input
                  type="password"
                  value={forgotNewPass}
                  onChange={(e) => setForgotNewPass(e.target.value)}
                  placeholder="Yeni Şifre (en az 6 karakter)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <button
                  type="button"
                  onClick={handleForgotStep3}
                  className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Şifreyi Güncelle
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowForgot(false);
                setForgotStep(1);
              }}
              className="w-full py-2 text-slate-500 hover:text-slate-700 text-xs font-medium cursor-pointer"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
