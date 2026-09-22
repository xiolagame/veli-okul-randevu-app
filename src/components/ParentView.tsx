import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment, TeacherProfile } from '../types';
import { QRCodePass } from './QRCodePass';
import {
  Calendar,
  Clock,
  User,
  Users,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  QrCode,
  ShieldCheck,
  ChevronRight,
  BookOpen,
  ArrowRight,
  Phone,
  HelpCircle,
  Bell,
} from 'lucide-react';

export const ParentView: React.FC = () => {
  const {
    currentUser,
    teachers,
    availability,
    appointments,
    settings,
    bookAppointment,
    cancelAppointment,
    addStudentToProfile,
    removeStudentFromProfile,
    notifications,
    markNotificationsAsRead,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'appointments' | 'notifications' | 'profile'>('home');
  const [selectedPassAppointment, setSelectedPassAppointment] = useState<Appointment | null>(null);

  // Booking Modal State
  const [bookingTeacher, setBookingTeacher] = useState<TeacherProfile | null>(null);
  const [bookingDate, setBookingDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [selectedSlotTime, setSelectedSlotTime] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<string>(
    currentUser?.students?.[0]?.name || ''
  );
  const [studentClass, setStudentClass] = useState<string>(
    currentUser?.students?.[0]?.className || '7-B'
  );
  const [bookingNotes, setBookingNotes] = useState<string>('');
  const [bookingSuccess, setBookingSuccess] = useState<boolean>(false);

  // Teacher Filter
  const [teacherSearch, setTeacherSearch] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('Tümü');

  // New Student Profile Form
  const [newStudentName, setNewStudentName] = useState<string>('');
  const [newStudentClass, setNewStudentClass] = useState<string>('');

  // Parent's appointments
  const parentAppointments = appointments.filter(
    (a) => a.parentId === currentUser?.id || a.parentPhone === currentUser?.phone
  );

  const upcomingAppointments = parentAppointments.filter(
    (a) => a.status === 'booked' || a.status === 'pending' || a.status === 'checked_in'
  );

  const pastAppointments = parentAppointments.filter(
    (a) => a.status === 'checked_out' || a.status === 'cancelled' || a.status === 'rejected'
  );

  // Next imminent appointment
  const nextAppointment = upcomingAppointments[0];

  // Distinct branches for filter
  const branches = ['Tümü', ...Array.from(new Set(teachers.map((t) => t.branch)))];

  const filteredTeachers = teachers.filter((t) => {
    const matchSearch =
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(teacherSearch.toLowerCase()) ||
      t.branch.toLowerCase().includes(teacherSearch.toLowerCase());
    const matchBranch = selectedBranch === 'Tümü' || t.branch === selectedBranch;
    return matchSearch && matchBranch;
  });

  const handleOpenBooking = (teacher: TeacherProfile) => {
    setBookingTeacher(teacher);
    setSelectedSlotTime('');
    setBookingNotes('');
    setBookingSuccess(false);
    if (currentUser?.students && currentUser.students.length > 0) {
      setSelectedStudent(currentUser.students[0].name);
      setStudentClass(currentUser.students[0].className);
    }
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingTeacher || !selectedSlotTime || !selectedStudent) return;

    // slot duration 15 min default
    const [h, m] = selectedSlotTime.split(':').map(Number);
    const endMinutes = m + settings.defaultSlotMinutes;
    const endH = endMinutes >= 60 ? h + 1 : h;
    const endM = endMinutes % 60;
    const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    bookAppointment({
      teacherId: bookingTeacher.id,
      studentName: selectedStudent,
      className: studentClass,
      date: bookingDate,
      startTime: selectedSlotTime,
      endTime: endTimeStr,
      notes: bookingNotes,
    });

    setBookingSuccess(true);
    setTimeout(() => {
      setBookingTeacher(null);
      setActiveTab('appointments');
    }, 1200);
  };

  // Generate slots for the selected teacher and date
  const getAvailableSlotsForTeacher = (teacherId: string, dateStr: string) => {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon .. 7=Sun

    const teacherAvail = availability.filter(
      (a) => a.teacherId === teacherId && (a.dayOfWeek === dayOfWeek || a.dayOfWeek === undefined)
    );

    // If teacher has defined hours for this day
    const slots: string[] = [];
    if (teacherAvail.length > 0) {
      teacherAvail.forEach((av) => {
        const [startH, startM] = av.startTime.split(':').map(Number);
        const [endH, endM] = av.endTime.split(':').map(Number);
        let curr = startH * 60 + startM;
        const end = endH * 60 + endM;
        while (curr < end) {
          const hh = Math.floor(curr / 60);
          const mm = curr % 60;
          slots.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
          curr += av.slotDurationMinutes || 15;
        }
      });
    } else {
      // Default slots if not specifically restricted
      slots.push('09:30', '10:00', '10:30', '11:00', '13:30', '14:00', '14:30');
    }

    // Filter out already booked slots
    const bookedForDay = appointments.filter(
      (a) =>
        a.teacherId === teacherId &&
        a.date === dateStr &&
        (a.status === 'booked' || a.status === 'pending' || a.status === 'checked_in')
    );

    return slots.map((s) => ({
      time: s,
      isBooked: bookedForDay.some((b) => b.startTime === s),
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 sm:pb-8">
      {/* Top Header Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Veli Portalı
              </span>
              <span className="text-xs text-slate-500 font-medium">{settings.schoolName}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
              Hoş Geldiniz, {currentUser?.firstName} {currentUser?.lastName}
            </h1>
          </div>

          {/* Desktop Tab Buttons */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: 'home', label: 'Ana Sayfa' },
              { id: 'teachers', label: 'Öğretmenler' },
              { id: 'appointments', label: `Randevularım (${upcomingAppointments.length})` },
              { id: 'notifications', label: 'Bildirimler' },
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

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* TAB 1: ANA SAYFA */}
        {activeTab === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Imminent Appointment Alert Card */}
            {nextAppointment ? (
              <div className="bg-gradient-to-r from-blue-700 to-indigo-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 -mr-8 -mt-8 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-white/20 rounded-full text-xs font-bold tracking-wide uppercase">
                        Sıradaki Randevunuz
                      </span>
                      {nextAppointment.status === 'booked' && (
                        <span className="px-2 py-0.5 bg-emerald-400/30 text-emerald-200 border border-emerald-300/30 rounded-full text-xs font-semibold">
                          Giriş İzni Onaylandı
                        </span>
                      )}
                      {nextAppointment.status === 'pending' && (
                        <span className="px-2 py-0.5 bg-amber-400/30 text-amber-200 border border-amber-300/30 rounded-full text-xs font-semibold">
                          Öğretmen Onayı Bekleniyor
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl font-black">
                      {nextAppointment.teacherName} ({nextAppointment.teacherBranch})
                    </h2>
                    <p className="text-sm text-blue-100 flex items-center gap-3">
                      <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {nextAppointment.date}</span>
                      <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {nextAppointment.startTime} - {nextAppointment.endTime}</span>
                      <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> {nextAppointment.studentName}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => setSelectedPassAppointment(nextAppointment)}
                      className="inline-flex items-center gap-2 px-5 py-3 bg-white text-blue-800 hover:bg-blue-50 font-bold rounded-xl text-sm shadow-md transition-all cursor-pointer"
                    >
                      <QrCode className="w-5 h-5" />
                      Giriş Kartı & QR Kod
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">Öğretmenlerimizle Randevu Oluşturun</h2>
                  <p className="text-xs text-blue-100 mt-1">
                    Öğrencinizin gelişim durumunu görüşmek için müsait gün ve saatlerde randevu talep edebilirsiniz.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('teachers')}
                  className="px-5 py-2.5 bg-white text-blue-700 hover:bg-blue-50 font-bold rounded-xl text-sm shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  Öğretmen Listesini Gör
                </button>
              </div>
            )}

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Aktif Randevular</span>
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{upcomingAppointments.length}</div>
                <p className="text-xs text-slate-400 mt-1">Görüşme planlanan randevular</p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Kayıtlı Öğrencilerim</span>
                  <Users className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{currentUser?.students?.length || 0}</div>
                <p className="text-xs text-slate-400 mt-1">
                  {currentUser?.students?.map((s) => `${s.name} (${s.className})`).join(', ') || 'Öğrenci eklenmedi'}
                </p>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Tamamlanan Görüşmeler</span>
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </div>
                <div className="text-3xl font-extrabold text-slate-900">{pastAppointments.length}</div>
                <p className="text-xs text-slate-400 mt-1">Geçmiş okul ziyaretleri</p>
              </div>
            </div>

            {/* Featured Teachers Quick Section */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Öğretmenler</h3>
                  <p className="text-xs text-slate-500">Görüşmek istediğiniz öğretmeni seçin</p>
                </div>
                <button
                  onClick={() => setActiveTab('teachers')}
                  className="text-xs font-bold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                >
                  Tümünü İncele <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teachers.slice(0, 3).map((teacher) => (
                  <div
                    key={teacher.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-blue-50/30 hover:border-blue-300 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-sm">
                          {teacher.firstName[0]}{teacher.lastName[0]}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">
                            {teacher.firstName} {teacher.lastName}
                          </h4>
                          <span className="text-xs text-blue-700 font-semibold">{teacher.branch}</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 mb-3">{teacher.bio}</p>
                    </div>
                    <button
                      onClick={() => handleOpenBooking(teacher)}
                      className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5" /> Randevu Al
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ÖĞRETMENLER LİSTESİ */}
        {activeTab === 'teachers' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Search & Branch Filter Header */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Öğretmen veya branş ara..."
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
                {branches.map((b) => (
                  <button
                    key={b}
                    onClick={() => setSelectedBranch(b)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      selectedBranch === b ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Teachers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredTeachers.map((teacher) => (
                <div
                  key={teacher.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black flex items-center justify-center text-lg shadow-xs">
                          {teacher.firstName[0]}{teacher.lastName[0]}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 text-base">
                            {teacher.firstName} {teacher.lastName}
                          </h3>
                          <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-md">
                            {teacher.branch}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 mb-4 min-h-[36px]">
                      {teacher.bio || 'Randevu takvimi üzerinden uygun saat seçerek görüşme talep edebilirsiniz.'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-medium">15 dk seans</span>
                    <button
                      onClick={() => handleOpenBooking(teacher)}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Calendar className="w-3.5 h-3.5" /> Randevu Al
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: RANDEVULARIM */}
        {activeTab === 'appointments' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Upcoming Appointments Section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-700" />
                  Yaklaşan Randevular ({upcomingAppointments.length})
                </h3>
              </div>

              {upcomingAppointments.length === 0 ? (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-500">
                  <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="font-semibold text-slate-700">Aktif randevunuz bulunmuyor</p>
                  <p className="text-xs text-slate-400 mt-1">Öğretmenler sekmesinden yeni bir randevu alabilirsiniz.</p>
                  <button
                    onClick={() => setActiveTab('teachers')}
                    className="mt-4 px-4 py-2 bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                  >
                    Öğretmen Seç ve Randevu Al
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {upcomingAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                              {apt.teacherBranch}
                            </span>
                            <h4 className="font-bold text-slate-900 text-base">{apt.teacherName}</h4>
                          </div>
                          <div>
                            {apt.status === 'booked' && (
                              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
                                Onaylandı
                              </span>
                            )}
                            {apt.status === 'pending' && (
                              <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold rounded-full">
                                Onay Bekliyor
                              </span>
                            )}
                            {apt.status === 'checked_in' && (
                              <span className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold rounded-full">
                                Okula Giriş Yapıldı
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Tarih</span>
                            <span className="font-semibold text-slate-800">{apt.date}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Saat</span>
                            <span className="font-bold text-slate-900">{apt.startTime} - {apt.endTime}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Öğrenci</span>
                            <span className="font-semibold text-slate-800">{apt.studentName} ({apt.className})</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Giriş Kodu</span>
                            <span className="font-mono font-bold text-blue-700">{apt.entryCode}</span>
                          </div>
                        </div>

                        {apt.notes && (
                          <p className="text-xs text-slate-600 bg-blue-50/40 p-2.5 rounded-lg border border-blue-100/60">
                            <span className="font-semibold text-slate-700">Not:</span> {apt.notes}
                          </p>
                        )}
                      </div>

                      <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                          onClick={() => setSelectedPassAppointment(apt)}
                          className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        >
                          <QrCode className="w-4 h-4" /> Giriş Belgesi (QR)
                        </button>
                        {settings.allowParentCancel && apt.status !== 'checked_in' && (
                          <button
                            onClick={() => cancelAppointment(apt.id)}
                            className="px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors cursor-pointer border border-transparent hover:border-red-200"
                          >
                            İptal Et
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Appointments */}
            {pastAppointments.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-3 text-slate-600">
                  Geçmiş ve Tamamlanan Randevular ({pastAppointments.length})
                </h3>
                <div className="space-y-3">
                  {pastAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{apt.teacherName} ({apt.teacherBranch})</div>
                        <div className="text-slate-500 mt-0.5">
                          {apt.date} • {apt.startTime} - {apt.endTime} • {apt.studentName} ({apt.className})
                        </div>
                      </div>
                      <div>
                        {apt.status === 'checked_out' && (
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 font-semibold rounded-full">
                            Tamamlandı (Çıkış: {apt.checkedOutAt})
                          </span>
                        )}
                        {apt.status === 'cancelled' && (
                          <span className="px-2.5 py-1 bg-red-50 text-red-700 font-semibold rounded-full">
                            İptal Edildi
                          </span>
                        )}
                        {apt.status === 'rejected' && (
                          <span className="px-2.5 py-1 bg-red-50 text-red-700 font-semibold rounded-full">
                            Reddedildi {apt.rejectionReason ? `(${apt.rejectionReason})` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: BİLDİRİMLER */}
        {activeTab === 'notifications' && (
          <div className="max-w-2xl mx-auto space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Bildirimleriniz</h3>
              <button
                onClick={markNotificationsAsRead}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                Tümünü Okundu İşaretle
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
              {notifications.filter((n) => n.userId === currentUser?.id).length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="font-medium text-slate-600">Henüz bildiriminiz bulunmuyor.</p>
                </div>
              ) : (
                notifications
                  .filter((n) => n.userId === currentUser?.id)
                  .map((notif) => (
                    <div key={notif.id} className={`p-4 ${notif.read ? 'bg-white' : 'bg-blue-50/40'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">{notif.title}</h4>
                          <p className="text-xs text-slate-600 mt-0.5">{notif.message}</p>
                          <span className="text-[10px] text-slate-400 mt-1 block">{notif.date}</span>
                        </div>
                        {notif.appointmentId && (
                          <button
                            onClick={() => {
                              const apt = appointments.find((a) => a.id === notif.appointmentId);
                              if (apt) setSelectedPassAppointment(apt);
                            }}
                            className="text-xs font-bold text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg shrink-0"
                          >
                            QR Kod
                          </button>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {/* TAB 5: PROFİL */}
        {activeTab === 'profile' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
            {/* Profile Info */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-black text-2xl flex items-center justify-center">
                  {currentUser?.firstName[0]}{currentUser?.lastName[0]}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {currentUser?.firstName} {currentUser?.lastName}
                  </h3>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> {currentUser?.phone}
                  </span>
                </div>
              </div>
            </div>

            {/* Students List */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Kayıtlı Öğrencilerim</h3>
                  <p className="text-xs text-slate-500">Randevu alırken bu listeden seçim yapabilirsiniz</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {currentUser?.students?.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                        {s.name[0]}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">{s.name}</div>
                        <div className="text-[11px] text-slate-500">Sınıf: {s.className}</div>
                      </div>
                    </div>
                    {currentUser.students && currentUser.students.length > 1 && (
                      <button
                        onClick={() => removeStudentFromProfile(s.id)}
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Öğrenciyi Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Student Form */}
              <div className="pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 block mb-2">Yeni Öğrenci Ekle:</span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="Öğrenci Adı Soyadı"
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Sınıf (Örn: 6-C)"
                    value={newStudentClass}
                    onChange={(e) => setNewStudentClass(e.target.value)}
                    className="w-full sm:w-28 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                  <button
                    onClick={() => {
                      if (newStudentName && newStudentClass) {
                        addStudentToProfile({ name: newStudentName, className: newStudentClass });
                        setNewStudentName('');
                        setNewStudentClass('');
                      }
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1 shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Ekle
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Booking Modal */}
      {bookingTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-xs text-blue-200 font-semibold uppercase tracking-wider block">
                  Randevu Talebi Oluştur
                </span>
                <h3 className="font-bold text-lg leading-tight">
                  {bookingTeacher.firstName} {bookingTeacher.lastName} ({bookingTeacher.branch})
                </h3>
              </div>
              <button
                onClick={() => setBookingTeacher(null)}
                className="text-white/80 hover:text-white p-1 rounded-full"
              >
                ✕
              </button>
            </div>

            {bookingSuccess ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-slate-900 text-lg">Randevu Talebiniz Alındı!</h4>
                <p className="text-xs text-slate-600">
                  Öğretmenimiz onayladığında onaylı giriş belgeniz ve 6 haneli QR kodunuz oluşturulacaktır.
                </p>
              </div>
            ) : (
              <form onSubmit={handleConfirmBooking} className="p-6 space-y-4">
                {/* Select Child */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Hangi Öğrenciniz İçin?
                  </label>
                  {currentUser?.students && currentUser.students.length > 0 ? (
                    <select
                      value={selectedStudent}
                      onChange={(e) => {
                        setSelectedStudent(e.target.value);
                        const match = currentUser.students?.find((s) => s.name === e.target.value);
                        if (match) setStudentClass(match.className);
                      }}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                    >
                      {currentUser.students.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name} ({s.className})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="Öğrenci Adı Soyadı"
                      value={selectedStudent}
                      onChange={(e) => setSelectedStudent(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  )}
                </div>

                {/* Date Picker */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Görüşme Tarihi
                  </label>
                  <input
                    type="date"
                    value={bookingDate}
                    onChange={(e) => {
                      setBookingDate(e.target.value);
                      setSelectedSlotTime('');
                    }}
                    min={new Date().toISOString().split('T')[0]}
                    required
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  />
                </div>

                {/* Available Slots */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Müsait Saat Seçimi (15 dk)
                  </label>
                  <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto p-1">
                    {getAvailableSlotsForTeacher(bookingTeacher.id, bookingDate).map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={slot.isBooked}
                        onClick={() => setSelectedSlotTime(slot.time)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                          slot.isBooked
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                            : selectedSlotTime === slot.time
                            ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-500'
                        }`}
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                  {!selectedSlotTime && (
                    <p className="text-[11px] text-amber-600 mt-1">Lütfen yukarıdan müsait bir saat seçiniz.</p>
                  )}
                </div>

                {/* Meeting Subject / Note */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Görüşme Konusu / Not (İsteğe Bağlı)
                  </label>
                  <textarea
                    rows={2}
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    placeholder="Örn: Sınav sonuçları, ders içi katılım veya genel rehberlik değerlendirmesi..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs resize-none"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBookingTeacher(null)}
                    className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedSlotTime}
                    className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-md shadow-blue-500/20"
                  >
                    Randevu Talebi Gönder
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Entry Pass Modal with QR */}
      {selectedPassAppointment && (
        <QRCodePass
          appointment={selectedPassAppointment}
          schoolName={settings.schoolName}
          onClose={() => setSelectedPassAppointment(null)}
        />
      )}

      {/* Mobile Bottom Navigation Bar (5 tabs matching PRD) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around py-2 z-40 shadow-lg">
        {[
          { id: 'home', label: 'Ana Sayfa', icon: BookOpen },
          { id: 'teachers', label: 'Öğretmenler', icon: Users },
          { id: 'appointments', label: 'Randevular', icon: Calendar, badge: upcomingAppointments.length },
          { id: 'notifications', label: 'Bildirimler', icon: Bell },
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
                <span className="absolute top-0 right-2 w-4 h-4 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
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
