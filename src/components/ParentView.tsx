import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment, TeacherProfile } from '../types';
import { Alert, Button, Dialog, EmptyState, Metric, PageHeader, RoleNavigation, StatusBadge, StepIndicator } from './ui';
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
  QrCode,
  ChevronRight,
  BookOpen,
  ArrowRight,
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
  const [bookingError, setBookingError] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [actionError, setActionError] = useState('');
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
    setBookingError('');
    if (currentUser?.students && currentUser.students.length > 0) {
      setSelectedStudent(currentUser.students[0].name);
      setStudentClass(currentUser.students[0].className);
    }
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingTeacher || !selectedSlotTime || !selectedStudent) return;

    // slot duration 15 min default
    const [h, m] = selectedSlotTime.split(':').map(Number);
    const endMinutes = m + settings.defaultSlotMinutes;
    const endH = endMinutes >= 60 ? h + 1 : h;
    const endM = endMinutes % 60;
    const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    setBookingBusy(true);
    setBookingError('');
    try {
    await bookAppointment({
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
    } catch {
      setBookingError('Randevu talebiniz gönderilemedi. Bilgilerinizi kontrol edip yeniden deneyin.');
    } finally {
      setBookingBusy(false);
    }
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

  const navigation = [
    { id: 'home' as const, label: 'Ana sayfa', icon: BookOpen },
    { id: 'teachers' as const, label: 'Öğretmenler', icon: Users },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar, count: upcomingAppointments.length },
    { id: 'notifications' as const, label: 'Bildirimler', icon: Bell },
    { id: 'profile' as const, label: 'Profil', icon: User },
  ];

  const appointmentCard = (appointment: Appointment) => (
    <article className="appointment-card" key={appointment.id}>
      <div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div>
      <div className="appointment-detail">
        <div className="appointment-top"><div><h3>{appointment.teacherName}</h3><p>{appointment.teacherBranch}</p></div><StatusBadge status={appointment.status} /></div>
        <div className="detail-row"><span><Calendar size={15} />{appointment.date}</span><span><User size={15} />{appointment.studentName} · {appointment.className}</span></div>
        {appointment.rejectionReason && <p className="mt-3 text-red-700">{appointment.rejectionReason}</p>}
        {appointment.notes && <p className="mt-3">Notunuz: {appointment.notes}</p>}
        <div className="appointment-actions">
          <Button variant="secondary" onClick={() => setSelectedPassAppointment(appointment)}><QrCode size={17} />Giriş kartı</Button>
          {settings.allowParentCancel && (appointment.status === 'booked' || appointment.status === 'pending') && <Button variant="quiet" onClick={() => { setActionError(''); void cancelAppointment(appointment.id).catch(() => setActionError('Randevu iptal edilemedi. Lütfen tekrar deneyin.')); }}>Randevuyu iptal et</Button>}
        </div>
      </div>
    </article>
  );

  const teacherCard = (teacher: TeacherProfile) => (
    <article key={teacher.id} className="surface teacher-card">
      <div className="flex items-center gap-3"><span className="avatar">{teacher.firstName[0]}{teacher.lastName[0]}</span><div><h3>{teacher.firstName} {teacher.lastName}</h3><p>{teacher.branch}</p></div></div>
      <p>{teacher.bio || 'Uygun bir gün ve saat seçerek görüşme planlayın.'}</p>
      <Button variant="secondary" onClick={() => handleOpenBooking(teacher)}>Randevu al<ArrowRight size={16} /></Button>
    </article>
  );

  return (
    <main id="main-content" className="page-shell">
      <PageHeader eyebrow="VELİ ALANI" title={activeTab === 'home' ? `Merhaba, ${currentUser?.firstName}.` : navigation.find((item) => item.id === activeTab)?.label} description={activeTab === 'home' ? 'Okul hayatına birlikte, bir adım daha yakın.' : settings.schoolName} action={activeTab !== 'teachers' && <Button onClick={() => setActiveTab('teachers')}><Plus size={18} />Yeni randevu al</Button>} />
      <RoleNavigation items={navigation} active={activeTab} onChange={setActiveTab} />
      {actionError && <div className="mb-5"><Alert tone="danger">{actionError}</Alert></div>}

      {activeTab === 'home' && <div className="space-y-7">
        {nextAppointment ? <section className="hero-card">
          <div><p className="eyebrow">SIRADAKİ GÖRÜŞMENİZ</p><StatusBadge status={nextAppointment.status} /><h2>{nextAppointment.teacherName}</h2><p>{nextAppointment.teacherBranch} · {nextAppointment.studentName}</p><div className="detail-row"><span><Calendar size={16} />{nextAppointment.date}</span><span><Clock size={16} />{nextAppointment.startTime} – {nextAppointment.endTime}</span></div></div>
          <Button onClick={() => setSelectedPassAppointment(nextAppointment)}><QrCode size={19} />Giriş kartını aç</Button>
        </section> : <section className="hero-card"><div><p className="eyebrow">BİR GÖRÜŞMEYLE BAŞLAR</p><h2>Gelişimini birlikte destekleyin.</h2><p>Öğretmeninizle görüşmek için size uygun bir zaman seçin.</p><Button className="mt-6" onClick={() => setActiveTab('teachers')}>İlk randevunuzu planlayın<ArrowRight size={18} /></Button></div><span className="hero-symbol"><Calendar size={40} strokeWidth={1.5} /></span></section>}
        <div className="metric-grid"><Metric label="Aktif randevu" value={upcomingAppointments.length} icon={Calendar} /><Metric label="Öğrencilerim" value={currentUser?.students?.length || 0} icon={Users} /><Metric label="Geçmiş randevu" value={pastAppointments.length} icon={CheckCircle2} /></div>
        <section><div className="section-heading"><div><h2>Öğretmenlerinizle tanışın</h2><p>Görüşmek istediğiniz öğretmeni seçin.</p></div><Button variant="quiet" onClick={() => setActiveTab('teachers')}>Tüm öğretmenler<ChevronRight size={17} /></Button></div>
          {teachers.length ? <div className="teacher-grid">{teachers.slice(0, 3).map(teacherCard)}</div> : <div className="surface"><EmptyState icon={Users} title="Öğretmen listesi henüz hazır değil" description="Okulunuzun öğretmenleri burada listelenecek." /></div>}
        </section>
      </div>}

      {activeTab === 'teachers' && <section>
        <div className="filter-bar">
          <label className="field" htmlFor="teacher-search">Öğretmen veya branş ara<div className="field-icon"><Search size={18} /><input id="teacher-search" value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} placeholder="İsim veya branş yazın" /></div></label>
          <label className="field" htmlFor="teacher-branch">Branş<select id="teacher-branch" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        </div>
        {filteredTeachers.length ? <div className="teacher-grid">{filteredTeachers.map(teacherCard)}</div> : <div className="surface"><EmptyState icon={Search} title="Öğretmen bulunamadı" description="Farklı bir isim veya branş ile aramayı deneyin." /></div>}
      </section>}

      {activeTab === 'appointments' && <div className="space-y-8">
        <section><div className="section-heading"><h2>Yaklaşan görüşmeler <span className="text-slate-500">({upcomingAppointments.length})</span></h2></div>
          {upcomingAppointments.length ? <div className="space-y-4">{upcomingAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Henüz randevunuz yok" description="Öğretmeninizle görüşme planlamak için yeni bir randevu oluşturabilirsiniz." action={<Button onClick={() => setActiveTab('teachers')}>Randevu oluştur<ArrowRight size={17} /></Button>} /></div>}
        </section>
        {pastAppointments.length > 0 && <section><div className="section-heading"><h2>Geçmiş randevular</h2></div><div className="space-y-4">{pastAppointments.map(appointmentCard)}</div></section>}
      </div>}

      {activeTab === 'notifications' && <section className="surface">
        <div className="section-heading"><h2>Okulunuzdan haberler</h2><Button variant="quiet" onClick={markNotificationsAsRead}>Tümünü okundu işaretle</Button></div>
        {notifications.filter((notification) => notification.userId === currentUser?.id).length ? <div className="divide-y divide-slate-200">{notifications.filter((notification) => notification.userId === currentUser?.id).map((notification) => <article className="py-5 flex gap-4 items-start" key={notification.id}><span className="avatar"><Bell size={20} /></span><div className="flex-1 min-w-0"><h3 className="font-bold text-sm">{notification.title}{!notification.read && <span className="ml-2 text-blue-700 text-xs">Yeni</span>}</h3><p className="text-sm text-slate-600 mt-2">{notification.message}</p><p className="text-xs text-slate-500 mt-2">{notification.date}</p>{notification.appointmentId && <Button variant="quiet" className="mt-2" onClick={() => { const appointment = appointments.find((item) => item.id === notification.appointmentId); if (appointment) setSelectedPassAppointment(appointment); }}>Giriş kartını gör<QrCode size={16} /></Button>}</div></article>)}</div> : <EmptyState icon={Bell} title="Şimdilik her şey güncel" description="Randevularınızla ilgili gelişmeler burada görünecek." />}
      </section>}

      {activeTab === 'profile' && <div className="max-w-2xl space-y-6">
        <section className="surface flex items-center gap-4"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><div><h2 className="text-xl font-bold">{currentUser?.firstName} {currentUser?.lastName}</h2><p className="text-sm text-slate-500 mt-1">{currentUser?.phone}</p></div></section>
        <section className="surface"><div className="section-heading"><div><h2>Öğrencilerim</h2><p>Görüşmelerinizde bu öğrencilerden seçim yapabilirsiniz.</p></div></div>
          <div className="space-y-3">{currentUser?.students?.map((student) => <div key={student.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50"><div><h3 className="font-semibold text-sm">{student.name}</h3><p className="text-xs text-slate-500">{student.className}</p></div>{currentUser.students && currentUser.students.length > 1 && <button type="button" className="icon-button" onClick={() => removeStudentFromProfile(student.id)} aria-label={`${student.name} öğrencisini kaldır`}><Trash2 size={18} /></button>}</div>)}</div>
          <div className="form-stack mt-6 pt-6 border-t border-slate-200"><h3 className="font-semibold">Öğrenci ekle</h3><label className="field" htmlFor="student-name">Öğrenci adı soyadı<input id="student-name" value={newStudentName} onChange={(event) => setNewStudentName(event.target.value)} placeholder="Adı soyadı" /></label><label className="field" htmlFor="student-class">Sınıf<input id="student-class" value={newStudentClass} onChange={(event) => setNewStudentClass(event.target.value)} placeholder="Örn. 5-A" /></label><Button onClick={() => { if (newStudentName && newStudentClass) { addStudentToProfile({ name: newStudentName, className: newStudentClass }); setNewStudentName(''); setNewStudentClass(''); } }}><Plus size={17} />Öğrenci ekle</Button></div>
        </section>
      </div>}

      {bookingTeacher && <Dialog wide title="Görüşmenizi planlayın" description={`${bookingTeacher.firstName} ${bookingTeacher.lastName} · ${bookingTeacher.branch}`} onClose={() => setBookingTeacher(null)} dismissible={!bookingBusy}>
        {bookingSuccess ? <EmptyState icon={CheckCircle2} title="Randevu talebiniz alındı" description="Öğretmeninizin yanıtını Randevularım ekranından takip edebilirsiniz." /> : <form onSubmit={handleConfirmBooking} className="form-stack">
          <StepIndicator active={selectedSlotTime ? 2 : 1} labels={['Öğretmen', 'Tarih ve saat', 'Onay']} />
          {bookingError && <Alert tone="danger">{bookingError}</Alert>}
          <label className="field" htmlFor="booking-student">Hangi öğrenciniz için?
            {currentUser?.students && currentUser.students.length > 0 ? <select id="booking-student" value={selectedStudent} onChange={(event) => { setSelectedStudent(event.target.value); const match = currentUser.students?.find((student) => student.name === event.target.value); if (match) setStudentClass(match.className); }}>{currentUser.students.map((student) => <option key={student.id} value={student.name}>{student.name} ({student.className})</option>)}</select> : <input id="booking-student" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} required />}
          </label>
          <label className="field" htmlFor="booking-date">Görüşme tarihi<input id="booking-date" type="date" value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setSelectedSlotTime(''); }} min={new Date().toISOString().split('T')[0]} required /></label>
          <fieldset><legend className="text-sm font-semibold mb-3">Uygun saatler</legend><div className="slot-grid">{getAvailableSlotsForTeacher(bookingTeacher.id, bookingDate).map((slot) => <button key={slot.time} type="button" disabled={slot.isBooked} aria-pressed={selectedSlotTime === slot.time} aria-label={`${slot.time}${slot.isBooked ? ', dolu' : ''}`} onClick={() => setSelectedSlotTime(slot.time)}>{slot.time}</button>)}</div><p className="field-hint mt-2">Üzeri çizili saatler doludur.</p></fieldset>
          <label className="field" htmlFor="booking-note">Görüşme notu <span className="field-hint">İsteğe bağlı</span><textarea id="booking-note" rows={2} value={bookingNotes} onChange={(event) => setBookingNotes(event.target.value)} placeholder="Görüşmek istediğiniz konuyu kısaca yazabilirsiniz." /></label>
          {selectedSlotTime && <Alert>{bookingDate} tarihinde, {selectedSlotTime} için talep göndereceksiniz. Randevunuz öğretmen onayından sonra kesinleşir.</Alert>}
          <div className="form-actions"><Button variant="secondary" onClick={() => setBookingTeacher(null)} disabled={bookingBusy}>Vazgeç</Button><Button type="submit" disabled={!selectedSlotTime || bookingBusy}>{bookingBusy ? 'Gönderiliyor…' : 'Randevu talebi gönder'}</Button></div>
        </form>}
      </Dialog>}
      {selectedPassAppointment && <QRCodePass appointment={selectedPassAppointment} schoolName={settings.schoolName} onClose={() => setSelectedPassAppointment(null)} />}
    </main>
  );
};
