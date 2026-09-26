import { formatDate, getIstanbulDate } from '../utils/dates';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment } from '../types';
import { Alert, Button, Dialog, EmptyState, Metric, PageHeader, RoleNavigation, StatusBadge } from './ui';
import { QRCodePass } from './QRCodePass';
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Plus,
  Trash2,
  QrCode,
  Check,
  Phone,
  BookOpen,
} from 'lucide-react';

const DAYS_OF_WEEK = [
  { id: 1, name: 'Pazartesi' },
  { id: 2, name: 'Salı' },
  { id: 3, name: 'Çarşamba' },
  { id: 4, name: 'Perşembe' },
  { id: 5, name: 'Cuma' },
  { id: 6, name: 'Cumartesi' },
];

export const TeacherView: React.FC = () => {
  const {
    currentUser,
    teachers,
    appointments,
    availability,
    settings,
    approveAppointment,
    rejectAppointment,
    cancelAppointment,
    addAvailabilitySlot,
    removeAvailabilitySlot,
  } = useApp();

  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'appointments' | 'availability' | 'profile'>('home');
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'today' | 'pending' | 'approved'>('all');
  const [rejectingAptId, setRejectingAptId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [selectedPass, setSelectedPass] = useState<Appointment | null>(null);

  // New Availability Slot State
  const [newDay, setNewDay] = useState<number>(1);
  const [newStartTime, setNewStartTime] = useState<string>('09:30');
  const [newEndTime, setNewEndTime] = useState<string>('11:30');
  const [newDuration] = useState<number>(15);

  // The API already scopes teacher appointments from the authenticated user.
  const teacherAppointments = appointments;
  const teacherProfileId = teachers.find((teacher) => teacher.userId === currentUser?.id)?.id;

  const pendingAppointments = teacherAppointments.filter((a) => a.status === 'pending');
  const bookedAppointments = teacherAppointments.filter(
    (a) => a.status === 'booked' || a.status === 'checked_in'
  );
  const completedAppointments = teacherAppointments.filter(
    (a) => a.status === 'checked_out' || a.status === 'cancelled' || a.status === 'rejected'
  );

  const teacherAvailability = availability.filter((av) => av.teacherId === teacherProfileId);

  const perform = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ message, failed: false });
      return true;
    } catch {
      setFeedback({ message: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.', failed: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = (id: string) => perform(() => approveAppointment(id), 'Randevu onaylandı.');

  const handleConfirmReject = async () => {
    if (rejectingAptId && await perform(() => rejectAppointment(rejectingAptId, rejectionReason), 'Randevu reddedildi.')) {
      setRejectingAptId(null);
      setRejectionReason('');
    }
  };

  const handleAddSlot = (event: React.FormEvent) => {
    event.preventDefault();
    void perform(() => addAvailabilitySlot({
      dayOfWeek: newDay,
      startTime: newStartTime,
      endTime: newEndTime,
      slotDurationMinutes: newDuration,
    }), 'Müsaitlik programınıza eklendi.');
  };

  const navigation = [
    { id: 'home' as const, label: 'Ana sayfa', icon: BookOpen },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar, count: pendingAppointments.length },
    { id: 'availability' as const, label: 'Müsaitlik', icon: Clock },
    { id: 'profile' as const, label: 'Profil', icon: User },
  ];
  const today = getIstanbulDate();
  const todayAppointments = bookedAppointments.filter((appointment) => appointment.date === today);
  const showAppointments = (filter: typeof appointmentFilter) => {
    setAppointmentFilter(filter);
    setActiveTab('appointments');
  };
  const appointmentCard = (appointment: Appointment) => (
    <article key={appointment.id} className="appointment-card">
      <div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div>
      <div className="appointment-detail">
        <div className="appointment-top"><div><h3>{appointment.studentName}</h3><p>{appointment.className} · Veli: {appointment.parentName}</p></div><StatusBadge status={appointment.status} /></div>
        <div className="detail-row"><span><Calendar size={15} />{formatDate(appointment.date)}</span><span><Phone size={15} />{appointment.parentPhone}</span></div>
        {appointment.notes && <p className="mt-4 p-3 bg-slate-50 rounded-xl">Veli notu: {appointment.notes}</p>}
        {appointment.rejectionReason && <p className="mt-3">Ret gerekçesi: {appointment.rejectionReason}</p>}
        {appointment.status === 'pending' ? <div className="appointment-actions"><Button disabled={busy} onClick={() => { void handleApprove(appointment.id); }}><Check size={17} />Onayla</Button><Button variant="danger" disabled={busy} onClick={() => setRejectingAptId(appointment.id)}>Reddet</Button></div> : (appointment.status === 'booked' || appointment.status === 'checked_in') && <div className="appointment-actions"><Button variant="secondary" onClick={() => setSelectedPass(appointment)}><QrCode size={17} />Giriş kartı</Button>{appointment.status === 'booked' && <Button variant="quiet" disabled={busy} onClick={() => { void perform(() => cancelAppointment(appointment.id), 'Randevu iptal edildi.'); }}>İptal et</Button>}</div>}
      </div>
    </article>
  );

  return (
    <main id="main-content" className="page-shell">
      <PageHeader eyebrow={`ÖĞRETMEN ALANI · ${currentUser?.branch || 'GÖRÜŞME PROGRAMI'}`} title={activeTab === 'home' ? `İyi günler, ${currentUser?.firstName}.` : navigation.find((item) => item.id === activeTab)?.label} description="Görüşmelerinizi planlayın. Velilerinizle bağınızı güçlendirin." />
      <RoleNavigation items={navigation} active={activeTab} onChange={(tab) => { if (tab === 'appointments') setAppointmentFilter('all'); setActiveTab(tab); }} />
      {feedback && <div className="mb-6"><Alert tone={feedback.failed ? 'danger' : 'success'}>{feedback.message}</Alert></div>}
      {activeTab === 'home' && <div className="space-y-7">
        <section className="hero-card"><div><p className="eyebrow">GÜNÜNÜZÜ PLANLAYIN</p><h2>{pendingAppointments.length ? `${pendingAppointments.length} görüşme talebi sizi bekliyor.` : 'Görüşme programınız güncel.'}</h2><p>{pendingAppointments.length ? 'Velilerinizin taleplerini inceleyerek görüşme planınızı netleştirin.' : 'Yeni talepler geldiğinde burada görebilirsiniz.'}</p></div><Button onClick={() => pendingAppointments.length ? showAppointments('pending') : setActiveTab('availability')}>{pendingAppointments.length ? 'Talepleri incele' : 'Müsaitlik programı'}<Calendar size={18} /></Button></section>
        <div className="metric-grid"><Metric icon={Calendar} label="Bugünkü görüşme" value={todayAppointments.length} onClick={() => showAppointments('today')} /><Metric icon={Clock} label="Onay bekleyen" value={pendingAppointments.length} onClick={() => showAppointments('pending')} /><Metric icon={CheckCircle2} label="Onaylanan" value={bookedAppointments.length} onClick={() => showAppointments('approved')} /></div>
        <section><div className="section-heading"><div><h2>Bugünkü programınız</h2><p>{formatDate(getIstanbulDate())}</p></div><Button variant="quiet" onClick={() => showAppointments('all')}>Tüm randevular</Button></div>
          {todayAppointments.length ? <div className="space-y-4">{todayAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Bugün için planlı görüşmeniz yok" description="Yaklaşan görüşmelerinizi Randevular ekranında bulabilirsiniz." /></div>}
        </section>
      </div>}
      {activeTab === 'appointments' && <div className="space-y-8">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Randevu filtresi">{([['all', 'Tümü'], ['today', 'Bugün'], ['pending', 'Onay bekleyen'], ['approved', 'Onaylanan']] as const).map(([filter, label]) => <Button key={filter} variant={appointmentFilter === filter ? 'primary' : 'secondary'} aria-pressed={appointmentFilter === filter} onClick={() => setAppointmentFilter(filter)}>{label}</Button>)}</div>
        {appointmentFilter === 'today' && <section><div className="section-heading"><h2>Bugünkü görüşmeler ({todayAppointments.length})</h2></div>{todayAppointments.length ? <div className="space-y-4">{todayAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Bugün için planlı görüşme yok" /></div>}</section>}
        {(appointmentFilter === 'all' || appointmentFilter === 'pending') && <section><div className="section-heading"><h2>Onay bekleyenler ({pendingAppointments.length})</h2></div>{pendingAppointments.length ? <div className="space-y-4">{pendingAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={CheckCircle2} title="Bekleyen talep bulunmuyor" description="Yeni görüşme talepleri burada görünecek." /></div>}</section>}
        {(appointmentFilter === 'all' || appointmentFilter === 'approved') && <section><div className="section-heading"><h2>Onaylanan görüşmeler ({bookedAppointments.length})</h2></div>{bookedAppointments.length ? <div className="space-y-4">{bookedAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Onaylanan görüşme bulunmuyor" /></div>}</section>}
        {appointmentFilter === 'all' && completedAppointments.length > 0 && <section><div className="section-heading"><h2>Geçmiş randevular</h2></div><div className="space-y-4">{completedAppointments.map(appointmentCard)}</div></section>}
      </div>}
      {activeTab === 'availability' && <div className="space-y-6">
        <section className="surface"><div className="section-heading"><div><h2>Görüşme saatlerinizi belirleyin</h2><p>Velileriniz bu haftalık saatler arasından randevu seçebilir.</p></div></div>
          <form onSubmit={handleAddSlot} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <label className="field" htmlFor="available-day">Gün<select id="available-day" value={newDay} onChange={(event) => setNewDay(Number(event.target.value))}>{DAYS_OF_WEEK.map((day) => <option key={day.id} value={day.id}>{day.name}</option>)}</select></label>
            <label className="field" htmlFor="available-start">Başlangıç<input id="available-start" type="time" value={newStartTime} onChange={(event) => setNewStartTime(event.target.value)} required /></label>
            <label className="field" htmlFor="available-end">Bitiş<input id="available-end" type="time" value={newEndTime} onChange={(event) => setNewEndTime(event.target.value)} required /></label>
            <Button type="submit" disabled={busy}><Plus size={17} />Programa ekle</Button>
          </form>
        </section>
        <section className="surface"><div className="section-heading"><h2>Haftalık müsaitliğiniz</h2></div>{teacherAvailability.length ? <div className="divide-y divide-slate-200">{teacherAvailability.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-4 py-4"><div><h3 className="font-bold text-sm">{DAYS_OF_WEEK.find((day) => day.id === slot.dayOfWeek)?.name || 'Hafta içi'}</h3><p className="text-sm text-slate-600 mt-1">{slot.startTime} – {slot.endTime}<span className="block sm:inline sm:ml-4 text-xs text-slate-500">{slot.slotDurationMinutes} dakika / görüşme</span></p></div><button type="button" disabled={busy} className="icon-button" aria-label={`${slot.startTime} müsaitlik aralığını sil`} onClick={() => { void perform(() => removeAvailabilitySlot(slot.id), 'Müsaitlik aralığı kaldırıldı.'); }}><Trash2 size={18} /></button></div>)}</div> : <EmptyState icon={Clock} title="Henüz saat belirlemediniz" description="Yukarıdaki formdan uygun olduğunuz saatleri ekleyin." />}</section>
      </div>}
      {activeTab === 'profile' && <section className="surface max-w-xl"><div className="flex items-center gap-4"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><div><h2 className="font-bold text-xl">{currentUser?.firstName} {currentUser?.lastName}</h2><p className="text-blue-700 mt-1 text-sm">{currentUser?.branch}</p></div></div><dl className="pass-details mt-7"><div><dt>Telefon</dt><dd>{currentUser?.phone}</dd></div><div><dt>Okul</dt><dd>{settings.schoolName}</dd></div></dl></section>}
      {rejectingAptId && <Dialog title="Randevuyu reddet" description="Dilerseniz veliye iletilecek kısa bir açıklama ekleyin." onClose={() => setRejectingAptId(null)} dismissible={!busy}><div className="form-stack">{feedback?.failed && <Alert tone="danger">{feedback.message}</Alert>}<label className="field" htmlFor="rejection-reason">Ret gerekçesi <span className="field-hint">İsteğe bağlı</span><textarea id="rejection-reason" rows={3} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Bu saatte görüşme yapamama nedeniniz…" /></label><div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRejectingAptId(null)}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={handleConfirmReject}>{busy ? 'Kaydediliyor…' : 'Randevuyu reddet'}</Button></div></div></Dialog>}
      {selectedPass && <QRCodePass appointment={selectedPass} schoolName={settings.schoolName} onClose={() => setSelectedPass(null)} />}
    </main>
  );
};
