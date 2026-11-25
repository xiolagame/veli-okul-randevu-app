import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {
  appointmentApprovedMessage, appointmentCancelledForParentMessage, appointmentCancelledForTeacherMessage,
  appointmentRejectedMessage, appointmentRequestedMessage, cleanAppointmentReason, formatAppointmentWhen, shortenForPush,
} from '../src/utils/appointment-messages';

// Randevu iptali: isteğe bağlı gerekçe, karşı tarafa uygulama içi bildirim + push, net bildirim cümleleri.
let stage = 'messages';
async function run() {
  // 1. Bildirim cümleleri
  assert.equal(formatAppointmentWhen('2026-11-27', '10:00:00'), '27 Kasım Cuma 10:00');
  assert.equal(formatAppointmentWhen('2027-01-04T00:00:00.000Z', '09:30'), '4 Ocak Pazartesi 09:30');
  assert.equal(cleanAppointmentReason('   '), undefined);
  assert.equal(cleanAppointmentReason(42), undefined);
  assert.equal(cleanAppointmentReason('  Toplantım\n var  '), 'Toplantım var');
  assert.equal(cleanAppointmentReason('x'.repeat(600))!.length, 500);
  const when = { date: '2026-11-27', startTime: '10:00' };
  assert.deepEqual(appointmentApprovedMessage({ teacherName: 'ZEYNEP YILDIRIM', ...when }),
    { title: 'Randevunuz onaylandı', message: 'ZEYNEP YILDIRIM, 27 Kasım Cuma 10:00 randevunuzu onayladı.' });
  assert.deepEqual(appointmentRejectedMessage({ teacherName: 'ZEYNEP YILDIRIM', reason: 'Toplantım var' }),
    { title: 'Randevunuz reddedildi', message: 'ZEYNEP YILDIRIM randevu talebinizi reddetti. Sebep: Toplantım var' });
  assert.equal(appointmentRejectedMessage({ teacherName: 'Z' }).message, 'Z randevu talebinizi reddetti.');
  assert.deepEqual(appointmentCancelledForParentMessage({ cancelledBy: 'teacher', teacherName: 'ZEYNEP YILDIRIM', ...when }),
    { title: 'Randevunuz iptal edildi', message: 'ZEYNEP YILDIRIM, 27 Kasım Cuma 10:00 randevunuzu iptal etti.' });
  assert.equal(appointmentCancelledForParentMessage({ cancelledBy: 'admin', teacherName: 'X', ...when, reason: 'Tatil' }).message,
    'Okul yönetimi, 27 Kasım Cuma 10:00 randevunuzu iptal etti. Sebep: Tatil');
  assert.deepEqual(appointmentCancelledForTeacherMessage({ parentName: 'MUSTAFA ÇELİK', studentName: 'ELİF ÇELİK', className: '5-A', ...when, reason: 'Hastayız' }),
    { title: 'Randevu iptal edildi', message: 'MUSTAFA ÇELİK (ELİF ÇELİK, 5-A), 27 Kasım Cuma 10:00 randevusunu iptal etti. Sebep: Hastayız' });
  assert.equal(appointmentRequestedMessage({ parentName: 'MUSTAFA ÇELİK', studentName: 'ELİF ÇELİK', className: '5-A', ...when }).message,
    'MUSTAFA ÇELİK (ELİF ÇELİK, 5-A) 27 Kasım Cuma 10:00 için randevu talep etti.');
  for (const text of [appointmentApprovedMessage({ teacherName: 'A', ...when }), appointmentRejectedMessage({ teacherName: 'A' }),
    appointmentCancelledForParentMessage({ cancelledBy: 'teacher', teacherName: 'A', ...when })]) {
    assert(!/onaylanmadı|sonuçlandı/i.test(text.title + text.message), 'belirsiz ifade kullanılmaz');
  }
  const longPush = shortenForPush('ZEYNEP YILDIRIM randevu talebinizi reddetti. Sebep: ' + 'çok uzun bir açıklama '.repeat(20));
  assert(longPush.length <= 110 && longPush.endsWith('…'));
  assert.equal(shortenForPush('Kısa metin.'), 'Kısa metin.');

  // 2. Sunucu akışı
  stage = 'setup';
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite only.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  delete process.env.FCM_FIREBASE_PROJECT_ID;
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { registerPushDevice, dispatchPushDeliveries, createPushPayload } = await import('../server/push-notifications');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `cancel-school-${suffix}`;
  const ids = { parent: `cancel-parent-${suffix}`, otherParent: `cancel-other-${suffix}`, teacher: `cancel-teacher-${suffix}`, admin: `cancel-admin-${suffix}` };
  const profileId = `cancel-profile-${suffix}`;
  await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'İptal Okulu', `C${crypto.randomBytes(6).toString('hex')}`, 'Test', 'Test']);
  const names: Record<string, [string, string]> = { parent: ['MUSTAFA', 'ÇELİK'], otherParent: ['BAŞKA', 'VELİ'], teacher: ['ZEYNEP', 'YILDIRIM'], admin: ['HASAN', 'AYDIN'] };
  for (const [key, id] of Object.entries(ids)) {
    await db.query('INSERT INTO users(id,phone,first_name,last_name) VALUES($1,$2,$3,$4)', [id, `+905${crypto.randomInt(100000000, 999999999)}`, ...names[key]]);
    await db.query('INSERT INTO school_memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',
      [`mem-${id}`, schoolId, id, key === 'otherParent' ? 'parent' : key]);
  }
  await db.query(`INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch) VALUES($1,$2,$3,'ZEYNEP','YILDIRIM','Matematik')`, [profileId, schoolId, ids.teacher]);
  const appointment = async (status: 'pending' | 'booked', date = '2099-01-05', start = '10:00') => {
    const id = `cancel-apt-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,
      parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code)
      VALUES($1,$2,$3,'ZEYNEP YILDIRIM','Matematik',$4,'MUSTAFA ÇELİK','+905551111111','ELİF ÇELİK','5-A',$5,$6,'10:30',$7,'123456')`,
    [id, schoolId, profileId, ids.parent, date, start, status]);
    return id;
  };
  const device = (target: string) => ({ installationId: crypto.randomUUID(), platform: 'ANDROID', provider: 'FCM',
    targetKind: 'REGISTRATION_TOKEN', providerTarget: target, appId: 'com.velirandevu.app' });
  assert(await registerPushDevice(ids.parent, device(`fcm-cancel-parent-${suffix}`)));
  assert(await registerPushDevice(ids.teacher, device(`fcm-cancel-teacher-${suffix}`)));

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  const post = async (userId: string, path: string, body?: object) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `Bearer ${createToken({ userId, phone: '+905551111111', auth_version: 0, auth_method: 'phone_centric' })}` },
    body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const cancel = (userId: string, id: string, body?: object) => post(userId, `/schools/${schoolId}/appointments/${id}/cancel`, body);
  const notificationsFor = async (appointmentId: string) => (await db.query<{ id: string; user_id: string; title: string; message: string }>(
    'SELECT id,user_id,title,message FROM notifications WHERE appointment_id=$1 ORDER BY created_at', [appointmentId])).rows;
  const deliveriesFor = async (notificationId: string) => (await db.query<{ event_type: string; device_user: string }>(
    `SELECT nd.event_type, d.user_id AS device_user FROM notification_deliveries nd JOIN mobile_push_devices d ON d.id=nd.device_id
     WHERE nd.notification_id=$1`, [notificationId])).rows;

  try {
    stage = 'teacher cancels a booked appointment with a reason';
    const booked = await appointment('booked');
    const teacherCancel = await cancel(ids.teacher, booked, { reason: '  Okulda acil toplantı var  ' });
    assert.equal(teacherCancel.status, 200);
    assert.equal(teacherCancel.body.appointment.status, 'cancelled');
    assert.equal(teacherCancel.body.appointment.cancellationReason, 'Okulda acil toplantı var');
    let notes = await notificationsFor(booked);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].user_id, ids.parent);
    assert.equal(notes[0].title, 'Randevunuz iptal edildi');
    assert.equal(notes[0].message, 'ZEYNEP YILDIRIM, 5 Ocak Pazartesi 10:00 randevunuzu iptal etti. Sebep: Okulda acil toplantı var');
    assert.deepEqual(await deliveriesFor(notes[0].id), [{ event_type: 'APPOINTMENT_CANCELLED_FOR_PARENT', device_user: ids.parent }]);

    stage = 'second cancel is refused and sends nothing';
    assert.equal((await cancel(ids.teacher, booked, { reason: 'tekrar' })).status, 409);
    assert.equal((await cancel(ids.parent, booked)).status, 409);
    assert.equal((await notificationsFor(booked)).length, 1);
    assert.equal((await db.query('SELECT cancellation_reason FROM appointments WHERE id=$1', [booked])).rows[0].cancellation_reason, 'Okulda acil toplantı var');

    stage = 'parent cancels an approved appointment without a reason';
    const approved = await appointment('booked', '2099-01-06');
    const parentCancel = await cancel(ids.parent, approved, { reason: '   ' });
    assert.equal(parentCancel.status, 200);
    assert.equal(parentCancel.body.appointment.cancellationReason, undefined);
    notes = await notificationsFor(approved);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].user_id, ids.teacher);
    assert.equal(notes[0].title, 'Randevu iptal edildi');
    assert.equal(notes[0].message, 'MUSTAFA ÇELİK (ELİF ÇELİK, 5-A), 6 Ocak Salı 10:00 randevusunu iptal etti.');
    assert.deepEqual(await deliveriesFor(notes[0].id), [{ event_type: 'APPOINTMENT_CANCELLED_FOR_TEACHER', device_user: ids.teacher }]);

    stage = 'parent cancels a pending request with a reason; old clients without a body still work';
    const pending = await appointment('pending', '2099-01-07');
    assert.equal((await cancel(ids.parent, pending, { reason: 'Çocuğum hasta' })).status, 200);
    assert.match((await notificationsFor(pending))[0].message, /Sebep: Çocuğum hasta$/);
    const noBody = await appointment('booked', '2099-01-08');
    assert.equal((await cancel(ids.parent, noBody)).status, 200);

    stage = 'school admin cancel names the school administration';
    const adminApt = await appointment('booked', '2099-01-09');
    assert.equal((await cancel(ids.admin, adminApt, { reason: 'Okul tatil' })).status, 200);
    notes = await notificationsFor(adminApt);
    assert.equal(notes[0].user_id, ids.parent);
    assert.equal(notes[0].message, 'Okul yönetimi, 9 Ocak Cuma 10:00 randevunuzu iptal etti. Sebep: Okul tatil');
    assert.equal((await deliveriesFor(notes[0].id))[0].event_type, 'APPOINTMENT_CANCELLED_FOR_PARENT');

    stage = 'another parent cannot cancel';
    const foreign = await appointment('booked', '2099-01-12');
    assert.equal((await cancel(ids.otherParent, foreign, { reason: 'x' })).status, 403);
    assert.equal((await notificationsFor(foreign)).length, 0);

    stage = 'reject uses the clear wording';
    const toReject = await appointment('pending', '2099-01-13');
    assert.equal((await post(ids.teacher, `/schools/${schoolId}/appointments/${toReject}/reject`, { reason: 'O saatte dersim var' })).status, 200);
    notes = await notificationsFor(toReject);
    assert.equal(notes[0].title, 'Randevunuz reddedildi');
    assert.equal(notes[0].message, 'ZEYNEP YILDIRIM randevu talebinizi reddetti. Sebep: O saatte dersim var');

    stage = 'push shows the same title and text, shortened';
    const longReason = 'Bu hafta okulda veli toplantıları ve sınav haftası olduğu için randevuyu başka bir güne almamız gerekiyor, anlayışınız için teşekkürler.';
    const longApt = await appointment('booked', '2099-01-14');
    assert.equal((await cancel(ids.teacher, longApt, { reason: longReason })).status, 200);
    await db.query(`UPDATE notification_deliveries SET status='PENDING',next_attempt_at=NOW()-INTERVAL '1 second',attempt_count=0
      WHERE notification_id IN (SELECT id FROM notifications WHERE school_id=$1)`, [schoolId]);
    const sent: Array<{ target: string; title: string; body: string; data: Record<string, string> }> = [];
    let sendSeq = 0;
    await dispatchPushDeliveries({ send: async (target, payload) => { sent.push({ target, ...payload }); return { status: 'SENT', messageId: `m-${sendSeq++}` }; } }, 100);
    const longPayload = sent.find((item) => item.data.resourceId === longApt);
    assert(longPayload, 'uzun gerekçeli iptal push olarak gönderildi');
    assert.equal(longPayload.title, 'Randevunuz iptal edildi');
    assert(longPayload.body.startsWith('ZEYNEP YILDIRIM, 14 Ocak Çarşamba 10:00 randevunuzu iptal etti. Sebep:'));
    assert(longPayload.body.length <= 110 && longPayload.body.endsWith('…'));
    assert.deepEqual(Object.keys(longPayload.data).sort(), ['eventType', 'notificationId', 'resourceId', 'resourceType', 'route']);
    assert.equal(longPayload.data.eventType, 'APPOINTMENT_CANCELLED_FOR_PARENT');
    const teacherPayload = sent.find((item) => item.data.resourceId === approved)!;
    assert.equal(teacherPayload.title, 'Randevu iptal edildi');
    assert.equal(teacherPayload.target, `fcm-cancel-teacher-${suffix}`);
    assert.equal(sent.find((item) => item.data.resourceId === toReject)!.title, 'Randevunuz reddedildi');
    assert.equal((await notificationsFor(longApt))[0].message.endsWith(longReason), true, 'tam gerekçe uygulama içinde kalır');
    // Metin verilmezse eski genel metin kullanılır (geriye uyum).
    assert.equal(createPushPayload('APPOINTMENT_REJECTED', 'a', 'n').body, 'Randevu talebiniz öğretmen tarafından reddedildi.');

    console.log('Appointment cancellation PASS: optional reasons, teacher/parent/admin cancel notifications and pushes, no duplicate cancel, clear wording, shortened push text.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM notifications WHERE school_id=$1', [schoolId]);
    await db.query('DELETE FROM appointments WHERE school_id=$1', [schoolId]);
    await db.query('DELETE FROM mobile_push_devices WHERE user_id = ANY($1)', [Object.values(ids)]);
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]);
  }
}

run().catch((cause) => {
  console.error(`Appointment cancellation test FAILED at stage: ${stage}.`);
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
