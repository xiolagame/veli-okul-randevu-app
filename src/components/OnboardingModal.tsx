import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { School, Student } from '../types';
import {
  QrCode,
  Building2,
  Phone,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  Sparkles,
  Users,
  GraduationCap,
} from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSchoolCode?: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose, initialSchoolCode }) => {
  const { switchSchool, refreshCurrentSchoolData, schools } = useApp();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [schoolCodeInput, setSchoolCodeInput] = useState(initialSchoolCode || '');
  const [resolvedSchool, setResolvedSchool] = useState<School | null>(null);

  const [phone, setPhone] = useState('+905554443322'); // Sample unregistered parent on Okul A roster
  const [otpCode, setOtpCode] = useState('');
  const [debugOtp, setDebugOtp] = useState<string | null>(null);

  const [matchedParentName, setMatchedParentName] = useState('');
  const [matchedStudents, setMatchedStudents] = useState<
    { rosterId: string; studentName: string; className: string; studentNumber?: string; isClaimed: boolean }[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Step 1 -> Step 2: Resolve School Context from Code / QR
  const handleResolveSchool = async (codeToUse?: string) => {
    const code = (codeToUse || schoolCodeInput).trim();
    if (!code) {
      setError('Lütfen bir okul davet veya QR kodu giriniz.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.getSchoolContext(code);
      setResolvedSchool(res.school);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Okul kodu bulunamadı. Lütfen kontrol ediniz.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 -> Step 3: Send SMS OTP
  const handleSendOtp = async () => {
    if (!phone || phone.length < 10) {
      setError('Geçerli bir telefon numarası giriniz.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.sendOtp(phone, resolvedSchool?.id);
      if (res.debugOtpCode) {
        setDebugOtp(res.debugOtpCode);
        setOtpCode(res.debugOtpCode);
      }
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'SMS kodu gönderilemedi.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3 -> Step 4: Verify SMS OTP & Check Roster
  const handleVerifyOtpAndCheckRoster = async () => {
    if (!otpCode || otpCode.length < 4) {
      setError('Lütfen 6 haneli SMS kodunu giriniz.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Verify OTP
      await api.verifyOtp(phone, otpCode, resolvedSchool?.id);

      // 2. Anti-enumeration roster check for this verified caller
      const rosterRes = await api.checkRoster(resolvedSchool!.id);

      setMatchedParentName(rosterRes.parentName);
      setMatchedStudents(rosterRes.students);
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Doğrulama başarısız.');
    } finally {
      setLoading(false);
    }
  };

  // Step 4 -> Step 5: Claim & Create Membership
  const handleConfirmAndJoin = async () => {
    if (!resolvedSchool) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.claimStudents(resolvedSchool.id);
      setSuccessMessage(res.message || 'Okul üyeliğiniz ve öğrenci bağınız başarıyla kuruldu!');
      setStep(5);

      // Automatically switch to the newly onboarded school
      await switchSchool(resolvedSchool.id);
      await refreshCurrentSchoolData();
    } catch (err: any) {
      setError(err.message || 'Üyelik oluşturulurken bir hata meydana geldi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-blue-200 text-xs font-semibold uppercase tracking-wider mb-1">
            <QrCode className="w-4 h-4" />
            <span>Güvenli Okul Onboarding & Kayıt</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Okula Katılma / Yeni Veli Kaydı</h2>
          <p className="text-xs text-blue-100 mt-1">
            Kütük kontrolü ve SMS doğrulaması ile yetkilendirilmiş veli üyeliği
          </p>

          {/* Stepper Progress */}
          <div className="flex items-center gap-1.5 mt-4">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  step >= s ? 'bg-white' : 'bg-white/30'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Hata Oluştu</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* STEP 1: School Code / QR input */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  1. Okul Davet Kodu veya QR Kodu
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Okul yönetiminizden veya web sitesinden aldığınız okul kodunu giriniz (QR okutma simülasyonu).
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={schoolCodeInput}
                    onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase())}
                    placeholder="Örn: KAZAN2025 veya ATATURK06"
                    className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono uppercase tracking-wider focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleResolveSchool()}
                    disabled={loading || !schoolCodeInput}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Doğrula</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Quick test buttons for easy reviewer workflow */}
              <div className="pt-3 border-t border-slate-100">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Örnek Okul Kodları (Tıklayarak Seçebilirsiniz):
                </p>
                <div className="space-y-2">
                  {schools.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSchoolCodeInput(s.code);
                        handleResolveSchool(s.code);
                      }}
                      className="w-full p-2.5 text-left border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl transition-all flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <div className="font-semibold text-xs text-slate-900">{s.name}</div>
                        <div className="text-[11px] text-slate-500">{s.city}, {s.district}</div>
                      </div>
                      <span className="font-mono text-xs font-bold bg-slate-100 text-blue-700 px-2 py-0.5 rounded border border-slate-200">
                        {s.code}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Phone Input */}
          {step === 2 && resolvedSchool && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
                <Building2 className="w-6 h-6 text-blue-700 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-blue-900">{resolvedSchool.name}</div>
                  <div className="text-[11px] text-blue-700">Kod: {resolvedSchool.code} ({resolvedSchool.city})</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  2. Cep Telefonu Numaranız
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Okul kütüğünde kayıtlı olan veli cep telefonunuzu giriniz. Bu numaraya tek kullanımlık SMS kodu iletilecektir.
                </p>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+90555..."
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Sample test phones hint */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                <p className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  Test İçin Hazır Kütük Numaraları:
                </p>
                <ul className="space-y-1 text-[11px]">
                  <li>• <button onClick={() => setPhone('+905554443322')} className="text-blue-600 font-mono hover:underline">+905554443322</button> : Ayşe Çetin (Selin Çetin velisi, Okul A)</li>
                  <li>• <button onClick={() => setPhone('+905551234567')} className="text-blue-600 font-mono hover:underline">+905551234567</button> : Ahmet Yılmaz (Mert Yılmaz velisi, Okul B)</li>
                  <li>• <button onClick={() => setPhone('+905553332211')} className="text-blue-600 font-mono hover:underline">+905553332211</button> : Kemal Aksoy (Barış Aksoy velisi, Okul B)</li>
                  <li>• <button onClick={() => setPhone('+905550009999')} className="text-red-500 font-mono hover:underline">+905550009999</button> : Kayıtsız Numara (Eşleşme Hatası Testi)</li>
                </ul>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Geri
                </button>
                <button
                  onClick={handleSendOtp}
                  disabled={loading || !phone}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>SMS Doğrulama Kodu Gönder</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SMS OTP Verification */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">SMS Kodunu Giriniz</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong className="text-slate-800 font-mono">{phone}</strong> numarasına gönderilen 6 haneli kodu giriniz.
                </p>
                {debugOtp && (
                  <div className="inline-block mt-2 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono rounded-lg">
                    Test Kodu: <strong>{debugOtp}</strong> (veya 123456)
                  </div>
                )}
              </div>

              <div>
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full text-center tracking-[0.5em] text-xl font-bold py-3 bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Geri
                </button>
                <button
                  onClick={handleVerifyOtpAndCheckRoster}
                  disabled={loading || otpCode.length < 4}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Doğrula ve Kütüğü Tara</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Roster Match Found -> Confirmation */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Kütük Eşleşmesi Doğrulandı!</span>
                </div>
                <p className="text-xs text-emerald-700 mt-1">
                  Sayın <strong>{matchedParentName}</strong>, okul veritabanında telefonunuzla eşleşen {matchedStudents.length} öğrenci kaydı bulundu.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-blue-600" />
                  Bağlanacak Öğrenci Bilgileri:
                </label>
                <div className="space-y-2">
                  {matchedStudents.map((st, i) => (
                    <div
                      key={st.rosterId || i}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900">{st.studentName}</div>
                        <div className="text-[11px] text-slate-500">
                          Sınıf: <span className="font-semibold text-slate-700">{st.className}</span>
                          {st.studentNumber && (
                            <span className="ml-2 font-mono">No: {st.studentNumber}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                        Doğrulanmış Kayıt
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                Onayladığınızda <strong>{resolvedSchool?.name}</strong> için veli üyeliğiniz (SchoolMembership) ve veli-öğrenci ilişkiniz oluşturulacaktır.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  onClick={handleConfirmAndJoin}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Users className="w-4 h-4" />
                  <span>Öğrencilerimi Onayla ve Okula Katıl</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Success Complete */}
          {step === 5 && (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Tebrikler! Okul Üyeliğiniz Aktifleşti</h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto">
                  {successMessage}
                </p>
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 font-medium inline-block">
                  Aktif Okulunuz: <strong>{resolvedSchool?.name}</strong>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Randevu Sistemine Devam Et
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
