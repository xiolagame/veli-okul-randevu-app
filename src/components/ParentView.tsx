import { formatDate, formatDateTime, formatDatesInText, getIstanbulDate } from '../utils/dates';
import React, { useEffect, useRef, useState } from 'react';
import { normalizePersonName, uppercasePersonNameInput } from '../utils/person-name';
import { formatTurkishPhoneInput } from '../utils/phone';
import { useApp } from '../context/AppContext';
import { Appointment, TeacherProfile } from '../types';
import { Alert, Button, Dialog, EmptyState, Metric, PageHeader, RoleNavigation, Skeleton, StatusBadge, StepIndicator, Toast } from './ui';
import { QRCodePass } from './QRCodePass';
import { api } from '../services/api';
import { calendarWeekday, generateAppointmentSlots, intervalsOverlap } from '../utils/appointment-slots';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { MAX_BOOKING_DAYS_AHEAD, bookingWindow, isSlotInFuture } from '../utils/booking-window';
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
  BookOpen,
  ArrowRight,
  Bell,
} from 'lucide-react';
import { useHomeRefresh } from './useHomeRefresh';

function formatBookingDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export const ParentView: React.FC<{ pushAppointmentIntent?: { id: string; sequence: number } | null }> = ({ pushAppointmentIntent }) => {
  const {
    currentUser,
    currentSchool,
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
    deleteNotification,
    clearParentNotifications,
    clearParentHistory,
    getParentClasses,
    refreshMobileData,
    schoolDataLoading,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'appointments' | 'notifications' | 'profile'>('home');
  const { touchHandlers, control: refreshControl } = useHomeRefresh(activeTab === 'home', refreshMobileData);
  useEffect(() => { if (pushAppointmentIntent) setActiveTab('appointments'); }, [pushAppointmentIntent?.sequence]);
  useEffect(() => {
    if (activeTab !== 'appointments' || !pushAppointmentIntent) return;
    const frame = requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-appointment-id]'))
        .find((element) => element.dataset.appointmentId === pushAppointmentIntent.id);
      card?.scrollIntoView({ block: 'center' });
      card?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, pushAppointmentIntent?.sequence, appointments]);
  const [selectedPassAppointment, setSelectedPassAppointment] = useState<Appointment | null>(null);
  // Randevu tek dokunuşla iptal edilmesin: önce onay penceresi.
  const [cancelingAppointment, setCancelingAppointment] = useState<Appointment | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  // Bildirimler sekmesi açılınca hepsi okunmuş sayılır; açılış anındaki okunmamışlar "Yeni" etiketiyle görünür.
  const [parentNewIds, setParentNewIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (activeTab !== 'notifications') return;
    const unread = notifications.filter((notification) => notification.userId === currentUser?.id && !notification.read).map((notification) => notification.id);
    setParentNewIds(new Set(unread));
    if (unread.length) void markNotificationsAsRead().catch(() => {});
  }, [activeTab]);

  // Booking Modal State
  const [bookingTeacher, setBookingTeacher] = useState<TeacherProfile | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingCalendarOpen, setBookingCalendarOpen] = useState(true);
  const [selectedSlotTime, setSelectedSlotTime] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<string>(
    currentUser?.students?.[0]?.name || ''
  );
  const [studentClass, setStudentClass] = useState<string>(
    currentUser?.students?.[0]?.className || ''
  );
  const [bookingNotes, setBookingNotes] = useState<string>('');
  const [bookingError, setBookingError] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<boolean>(false);
  const [occupiedSlots, setOccupiedSlots] = useState<{ key: string; intervals: { startTime: string; endTime: string }[] } | null>(null);
  const [slotsError, setSlotsError] = useState('');
  const [slotsRefresh, setSlotsRefresh] = useState(0);
  const bookingSlotsRef = useRef<HTMLFieldSetElement>(null);

  // Teacher Filter
  const [teacherSearch, setTeacherSearch] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('Tümü');

  // New Student Profile Form
  const [newStudentName, setNewStudentName] = useState<string>('');
  const [newStudentClass, setNewStudentClass] = useState<string>('');
  const [schoolClasses, setSchoolClasses] = useState<string[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'profile') return;
    let active = true;
    setClassesLoading(true);
    getParentClasses().then((classes) => {
      if (active) setSchoolClasses(classes);
    }).catch(() => {
      if (active) setActionError('Sınıflar yüklenemedi. Lütfen tekrar deneyin.');
    }).finally(() => { if (active) setClassesLoading(false); });
    return () => { active = false; };
  }, [activeTab, currentUser?.id, currentSchool?.id]);

  // Parent's appointments
  const parentAppointments = appointments.filter(
    (a) => a.parentId === currentUser?.id || a.parentPhone === currentUser?.phone
  );

  // En yakın tarih ve saat önce gelir; "Sıradaki görüşmeniz" gerçekten sıradakini göstersin.
  const upcomingAppointments = parentAppointments.filter(
    (a) => (a.status === 'booked' || a.status === 'pending' || a.status === 'checked_in') && a.date >= getIstanbulDate()
  ).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const pushedAppointment = pushAppointmentIntent
    ? parentAppointments.find((appointment) => appointment.id === pushAppointmentIntent.id)
    : undefined;

  // Next imminent appointment
  const nextAppointment = upcomingAppointments[0];

  // Distinct branches for filter
  const branches = ['Tümü', ...Array.from(new Set(teachers.map((t) => t.branch)))];

  const filteredTeachers = teachers.filter((t) => {
    const matchSearch =
      `${t.firstName} ${t.lastName}`.toLocaleLowerCase('tr-TR').includes(teacherSearch.toLocaleLowerCase('tr-TR')) ||
      t.branch.toLocaleLowerCase('tr-TR').includes(teacherSearch.toLocaleLowerCase('tr-TR'));
    const matchBranch = selectedBranch === 'Tümü' || t.branch === selectedBranch;
    return matchSearch && matchBranch;
  });

  const handleOpenBooking = (teacher: TeacherProfile) => {
    setBookingTeacher(teacher);
    setBookingDate('');
    setBookingCalendarOpen(true);
    setOccupiedSlots(null);
    setSelectedSlotTime('');
    setBookingNotes('');
    setBookingSuccess(false);
    setBookingError('');
    if (currentUser?.students && currentUser.students.length > 0) {
      setSelectedStudent(currentUser.students[0].name);
      setStudentClass(currentUser.students[0].className);
    } else {
      setSelectedStudent('');
      setStudentClass('');
    }
  };

  const occupiedKey = `${currentSchool?.id || ''}:${bookingTeacher?.id || ''}:${bookingDate}`;
  useEffect(() => {
    if (!bookingTeacher || !currentSchool || !bookingDate) return;
    let active = true;
    setOccupiedSlots(null);
    setSlotsError('');
    api.getOccupiedSlots(currentSchool.id, bookingTeacher.id, bookingDate)
      .then(({ occupied }) => { if (active) setOccupiedSlots({ key: occupiedKey, intervals: occupied }); })
      .catch(() => { if (active) setSlotsError('Dolu saatler alınamadı. Lütfen tekrar deneyin.'); });
    return () => { active = false; };
  }, [bookingTeacher?.id, bookingDate, currentSchool?.id, slotsRefresh]);

  useEffect(() => {
    if (!bookingTeacher || !bookingDate || bookingCalendarOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      bookingSlotsRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bookingTeacher?.id, bookingDate, bookingCalendarOpen]);

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingTeacher || !selectedSlotTime || !selectedStudent) return;

    const selectedSlot = getAvailableSlotsForTeacher(bookingTeacher.id, bookingDate).find((slot) => slot.time === selectedSlotTime);
    if (!selectedSlot || selectedSlot.isBooked || !occupiedSlots || occupiedSlots.key !== occupiedKey) return;

    setBookingBusy(true);
    setBookingError('');
    try {
    await bookAppointment({
      teacherId: bookingTeacher.id,
      studentName: selectedStudent,
      className: studentClass,
      date: bookingDate,
      startTime: selectedSlotTime,
      endTime: selectedSlot.endTime,
      notes: bookingNotes,
    });

    setBookingSuccess(true);
    setTimeout(() => {
      setBookingTeacher(null);
      setActiveTab('appointments');
    }, 1200);
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'Randevu talebiniz gönderilemedi. Bilgilerinizi kontrol edip yeniden deneyin.');
      setSelectedSlotTime('');
      setSlotsRefresh((value) => value + 1);
    } finally {
      setBookingBusy(false);
    }
  };

  // Generate slots for the selected teacher and date
  const getAvailableSlotsForTeacher = (teacherId: string, dateStr: string) => {
    const dayOfWeek = calendarWeekday(dateStr);

    const teacherAvail = availability.filter(
      (a) => a.teacherId === teacherId && a.dayOfWeek === dayOfWeek
    );

    // If teacher has defined hours for this day
    // Bugün için geçmiş saatler listelenmez.
    const slots = generateAppointmentSlots(teacherAvail, settings.defaultSlotMinutes).filter((slot) => isSlotInFuture(dateStr, slot.time));

    const intervals = occupiedSlots?.key === occupiedKey ? occupiedSlots.intervals : [];
    return [...new Map(slots.map((slot) => [slot.time, slot])).values()].map((slot) => ({
      ...slot,
      isBooked: intervals.some((occupied) => intervalsOverlap({ startTime: slot.time, endTime: slot.endTime }, occupied)),
    }));
  };

  const bookingSlots = bookingTeacher && bookingDate
    ? getAvailableSlotsForTeacher(bookingTeacher.id, bookingDate)
    : [];
  const bookingSlotsReady = !!bookingDate && !slotsError && occupiedSlots?.key === occupiedKey;
  const noSelectableBookingSlots = bookingSlotsReady && !bookingSlots.some((slot) => !slot.isBooked);

  const navigation = [
    { id: 'home' as const, label: 'Ana sayfa', icon: BookOpen },
    { id: 'teachers' as const, label: 'Öğretmenler', icon: Users },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar, count: upcomingAppointments.length },
    { id: 'notifications' as const, label: 'Bildirimler', icon: Bell },
    { id: 'profile' as const, label: 'Profil', icon: User },
  ];

  const appointmentCard = (appointment: Appointment) => (
    <article className="appointment-card" key={appointment.id} data-appointment-id={appointment.id} tabIndex={-1}>
      <div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div>
      <div className="appointment-detail">
        <div className="appointment-top"><div><h3>{normalizePersonName(appointment.teacherName)}</h3><p>{appointment.teacherBranch}</p></div><StatusBadge status={appointment.status} /></div>
        <div className="detail-row"><span><Calendar size={15} />{formatDate(appointment.date)}</span><span><User size={15} />{normalizePersonName(appointment.studentName)} · {appointment.className}</span></div>
        {appointment.rejectionReason && <p className="mt-3 text-red-700">{appointment.rejectionReason}</p>}
        {appointment.notes && <p className="mt-3">Notunuz: {appointment.notes}</p>}
        <div className="appointment-actions">
          {/* Giriş kartı yalnız onaylı görüşmede anlamlı; onay bekleyen kart giriş izni vermez. */}
          {(appointment.status === 'booked' || appointment.status === 'checked_in') && <Button variant="secondary" onClick={() => setSelectedPassAppointment(appointment)}><QrCode size={17} />Giriş kartı</Button>}
          {appointment.status === 'pending' && <p className="text-sm text-slate-600">Öğretmen onayladığında giriş kartınız burada açılır.</p>}
          {settings.allowParentCancel && (appointment.status === 'booked' || appointment.status === 'pending') && <Button variant="quiet" onClick={() => { setActionError(''); setCancelingAppointment(appointment); }}>Randevuyu iptal et</Button>}
        </div>
      </div>
    </article>
  );

  const teacherCard = (teacher: TeacherProfile) => (
    <article key={teacher.id} className="surface teacher-card">
      <div><h3>{normalizePersonName(`${teacher.firstName} ${teacher.lastName}`)}</h3><p>{teacher.branch}</p></div>
      {teacher.bio && <p>{teacher.bio}</p>}
      <Button variant="secondary" onClick={() => handleOpenBooking(teacher)}>Randevu al<ArrowRight size={16} /></Button>
    </article>
  );

  return (
    <main id="main-content" className="page-shell" {...touchHandlers}>
      <PageHeader eyebrow="VELİ ALANI" title={activeTab === 'home' ? `Merhaba, ${currentUser?.firstName}.` : navigation.find((item) => item.id === activeTab)?.label} description={activeTab === 'home' ? 'Okul hayatına birlikte, bir adım daha yakın.' : settings.schoolName} action={activeTab === 'appointments' && <Button onClick={() => setActiveTab('teachers')}><Plus size={18} />Yeni randevu al</Button>} />
      <RoleNavigation items={navigation} active={activeTab} onChange={setActiveTab} />
      {refreshControl}
      {actionError && <Toast tone="danger" resetKey={actionError} onClose={() => setActionError('')}>{actionError}</Toast>}

      {activeTab !== 'profile' && schoolDataLoading && <Skeleton rows={3} />}
      {activeTab === 'home' && !schoolDataLoading && <div className="space-y-7">
        {nextAppointment ? <section className="hero-card">
          <div><p className="eyebrow">SIRADAKİ GÖRÜŞMENİZ</p><StatusBadge status={nextAppointment.status} /><h2>{normalizePersonName(nextAppointment.teacherName)}</h2><p>{nextAppointment.teacherBranch} · {normalizePersonName(nextAppointment.studentName)}</p><div className="detail-row"><span><Calendar size={16} />{formatDate(nextAppointment.date)}</span><span><Clock size={16} />{nextAppointment.startTime} – {nextAppointment.endTime}</span></div></div>
          {nextAppointment.status === 'booked' || nextAppointment.status === 'checked_in' ? <Button onClick={() => setSelectedPassAppointment(nextAppointment)}><QrCode size={19} />Giriş kartını aç</Button> : <Button variant="secondary" onClick={() => setActiveTab('appointments')}>Randevularımı gör<ArrowRight size={18} /></Button>}
        </section> : <section className="hero-card"><div><h2>Öğretmeninizle görüşmek için size uygun bir zaman seçin.</h2><Button className="mt-6" onClick={() => setActiveTab('teachers')}>İlk randevunuzu planlayın<ArrowRight size={18} /></Button></div><span className="hero-symbol"><Calendar size={40} strokeWidth={1.5} /></span></section>}
        <div className="metric-grid parent-metric-grid"><Metric label="Aktif randevu" value={upcomingAppointments.length} icon={Calendar} /><Metric label="Öğrencilerim" value={currentUser?.students?.length || 0} icon={Users} /></div>
        <section>
          {teachers.length ? <div className="teacher-grid">{teachers.slice(0, 3).map(teacherCard)}</div> : <div className="surface"><EmptyState icon={Users} title="Öğretmen listesi henüz hazır değil" description="Okulunuzun öğretmenleri burada listelenecek." /></div>}
        </section>
      </div>}

      {activeTab === 'teachers' && !schoolDataLoading && <section>
        <div className="filter-bar">
          <label className="field" htmlFor="teacher-search">Öğretmen veya branş ara<div className="field-icon"><Search size={18} /><input id="teacher-search" value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} placeholder="İsim veya branş yazın" /></div></label>
          <label className="field" htmlFor="teacher-branch">Branş<select id="teacher-branch" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        </div>
        {filteredTeachers.length ? <div className="teacher-grid">{filteredTeachers.map(teacherCard)}</div> : <div className="surface"><EmptyState icon={Search} title="Öğretmen bulunamadı" description="Farklı bir isim veya branş ile aramayı deneyin." /></div>}
      </section>}

      {activeTab === 'appointments' && !schoolDataLoading && <div className="space-y-8">
        {pushedAppointment && !upcomingAppointments.some((appointment) => appointment.id === pushedAppointment.id)
          && <section><div className="section-heading"><h2>Bildirimdeki randevu</h2></div>{appointmentCard(pushedAppointment)}</section>}
        <section><div className="section-heading"><h2>Yaklaşan görüşmeler <span className="text-slate-500">({upcomingAppointments.length})</span></h2></div>
          {upcomingAppointments.length ? <div className="space-y-4">{upcomingAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Henüz randevunuz yok" description="Öğretmeninizle görüşme planlamak için yeni bir randevu oluşturabilirsiniz." action={<Button onClick={() => setActiveTab('teachers')}>Randevu oluştur<ArrowRight size={17} /></Button>} /></div>}
        </section>
      </div>}

      {activeTab === 'notifications' && !schoolDataLoading && <section className="surface">
        <div className="section-heading"><h2>Okulunuzdan haberler</h2><div className="flex flex-wrap gap-2"><Button variant="quiet" onClick={() => { if (window.confirm('Tüm bildirimleriniz listeden kaldırılacak. Bu işlem sistem kayıtlarını etkilemez.')) void clearParentNotifications().catch(() => setActionError('Bildirimler temizlenemedi.')); }}>Tüm bildirimleri sil</Button></div></div>
        {notifications.filter((notification) => notification.userId === currentUser?.id).length ? <div className="divide-y divide-slate-200">{notifications.filter((notification) => notification.userId === currentUser?.id).map((notification) => <article className="py-5 flex gap-4 items-start" key={notification.id}><span className="avatar"><Bell size={20} /></span><div className="flex-1 min-w-0"><div className="notification-title-row"><div className="min-w-0"><h3 className="font-bold text-sm">{notification.title}</h3>{parentNewIds.has(notification.id) && <span className="text-blue-700 text-xs">Yeni</span>}</div><button type="button" className="notification-delete-button" aria-label={`${notification.title} bildirimini sil`} disabled={deletingNotificationId !== null} onClick={() => { setActionError(''); setDeletingNotificationId(notification.id); void deleteNotification(notification.id).catch(() => setActionError('Bildirim silinemedi. Lütfen tekrar deneyin.')).finally(() => setDeletingNotificationId(null)); }}><Trash2 size={17} aria-hidden="true" /><span>Sil</span></button></div><p className="text-sm text-slate-600 mt-2">{formatDatesInText(notification.message)}</p><p className="text-xs text-slate-500 mt-2">{formatDateTime(notification.date)}</p>{notification.appointmentId && <Button variant="quiet" className="mt-2" onClick={() => { const appointment = appointments.find((item) => item.id === notification.appointmentId); if (appointment) setSelectedPassAppointment(appointment); }}>Giriş kartını gör<QrCode size={16} /></Button>}</div></article>)}</div> : <EmptyState icon={Bell} title="Şimdilik her şey güncel" description="Randevularınızla ilgili gelişmeler burada görünecek." />}
      </section>}

      {activeTab === 'profile' && <div className="max-w-2xl space-y-6">
        <section className="surface flex items-center gap-4"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><div><h2 className="text-xl font-bold">{normalizePersonName(`${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`)}</h2><p className="text-sm text-slate-500 mt-1">{formatTurkishPhoneInput(currentUser?.phone || '')}</p></div></section>
        <section className="surface"><div className="section-heading"><div><h2>Öğrencilerim</h2><p>Görüşmelerinizde bu öğrencilerden seçim yapabilirsiniz.</p></div></div>
          <div className="space-y-3">{currentUser?.students?.map((student) => <div key={student.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50"><div><h3 className="font-semibold text-sm">{normalizePersonName(student.name)}</h3><p className="text-xs text-slate-500">{student.className}</p></div>{currentUser.students && currentUser.students.length > 1 && <button type="button" className="icon-button" onClick={() => removeStudentFromProfile(student.id)} aria-label={`${student.name} öğrencisini kaldır`}><Trash2 size={18} /></button>}</div>)}</div>
          <div className="form-stack mt-6 pt-6 border-t border-slate-200"><h3 className="font-semibold">Öğrenci ekle</h3><label className="field" htmlFor="student-name">Öğrenci adı soyadı<input id="student-name" value={newStudentName} onChange={(event) => setNewStudentName(uppercasePersonNameInput(event.target.value))} placeholder="Adı soyadı" /></label><label className="field" htmlFor="student-class">Sınıf<select id="student-class" value={newStudentClass} onChange={(event) => setNewStudentClass(event.target.value)} disabled={classesLoading || !schoolClasses.length}><option value="">Sınıf seçin</option>{schoolClasses.map((schoolClass) => <option key={schoolClass} value={schoolClass}>{schoolClass}</option>)}</select></label>{!classesLoading && !schoolClasses.length && <p className="field-hint">Henüz okul yönetimi tarafından sınıf tanımlanmamış.</p>}<Button disabled={!newStudentName.trim() || !newStudentClass} onClick={() => { void addStudentToProfile({ name: newStudentName, className: newStudentClass }).then(() => { setNewStudentName(''); setNewStudentClass(''); }).catch((error: Error) => setActionError(error.message)); }}><Plus size={17} />Öğrenci ekle</Button></div>
        </section>
        <section className="surface"><h2 className="font-semibold mb-3">Gizlilik</h2><Button variant="secondary" onClick={() => { if (window.confirm('Bu işlem yalnızca sizin randevu geçmişi görünümünüzü temizler. Okul ve öğretmen kayıtları etkilenmez.')) void clearParentHistory().catch(() => setActionError('Randevu geçmişi temizlenemedi.')); }}>Randevu geçmişini temizle</Button></section>
      </div>}

      {bookingTeacher && <Dialog wide title="Görüşmenizi planlayın" description={`${bookingTeacher.firstName} ${bookingTeacher.lastName} · ${bookingTeacher.branch}`} onClose={() => setBookingTeacher(null)} dismissible={!bookingBusy}>
        {bookingSuccess ? <EmptyState icon={CheckCircle2} title="Randevu talebiniz alındı" description="Öğretmeninizin yanıtını Randevularım ekranından takip edebilirsiniz." /> : <form onSubmit={handleConfirmBooking} className="form-stack">
          <StepIndicator active={selectedSlotTime ? 2 : 1} labels={['Öğretmen', 'Tarih ve saat', 'Onay']} />
          {bookingError && <Alert tone="danger">{bookingError}</Alert>}
          <label className="field" htmlFor="booking-student">Hangi öğrenciniz için?
            {currentUser?.students && currentUser.students.length > 0 ? <select id="booking-student" value={selectedStudent} onChange={(event) => { setSelectedStudent(event.target.value); const match = currentUser.students?.find((student) => student.name === event.target.value); if (match) setStudentClass(match.className); }}>{currentUser.students.map((student) => <option key={student.id} value={student.name}>{student.name} ({student.className})</option>)}</select> : <select id="booking-student" disabled><option>Önce profilinize öğrenci ekleyin</option></select>}
          </label>
          <div className="field"><span>Görüşme tarihi</span>{!bookingDate || bookingCalendarOpen ? <AvailabilityCalendar firstDate={bookingWindow().firstDate} lastDate={bookingWindow().lastDate} hint={`Randevu en fazla ${MAX_BOOKING_DAYS_AHEAD} gün sonrası için alınabilir.`} selectedDate={bookingDate} isDateAvailable={(date) => date !== bookingWindow().firstDate || getAvailableSlotsForTeacher(bookingTeacher.id, date).length > 0} weekdays={[...new Set(availability.filter((slot) => slot.teacherId === bookingTeacher.id && slot.dayOfWeek >= 1 && slot.dayOfWeek <= 6).map((slot) => slot.dayOfWeek))]} onSelectDate={(date) => { setBookingDate(date); setSelectedSlotTime(''); setBookingCalendarOpen(false); }} /> : <div className="booking-date-summary"><div role="status" aria-live="polite"><span>Seçilen tarih</span><strong>{formatBookingDate(bookingDate)}</strong></div><Button variant="quiet" onClick={() => setBookingCalendarOpen(true)}>Tarihi değiştir</Button></div>}</div>
          {bookingDate && <fieldset ref={bookingSlotsRef} className="booking-slots-anchor"><legend className="text-sm font-semibold mb-3">Uygun saatler</legend>{slotsError && <Alert tone="danger">{slotsError} <Button variant="secondary" onClick={() => setSlotsRefresh((value) => value + 1)}>Tekrar dene</Button></Alert>}{!slotsError && occupiedSlots?.key !== occupiedKey && <p role="status">Saatler yükleniyor…</p>}{noSelectableBookingSlots && <Alert tone="warning">Bu tarihte uygun saat bulunmuyor. Başka bir tarih seçin.</Alert>}{[['Sabah', bookingSlots.filter((slot) => slot.time < '12:00')], ['Öğleden sonra', bookingSlots.filter((slot) => slot.time >= '12:00')]].map(([title, group]) => (group as typeof bookingSlots).length > 0 && <div key={title as string} className="slot-group"><p className="slot-group-title">{title as string}</p><div className="slot-grid">{(group as typeof bookingSlots).map((slot) => <button key={slot.time} type="button" data-booked={slot.isBooked} disabled={slot.isBooked || occupiedSlots?.key !== occupiedKey || !!slotsError} aria-pressed={selectedSlotTime === slot.time} aria-label={`${slot.time}${slot.isBooked ? ', dolu' : ''}`} onClick={() => setSelectedSlotTime(slot.time)}>{slot.time}</button>)}</div></div>)}{bookingSlots.length > 0 && <p className="field-hint mt-2">Üzeri çizili saatler doludur.</p>}</fieldset>}
          <label className="field" htmlFor="booking-note">Görüşme notu <span className="field-hint">İsteğe bağlı</span><textarea id="booking-note" rows={2} value={bookingNotes} onChange={(event) => setBookingNotes(event.target.value)} placeholder="Görüşmek istediğiniz konuyu kısaca yazabilirsiniz." /></label>
          {selectedSlotTime && <Alert>{formatDate(bookingDate)} tarihinde, {selectedSlotTime} için talep göndereceksiniz. Randevunuz öğretmen onayından sonra kesinleşir.</Alert>}
          <div className="form-actions"><Button variant="secondary" onClick={() => setBookingTeacher(null)} disabled={bookingBusy}>Vazgeç</Button><Button type="submit" disabled={!selectedSlotTime || bookingBusy || occupiedSlots?.key !== occupiedKey || !!slotsError}>{bookingBusy ? 'Gönderiliyor…' : 'Randevu talebi gönder'}</Button></div>
        </form>}
      </Dialog>}
      {cancelingAppointment && <Dialog title="Randevuyu iptal et" description={`${normalizePersonName(cancelingAppointment.teacherName)} · ${formatDate(cancelingAppointment.date)} ${cancelingAppointment.startTime}`} onClose={() => setCancelingAppointment(null)} dismissible={!cancelBusy}><div className="form-stack"><p className="text-sm text-slate-600">Bu randevu iptal edilecek ve öğretmeninize bilgi verilecek. Emin misiniz?</p><div className="form-actions"><Button variant="secondary" disabled={cancelBusy} onClick={() => setCancelingAppointment(null)}>Vazgeç</Button><Button variant="danger" disabled={cancelBusy} onClick={() => { const target = cancelingAppointment; setCancelBusy(true); void cancelAppointment(target.id).then(() => setCancelingAppointment(null)).catch(() => { setCancelingAppointment(null); setActionError('Randevu iptal edilemedi. Lütfen tekrar deneyin.'); }).finally(() => setCancelBusy(false)); }}>{cancelBusy ? 'İptal ediliyor…' : 'Randevuyu iptal et'}</Button></div></div></Dialog>}
      {selectedPassAppointment && <QRCodePass appointment={selectedPassAppointment} schoolName={settings.schoolName} onClose={() => setSelectedPassAppointment(null)} />}
    </main>
  );
};
