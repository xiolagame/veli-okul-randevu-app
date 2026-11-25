import { formatDate, getIstanbulDate } from '../utils/dates';
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment } from '../types';
import { api } from '../services/api';
import { Alert, Button, Dialog, EmptyState, Metric, PageHeader, RoleNavigation, Skeleton, StatusBadge, Toast } from './ui';
import { ApiError } from '../platform/api-error';
import { formatTurkishPhoneInput } from '../utils/phone';
import { isSlotInFuture } from '../utils/booking-window';
import { AvailabilityForm } from './AvailabilityForm';
import { otherDurationMessage, planAvailabilityAdditions } from '../utils/availability-form';
import { AVAILABILITY_DAYS, groupAvailabilityByDay } from '../utils/availability';
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Plus,
  Trash2,
  Check,
  Phone,
  BookOpen,
} from 'lucide-react';
import { useHomeRefresh } from './useHomeRefresh';

export const TeacherView: React.FC<{ pushAppointmentIntent?: { id: string; sequence: number } | null }> = ({ pushAppointmentIntent }) => {
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
    refreshMobileData,
    schoolDataLoading,
    currentSchool,
  } = useApp();
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');

  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'appointments' | 'availability' | 'profile'>('home');
  useEffect(() => { setFeedback(null); }, [activeTab]);
  const { touchHandlers, control: refreshControl } = useHomeRefresh(activeTab === 'home', refreshMobileData);
  useEffect(() => {
    if (!pushAppointmentIntent) return;
    setAppointmentFilter('all');
    setActiveTab('appointments');
  }, [pushAppointmentIntent?.sequence]);
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
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'today' | 'pending' | 'approved'>('all');
  const [rejectingAptId, setRejectingAptId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  // Onaylanmış randevu tek dokunuşla iptal edilmesin: önce onay penceresi.
  const [cancelingApt, setCancelingApt] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');


  // The API already scopes teacher appointments from the authenticated user.
  const teacherAppointments = appointments;
  const teacherProfileId = teachers.find((teacher) => teacher.userId === currentUser?.id)?.id;
  const myEmail = teachers.find((teacher) => teacher.userId === currentUser?.id)?.email || '';
  const saveEmail = async () => {
    const value = (emailDraft || '').trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setEmailError('Geçerli bir e-posta adresi girin.'); return; }
    if (!currentSchool) return;
    setBusy(true); setEmailError('');
    try {
      await api.updateMyTeacherEmail(currentSchool.id, value);
      await refreshMobileData();
      setEmailDraft(null);
      setFeedback({ message: value ? 'E-posta adresi kaydedildi.' : 'E-posta adresi kaldırıldı.', failed: false });
    } catch (cause) {
      setEmailError(cause instanceof Error && cause.message ? cause.message : 'E-posta adresi kaydedilemedi.');
    } finally { setBusy(false); }
  };

  const byDateTime = (a: Appointment, b: Appointment) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
  // Saati geçmiş ama onaylanmamış talep artık onaylanamaz; "Onay bekleyen" yerine geçmişte görünür.
  const isExpiredPending = (a: Appointment) => a.status === 'pending' && !isSlotInFuture(a.date, a.startTime);
  const pendingAppointments = teacherAppointments.filter((a) => a.status === 'pending' && !isExpiredPending(a)).sort(byDateTime);
  const bookedAppointments = teacherAppointments.filter(
    (a) => a.status === 'booked' || a.status === 'checked_in'
  ).sort(byDateTime);
  const completedAppointments = teacherAppointments.filter(
    (a) => a.status === 'checked_out' || a.status === 'cancelled' || a.status === 'rejected' || isExpiredPending(a)
  ).sort((a, b) => byDateTime(b, a));

  const teacherAvailability = availability.filter((av) => av.teacherId === teacherProfileId);
  const availabilityGroups = groupAvailabilityByDay(teacherAvailability);

  const perform = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ message, failed: false });
      return true;
    } catch (cause) {
      // Sunucunun açıklayıcı mesajı (ör. "saat aralığı çakışıyor") varsa onu göster.
      const message = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.message ? cause.message : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
      setFeedback({ message, failed: true });
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

  // Seçilen günlerin her birine aynı saat aralığını ekler; çakışan günler atlanır ve ayrıca bildirilir.
  const handleAddSlots = async (days: number[], startTime: string, endTime: string, customDurationMinutes: number | null) => {
    const duration = customDurationMinutes ?? settings.defaultSlotMinutes;
    const dayList = (ids: number[]) => ids.map((id) => AVAILABILITY_DAYS.find((day) => day.id === id)?.name || '').join(', ');
    const { add, conflicts, otherDuration } = planAvailabilityAdditions(teacherAvailability, days, startTime, endTime, duration);
    const skipped: string[] = [];
    if (conflicts.length) skipped.push(`${dayList(conflicts)} için bu saatlerde başka bir müsaitliğiniz var.`);
    otherDuration.forEach((day) => skipped.push(otherDurationMessage(day)));
    if (!add.length) {
      setFeedback({ message: skipped.join(' '), failed: true });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const added: number[] = [];
    let failure = '';
    try {
      for (const day of add) {
        try {
          await addAvailabilitySlot({ dayOfWeek: day, startTime, endTime, slotDurationMinutes: duration, customDurationMinutes });
          added.push(day);
        } catch (cause) {
          failure = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.message ? cause.message : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
          break;
        }
      }
    } finally {
      setBusy(false);
    }
    const parts: string[] = [];
    if (added.length) parts.push(`${dayList(added)} için ${startTime}–${endTime} eklendi.`);
    parts.push(...skipped);
    if (failure) parts.push(failure);
    setFeedback({ message: parts.join(' '), failed: !!failure || !added.length });
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
    <article key={appointment.id} className="appointment-card" data-appointment-id={appointment.id} tabIndex={-1}>
      <div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div>
      <div className="appointment-detail">
        <div className="appointment-top"><div><h3>{appointment.studentName}</h3><p>{appointment.className} · Veli: {appointment.parentName}</p></div><StatusBadge status={appointment.status} /></div>
        <div className="detail-row"><span><Calendar size={15} />{formatDate(appointment.date)}</span><a className="inline-flex items-center gap-1" href={`tel:${appointment.parentPhone}`} aria-label={`Veliyi ara: ${formatTurkishPhoneInput(appointment.parentPhone)}`}><Phone size={15} />{formatTurkishPhoneInput(appointment.parentPhone)}</a></div>
        {appointment.notes && <p className="mt-4 p-3 bg-slate-50 rounded-xl">Veli notu: {appointment.notes}</p>}
        {appointment.status === 'rejected' && appointment.rejectionReason && <p className="mt-3">Ret gerekçesi: {appointment.rejectionReason}</p>}
        {appointment.status === 'cancelled' && appointment.cancellationReason && <p className="mt-3">İptal gerekçesi: {appointment.cancellationReason}</p>}
        {isExpiredPending(appointment) ? <p className="mt-3 text-sm text-slate-500">Saati geçtiği için bu talep artık onaylanamaz.</p> : appointment.status === 'pending' ? <div className="appointment-actions"><Button disabled={busy} onClick={() => { void handleApprove(appointment.id); }}><Check size={17} />Onayla</Button><Button variant="danger" disabled={busy} onClick={() => setRejectingAptId(appointment.id)}>Reddet</Button></div> : appointment.status === 'booked' && <div className="appointment-actions"><Button variant="quiet" disabled={busy} onClick={() => setCancelingApt(appointment)}>İptal et</Button></div>}
      </div>
    </article>
  );

  return (
    <main id="main-content" className="page-shell" {...touchHandlers}>
      <PageHeader eyebrow={`ÖĞRETMEN ALANI · ${currentUser?.branch || 'GÖRÜŞME PROGRAMI'}`} title={activeTab === 'home' ? `İyi günler, ${currentUser?.firstName}.` : navigation.find((item) => item.id === activeTab)?.label} description={activeTab === 'home' ? 'Görüşmelerinizi planlayın. Velilerinizle bağınızı güçlendirin.' : settings.schoolName} />
      <RoleNavigation items={navigation} active={activeTab} onChange={(tab) => { if (tab === 'appointments') setAppointmentFilter('all'); setActiveTab(tab); }} />
      {refreshControl}
      {feedback && <Toast tone={feedback.failed ? 'danger' : 'success'} resetKey={feedback} onClose={() => setFeedback(null)}>{feedback.message}</Toast>}
      {(activeTab === 'home' || activeTab === 'appointments') && schoolDataLoading && <Skeleton rows={3} />}
      {activeTab === 'home' && !schoolDataLoading && <div className="space-y-7">
        {pendingAppointments.length > 0 && <section className="hero-card"><div><p className="eyebrow">GÜNÜNÜZÜ PLANLAYIN</p><h2>{pendingAppointments.length ? `${pendingAppointments.length} görüşme talebi sizi bekliyor.` : 'Görüşme programınız güncel.'}</h2><p>{pendingAppointments.length ? 'Velilerinizin taleplerini inceleyerek görüşme planınızı netleştirin.' : 'Yeni talepler geldiğinde burada görebilirsiniz.'}</p></div><Button onClick={() => pendingAppointments.length ? showAppointments('pending') : setActiveTab('availability')}>{pendingAppointments.length ? 'Talepleri incele' : 'Müsaitlik programı'}<Calendar size={18} /></Button></section>}
        <div className="metric-grid"><Metric icon={Calendar} label="Bugünkü görüşme" value={todayAppointments.length} onClick={() => showAppointments('today')} /><Metric icon={Clock} label="Onay bekleyen" value={pendingAppointments.length} onClick={() => showAppointments('pending')} /><Metric icon={CheckCircle2} label="Onaylanan" value={bookedAppointments.length} onClick={() => showAppointments('approved')} /></div>
        <section><div className="section-heading"><div><h2>Bugünkü programınız</h2><p className="teacher-today-date">{formatDate(getIstanbulDate())}</p></div><Button variant="quiet" onClick={() => showAppointments('all')}>Tüm randevular</Button></div>
          {todayAppointments.length ? <div className="space-y-4">{todayAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Bugün için planlı görüşmeniz yok" description="Yaklaşan görüşmelerinizi Randevular ekranında bulabilirsiniz." /></div>}
        </section>
      </div>}
      {activeTab === 'appointments' && !schoolDataLoading && <div className="space-y-8">
        <div className="flex flex-wrap gap-2 chip-row" role="group" aria-label="Randevu filtresi">{([['all', 'Tümü'], ['today', 'Bugün'], ['pending', 'Bekleyen'], ['approved', 'Onaylı']] as const).map(([filter, label]) => <Button key={filter} variant={appointmentFilter === filter ? 'primary' : 'secondary'} aria-pressed={appointmentFilter === filter} onClick={() => setAppointmentFilter(filter)}>{label}</Button>)}</div>
        {appointmentFilter === 'today' && <section><div className="section-heading"><h2>Bugünkü görüşmeler ({todayAppointments.length})</h2></div>{todayAppointments.length ? <div className="space-y-4">{todayAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Bugün için planlı görüşme yok" /></div>}</section>}
        {(appointmentFilter === 'all' || appointmentFilter === 'pending') && <section><div className="section-heading"><h2>Onay bekleyenler ({pendingAppointments.length})</h2></div>{pendingAppointments.length ? <div className="space-y-4">{pendingAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={CheckCircle2} title="Bekleyen talep bulunmuyor" description="Yeni görüşme talepleri burada görünecek." /></div>}</section>}
        {(appointmentFilter === 'all' || appointmentFilter === 'approved') && <section><div className="section-heading"><h2>Onaylanan görüşmeler ({bookedAppointments.length})</h2></div>{bookedAppointments.length ? <div className="space-y-4">{bookedAppointments.map(appointmentCard)}</div> : <div className="surface"><EmptyState icon={Calendar} title="Onaylanan görüşme bulunmuyor" /></div>}</section>}
        {appointmentFilter === 'all' && completedAppointments.length > 0 && <section><div className="section-heading"><h2>Geçmiş randevular</h2></div><div className="space-y-4">{completedAppointments.map(appointmentCard)}</div></section>}
      </div>}
      {activeTab === 'availability' && <div className="space-y-6">
        <section className="surface"><div className="section-heading"><h2>Görüşme saatlerinizi belirleyin</h2></div>
          <AvailabilityForm durationMinutes={settings.defaultSlotMinutes} busy={busy} existing={teacherAvailability} onSubmit={(days, start, end, customDuration) => { void handleAddSlots(days, start, end, customDuration); }} />
        </section>
        <section className="surface"><div className="section-heading"><h2>Haftalık müsaitliğiniz</h2></div>{availabilityGroups.length ? <div className="space-y-3">{availabilityGroups.map((day) => <section key={day.id} className="availability-day" aria-labelledby={`availability-day-${day.id}`}><h3 id={`availability-day-${day.id}`} className="font-bold text-sm uppercase tracking-wide text-slate-700">{day.name}</h3><div className="divide-y divide-slate-200">{day.slots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-4 py-2"><p className="text-sm font-semibold text-slate-700">{slot.startTime} – {slot.endTime} <span className="availability-slot-duration">· {slot.slotDurationMinutes || settings.defaultSlotMinutes} dk</span></p><button type="button" disabled={busy} className="icon-button" aria-label={`${day.name} ${slot.startTime} müsaitlik aralığını sil`} onClick={() => { void perform(() => removeAvailabilitySlot(slot.id), 'Müsaitlik aralığı kaldırıldı.'); }}><Trash2 size={18} /></button></div>)}</div></section>)}</div> : <EmptyState icon={Clock} title="Henüz saat belirlemediniz" description="Yukarıdaki formdan uygun olduğunuz saatleri ekleyin." />}</section>
      </div>}
      {activeTab === 'profile' && <section className="surface max-w-xl"><div className="flex items-center gap-4"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><div><h2 className="font-bold text-xl">{currentUser?.firstName} {currentUser?.lastName}</h2><p className="text-blue-700 mt-1 text-sm">{currentUser?.branch}</p></div></div><dl className="pass-details mt-7"><div><dt>Telefon</dt><dd>{formatTurkishPhoneInput(currentUser?.phone || '')}</dd></div><div><dt>Okul</dt><dd>{settings.schoolName}</dd></div><div><dt>Bildirim e-postası</dt><dd>{myEmail || 'Eklenmedi'}</dd></div></dl><Button variant="secondary" className="mt-4" onClick={() => { setEmailError(''); setEmailDraft(myEmail); }}>{myEmail ? 'E-posta adresini düzenle' : 'E-posta adresi ekle'}</Button><p className="field-hint mt-2">Randevu bildirimleri bu adrese gönderilir. İsteğe bağlıdır.</p></section>}
      {emailDraft !== null && <Dialog title={myEmail ? 'E-posta adresini düzenle' : 'E-posta adresi ekle'} description="Randevu bildirimleri bu adrese gönderilir. Boş bırakıp kaydederseniz adres kaldırılır." onClose={() => setEmailDraft(null)} dismissible={!busy}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveEmail(); }}>{emailError && <Alert tone="danger">{emailError}</Alert>}<label className="field" htmlFor="teacher-own-email">E-posta<input id="teacher-own-email" type="email" autoComplete="email" maxLength={150} placeholder="ornek@eposta.com" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} /></label><div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEmailDraft(null)}>Vazgeç</Button><Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button></div></form></Dialog>}
      {cancelingApt && <Dialog title="Randevuyu iptal et" description={`${cancelingApt.studentName} · ${formatDate(cancelingApt.date)} ${cancelingApt.startTime}`} onClose={() => { setCancelingApt(null); setCancelReason(''); }} dismissible={!busy}><div className="form-stack"><p className="text-sm text-slate-600">Bu görüşme iptal edilecek ve veliye bildirim gidecek. Emin misiniz?</p><label className="field" htmlFor="cancel-reason">İptal gerekçesi <span className="field-hint">İsteğe bağlı</span><textarea id="cancel-reason" rows={3} maxLength={500} value={cancelReason} disabled={busy} onChange={(event) => setCancelReason(event.target.value)} placeholder="Veliye iletilecek kısa bir açıklama…" /></label><div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => { setCancelingApt(null); setCancelReason(''); }}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={() => { const target = cancelingApt; void perform(() => cancelAppointment(target.id, cancelReason), 'Randevu iptal edildi.').then((ok) => { if (ok) { setCancelingApt(null); setCancelReason(''); } }); }}>{busy ? 'İptal ediliyor…' : 'Randevuyu iptal et'}</Button></div></div></Dialog>}
      {rejectingAptId && <Dialog title="Randevuyu reddet" description="Dilerseniz veliye iletilecek kısa bir açıklama ekleyin." onClose={() => setRejectingAptId(null)} dismissible={!busy}><div className="form-stack">{feedback?.failed && <Alert tone="danger">{feedback.message}</Alert>}<label className="field" htmlFor="rejection-reason">Ret gerekçesi <span className="field-hint">İsteğe bağlı</span><textarea id="rejection-reason" rows={3} maxLength={500} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Bu saatte görüşme yapamama nedeniniz…" /></label><div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRejectingAptId(null)}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={handleConfirmReject}>{busy ? 'Kaydediliyor…' : 'Randevuyu reddet'}</Button></div></div></Dialog>}
    </main>
  );
};
