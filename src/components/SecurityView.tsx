import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getTodayDateString } from '../data/mockData';
import { Appointment, SecurityQrVerification } from '../types';
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ArrowRight,
  LogOut,
  Calendar,
  LogIn,
  Check,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { appointments, verifySecurityQr, checkInVisitor, checkOutVisitor, settings } = useApp();
  const todayStr = getTodayDateString();

  const [inputCode, setInputCode] = useState<string>('');
  const [verifyResult, setVerifyResult] = useState<SecurityQrVerification | null>(null);

  const [segment, setSegment] = useState<'all' | 'expected' | 'inside' | 'done'>('all');

  // Filter today's appointments
  const todayAppointments = appointments.filter((a) => a.date === todayStr);

  const expectedVisitors = todayAppointments.filter((a) => a.status === 'booked');
  const insideVisitors = todayAppointments.filter((a) => a.status === 'checked_in');
  const checkedOutVisitors = todayAppointments.filter((a) => a.status === 'checked_out');

  const displayedAppointments = todayAppointments.filter((a) => {
    if (segment === 'expected') return a.status === 'booked';
    if (segment === 'inside') return a.status === 'checked_in';
    if (segment === 'done') return a.status === 'checked_out';
    return true;
  });

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    const res = await verifySecurityQr(inputCode.trim());
    setVerifyResult(res);
  };

  const handleCheckIn = async () => {
    if (!inputCode.trim()) return;
    const res = await checkInVisitor(inputCode.trim());
    setVerifyResult(res);
    if (res.allowed) setInputCode('');
  };

  const handleManualCheckOut = async (id: string) => {
    await checkOutVisitor(id);
    setVerifyResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Top Header Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                Okul Güvenlik Kapısı
              </span>
              <span className="text-xs text-slate-500 font-medium">{settings.schoolName}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              Giriş - Çıkış Kontrol Paneli
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <Calendar className="w-4 h-4 text-blue-700" />
            Bugünün Tarihi: <span className="font-bold text-slate-800">{todayStr}</span>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Verification Scanner / Code Box */}
        <div className="bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-2xl p-6 shadow-xl border border-slate-800">
          <div className="max-w-2xl mx-auto space-y-4 text-center sm:text-left">
            <div className="flex items-center gap-2.5 justify-center sm:justify-start">
              <div className="p-2 bg-blue-600/30 rounded-xl border border-blue-500/40">
                <ShieldCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">QR Randevu Doğrulama</h2>
                <p className="text-xs text-slate-300">
                  Velinin gösterdiği QR içeriğini giriniz. Giriş kaydı, ayrı bir onaydan sonra oluşturulur.
                </p>
              </div>
            </div>

            <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <div className="relative flex-1">
                <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  maxLength={80}
                  placeholder="VELIQR1:..."
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.trim())}
                  className="w-full pl-11 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-lg font-mono font-bold tracking-widest text-white placeholder:text-slate-400 placeholder:font-sans placeholder:text-sm placeholder:tracking-normal focus:outline-hidden focus:ring-2 focus:ring-blue-400 focus:bg-white/15"
                />
              </div>
              <button
                type="submit"
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                <Search className="w-4 h-4" /> QR'ı Doğrula
              </button>
            </form>

            {/* Verification Result Feedback */}
            {verifyResult && (
              <div
                className={`p-4 rounded-xl text-xs font-semibold flex items-start gap-3 mt-3 animate-in fade-in ${
                  verifyResult.allowed
                    ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-500/50'
                    : 'bg-red-950/80 text-red-200 border border-red-500/50'
                }`}
              >
                {verifyResult.allowed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-bold">{verifyResult.title}</p>
                  <p className="mt-1 font-normal">{verifyResult.message}</p>
                  {verifyResult.appointment && (
                    <div className="mt-1 text-slate-300 font-normal">
                      Öğretmen: {verifyResult.appointment.teacherName} • Saat: {verifyResult.appointment.startTime} - {verifyResult.appointment.endTime}
                    </div>
                  )}
                </div>
              </div>
            )}
            {verifyResult?.allowed && (
              <button type="button" onClick={handleCheckIn} className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-all shadow-md">
                GİRİŞİ KAYDET
              </button>
            )}
          </div>
        </div>

        {/* Real-time Today Status Counters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            onClick={() => setSegment('expected')}
            className={`p-5 rounded-2xl border transition-all cursor-pointer ${
              segment === 'expected'
                ? 'bg-amber-50/70 border-amber-300 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                Giriş Bekleyenler
              </span>
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="text-3xl font-extrabold text-slate-900">{expectedVisitors.length}</div>
            <p className="text-xs text-slate-500 mt-1">Henüz okula gelmemiş onaylı veliler</p>
          </div>

          <div
            onClick={() => setSegment('inside')}
            className={`p-5 rounded-2xl border transition-all cursor-pointer ${
              segment === 'inside'
                ? 'bg-blue-50/70 border-blue-300 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                Şu An Okulda (İçeride)
              </span>
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-extrabold text-blue-700">{insideVisitors.length}</div>
            <p className="text-xs text-slate-500 mt-1">Giriş yapmış, görüşmedeki ziyaretçiler</p>
          </div>

          <div
            onClick={() => setSegment('done')}
            className={`p-5 rounded-2xl border transition-all cursor-pointer ${
              segment === 'done'
                ? 'bg-purple-50/70 border-purple-300 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800">
                Çıkış Yapanlar
              </span>
              <LogOut className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-extrabold text-slate-900">{checkedOutVisitors.length}</div>
            <p className="text-xs text-slate-500 mt-1">Ziyareti bitip ayrılanlar</p>
          </div>
        </div>

        {/* Today's List Table / Cards */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Bugünkü Randevu Kayıtları</h3>
              <p className="text-xs text-slate-500">Bugün randevusu olan veliler ve ziyaret durumları</p>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              {[
                { id: 'all', label: 'Tümü' },
                { id: 'expected', label: `Bekleyen (${expectedVisitors.length})` },
                { id: 'inside', label: `İçeride (${insideVisitors.length})` },
                { id: 'done', label: `Çıkış (${checkedOutVisitors.length})` },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSegment(item.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    segment === item.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {displayedAppointments.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="font-semibold text-slate-700 text-sm">Bu filtreye uygun randevu kaydı bulunamadı</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayedAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{apt.parentName}</span>
                      <span className="text-xs text-slate-500 font-mono">({apt.parentPhone})</span>
                      {apt.status === 'booked' && (
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-bold rounded-full border border-amber-200">
                          Giriş Bekleniyor
                        </span>
                      )}
                      {apt.status === 'checked_in' && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[11px] font-bold rounded-full border border-blue-200">
                          İçeride (Giriş: {apt.checkedInAt})
                        </span>
                      )}
                      {apt.status === 'checked_out' && (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-bold rounded-full border border-slate-200">
                          Çıkış Yapıldı ({apt.checkedOutAt})
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-3">
                      <span>
                        <span className="text-slate-400">Öğrenci:</span> {apt.studentName} ({apt.className})
                      </span>
                      <span>
                        <span className="text-slate-400">Görüşülecek:</span> {apt.teacherName} ({apt.teacherBranch})
                      </span>
                      <span>
                        <span className="text-slate-400">Saat:</span> {apt.startTime} - {apt.endTime}
                      </span>
                      <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                      </span>
                    </div>
                  </div>

                  {/* Security Action Buttons */}
                  <div className="flex items-center gap-2">
                    {apt.status === 'booked' && (
                      <button
                        onClick={() => { if (apt.qrToken) { setInputCode(apt.qrToken); void verifySecurityQr(apt.qrToken).then(setVerifyResult); } }}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Search className="w-3.5 h-3.5" /> QR'ı Doğrula
                      </button>
                    )}
                    {apt.status === 'checked_in' && (
                      <button
                        onClick={() => handleManualCheckOut(apt.id)}
                        className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Çıkış Yapıldı
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
