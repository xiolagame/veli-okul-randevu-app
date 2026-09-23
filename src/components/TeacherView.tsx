import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment } from '../types';
import { QRCodePass } from './QRCodePass';
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Trash2,
  QrCode,
  Check,
  X,
  Phone,
  BookOpen,
  Settings,
  Bell,
} from 'lucide-react';

const DAYS_OF_WEEK = [
  { id: 1, name: 'Pazartesi' },
  { id: 2, name: 'Salı' },
  { id: 3, name: 'Çarşamba' },
  { id: 4, name: 'Perşembe' },
  { id: 5, name: 'Cuma' },
];

export const TeacherView: React.FC = () => {
  const {
    currentUser,
    appointments,
    availability,
    settings,
    approveAppointment,
    rejectAppointment,
    cancelAppointment,
    addAvailabilitySlot,
    removeAvailabilitySlot,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'home' | 'appointments' | 'availability' | 'profile'>('home');
  const [rejectingAptId, setRejectingAptId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [selectedPass, setSelectedPass] = useState<Appointment | null>(null);

  // New Availability Slot State
  const [newDay, setNewDay] = useState<number>(1);
  const [newStartTime, setNewStartTime] = useState<string>('09:30');
  const [newEndTime, setNewEndTime] = useState<string>('11:30');
  const [newDuration, setNewDuration] = useState<number>(15);

  // Teacher appointments
  const teacherAppointments = appointments.filter(
    (a) => a.teacherId === currentUser?.id
  );

  const pendingAppointments = teacherAppointments.filter((a) => a.status === 'pending');
  const bookedAppointments = teacherAppointments.filter(
    (a) => a.status === 'booked' || a.status === 'checked_in'
  );
  const completedAppointments = teacherAppointments.filter(
    (a) => a.status === 'checked_out' || a.status === 'cancelled' || a.status === 'rejected'
  );

  const teacherAvailability = availability.filter((av) => av.teacherId === currentUser?.id);

  const handleApprove = (id: string) => {
    approveAppointment(id);
  };

  const handleConfirmReject = () => {
    if (rejectingAptId) {
      rejectAppointment(rejectingAptId, rejectionReason);
      setRejectingAptId(null);
      setRejectionReason('');
    }
  };

  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    addAvailabilitySlot({
      dayOfWeek: newDay,
      startTime: newStartTime,
      endTime: newEndTime,
      slotDurationMinutes: newDuration,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 sm:pb-8">
      {/* Top Header Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-blue-800 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                Öğretmen Paneli
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {currentUser?.branch || 'Branş Öğretmeni'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              Öğr. {currentUser?.firstName} {currentUser?.lastName}
            </h1>
          </div>

          {/* Desktop Tabs */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: 'home', label: 'Ana Sayfa' },
              {
                id: 'appointments',
                label: `Randevular ${pendingAppointments.length > 0 ? `(${pendingAppointments.length} Bekleyen)` : ''}`,
              },
              { id: 'availability', label: 'Müsaitlik Programı' },
              { id: 'profile', label: 'Profil' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === tab.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* TAB 1: ANA SAYFA */}
        {activeTab === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Pending Requests Alert */}
            {pendingAppointments.length > 0 ? (
              <div className="bg-amber-500 text-white rounded-2xl p-6 shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">
                      Onay Bekleyen {pendingAppointments.length} Randevu Talebi Var!
                    </h2>
                    <p className="text-xs text-amber-100 mt-0.5">
                      Veliler sizden görüşme talep etti. Onaylanan randevular için güvenlik giriş kodu üretilecektir.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('appointments')}
                  className="px-4 py-2.5 bg-white text-amber-900 hover:bg-amber-50 font-bold rounded-xl text-xs transition-colors shrink-0 shadow-xs cursor-pointer"
                >
                  Talepleri İncele & Onayla
                </button>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">Randevu Programınız Güncel</h2>
                  <p className="text-xs text-blue-100 mt-1">
                    Bekleyen talep bulunmuyor. Randevu takviminiz velilere açıktır.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('availability')}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/30 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Müsaitlik Saatlerini Düzenle
                </button>
              </div>
            )}

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Bekleyen Talepler</span>
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{pendingAppointments.length}</div>
                <p className="text-xs text-slate-400 mt-1">Onayınızı bekleyen veliler</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Onaylanmış Randevular</span>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{bookedAppointments.length}</div>
                <p className="text-xs text-slate-400 mt-1">Planlanan veli görüşmeleri</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Tanımlı Haftalık Seanslar</span>
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{teacherAvailability.length}</div>
                <p className="text-xs text-slate-400 mt-1">Haftalık müsaitlik zaman dilimi</p>
              </div>
            </div>

            {/* Imminent Appointments List Preview */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-slate-900">Yaklaşan Veli Görüşmeleri</h3>
                <button
                  onClick={() => setActiveTab('appointments')}
                  className="text-xs font-bold text-blue-700 hover:text-blue-800"
                >
                  Tümünü Gör
                </button>
              </div>

              {bookedAppointments.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">Henüz onaylanmış randevunuz yok</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bookedAppointments.slice(0, 3).map((apt) => (
                    <div
                      key={apt.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">{apt.parentName}</h4>
                          <span className="text-xs text-slate-500">
                            (Öğrenci: {apt.studentName} - {apt.className})
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {apt.date}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {apt.startTime} - {apt.endTime}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {apt.status === 'checked_in' ? (
                          <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">
                            Okula Giriş Yaptı ({apt.checkedInAt})
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                            Onaylandı
                          </span>
                        )}
                        <button
                          onClick={() => setSelectedPass(apt)}
                          className="p-2 text-slate-600 hover:text-blue-700 hover:bg-white rounded-lg border border-slate-200 transition-colors"
                          title="Giriş Kartını İncele"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: RANDEVULAR & ONAY İŞLEMLERİ */}
        {activeTab === 'appointments' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Pending Requests */}
            <div>
              <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                Onay Bekleyen Talepler ({pendingAppointments.length})
              </h3>

              {pendingAppointments.length === 0 ? (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-slate-500">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                  <p className="font-semibold text-slate-800 text-sm">Bekleyen talep bulunmuyor</p>
                  <p className="text-xs text-slate-400 mt-0.5">Velilerden yeni randevu talebi geldiğinde burada görünecektir.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="bg-white rounded-2xl border-2 border-amber-200 p-5 shadow-xs flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                              Yeni Talep
                            </span>
                            <h4 className="font-bold text-slate-900 text-base mt-1">{apt.parentName}</h4>
                            <p className="text-xs text-slate-500">Telefon: {apt.parentPhone}</p>
                          </div>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Öğrenci:</span>
                            <span className="font-semibold text-slate-800">{apt.studentName} ({apt.className})</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Tarih & Saat:</span>
                            <span className="font-bold text-slate-900">{apt.date} • {apt.startTime} - {apt.endTime}</span>
                          </div>
                        </div>

                        {apt.notes && (
                          <p className="text-xs text-slate-700 bg-blue-50/50 p-2.5 rounded-lg border border-blue-100">
                            <span className="font-semibold text-slate-900">Veli Notu:</span> {apt.notes}
                          </p>
                        )}
                      </div>

                      <div className="pt-4 mt-3 border-t border-slate-100 flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(apt.id)}
                          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Check className="w-4 h-4" /> Onayla (QR Üret)
                        </button>
                        <button
                          onClick={() => setRejectingAptId(apt.id)}
                          className="px-3.5 py-2.5 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-bold rounded-xl transition-colors cursor-pointer border border-red-200"
                        >
                          Reddet
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Approved & Active Appointments */}
            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Onaylanmış Randevular ({bookedAppointments.length})
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bookedAppointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{apt.parentName}</h4>
                          <span className="text-xs text-slate-500">
                            Öğrenci: {apt.studentName} ({apt.className})
                          </span>
                        </div>
                        {apt.status === 'checked_in' ? (
                          <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">
                            Okula Giriş Yaptı ({apt.checkedInAt})
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                            Onaylandı
                          </span>
                        )}
                      </div>

                      <div className="p-2.5 bg-slate-50 rounded-xl text-xs flex items-center justify-between">
                        <span>{apt.date} • {apt.startTime} - {apt.endTime}</span>
                      </div>
                    </div>

                    <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedPass(apt)}
                        className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" /> Giriş Kartı
                      </button>
                      <button
                        onClick={() => cancelAppointment(apt.id)}
                        className="px-3 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 text-xs font-semibold rounded-lg"
                      >
                        İptal
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MÜSAİTLİK PROGRAMI */}
        {activeTab === 'availability' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Add New Availability Slot Form */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="text-base font-bold text-slate-900 mb-1">Yeni Müsaitlik Zamanı Ekle</h3>
              <p className="text-xs text-slate-500 mb-4">
                Velilerin bu saat aralıklarında randevu alabilmesi için haftalık programınızı tanımlayın.
              </p>

              <form onSubmit={handleAddSlot} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Gün</label>
                  <select
                    value={newDay}
                    onChange={(e) => setNewDay(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Başlangıç</label>
                  <input
                    type="time"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Bitiş</label>
                  <input
                    type="time"
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" /> Zaman Dilimini Kaydet
                </button>
              </form>
            </div>

            {/* Current Availability List */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="text-base font-bold text-slate-900 mb-3">Tanımlı Haftalık Saatleriniz</h3>

              {teacherAvailability.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">Henüz bir müsaitlik tanımlanmamış</p>
                  <p className="text-xs text-slate-400 mt-1">Yukarıdaki form ile uygun saatlerinizi ekleyin.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {teacherAvailability.map((slot) => {
                    const dayName = DAYS_OF_WEEK.find((d) => d.id === slot.dayOfWeek)?.name || 'Hafta İçi';
                    return (
                      <div key={slot.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-24 text-xs font-bold text-slate-900">{dayName}</span>
                          <span className="px-3 py-1 bg-blue-50 text-blue-800 text-xs font-semibold rounded-lg">
                            {slot.startTime} - {slot.endTime}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            (Her seans {slot.slotDurationMinutes} dakika)
                          </span>
                        </div>
                        <button
                          onClick={() => removeAvailabilitySlot(slot.id)}
                          className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PROFİL */}
        {activeTab === 'profile' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black text-2xl flex items-center justify-center">
                  {currentUser?.firstName[0]}{currentUser?.lastName[0]}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Öğr. {currentUser?.firstName} {currentUser?.lastName}
                  </h3>
                  <p className="text-xs font-semibold text-blue-700">{currentUser?.branch}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{currentUser?.phone}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Reject Reason Modal */}
      {rejectingAptId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="w-5 h-5" />
              <h4 className="font-bold text-slate-900 text-sm">Randevuyu Reddet</h4>
            </div>
            <p className="text-xs text-slate-600">
              Lütfen veliye iletilmek üzere bir ret gerekçesi belirtiniz (isteğe bağlı):
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Örn: O saatte zümre toplantım bulunmaktadır..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRejectingAptId(null)}
                className="flex-1 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold"
              >
                Reddet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Pass Inspection Modal */}
      {selectedPass && (
        <QRCodePass
          appointment={selectedPass}
          schoolName={settings.schoolName}
          onClose={() => setSelectedPass(null)}
        />
      )}

      {/* Mobile Bottom Navigation Bar (4 tabs matching PRD) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around py-2 z-40 shadow-lg">
        {[
          { id: 'home', label: 'Ana Sayfa', icon: BookOpen },
          { id: 'appointments', label: 'Randevular', icon: Calendar, badge: pendingAppointments.length },
          { id: 'availability', label: 'Müsaitlik', icon: Clock },
          { id: 'profile', label: 'Profil', icon: User },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`flex flex-col items-center justify-center p-1 relative text-[10px] font-semibold transition-colors ${
                isActive ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-0 right-2 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
