-- ==============================================================================
-- VELİ - OKUL RANDEVU SİSTEMİ: İDEMPOTENT SEED & MIGRATION SQL
-- Üretim Tarihi: 2026-09-22T09:58:58.304Z
-- ==============================================================================

BEGIN;

INSERT INTO schools (id, name, code, city, district, settings)
VALUES ('sch-kazan-01', 'Kahramankazan Şehit Ömer Takdemir Ortaokulu', 'KAZAN2025', 'Ankara', 'Kahramankazan', '{"schoolName":"Kahramankazan Şehit Ömer Takdemir Ortaokulu","appName":"VELİ","defaultSlotMinutes":15,"minSlotMinutes":10,"maxBookingDaysAhead":30,"allowParentCancel":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  city = EXCLUDED.city,
  district = EXCLUDED.district,
  settings = EXCLUDED.settings,
  updated_at = NOW();
INSERT INTO schools (id, name, code, city, district, settings)
VALUES ('sch-ataturk-02', 'Atatürk Fen Lisesi', 'ATATURK06', 'Ankara', 'Çankaya', '{"schoolName":"Atatürk Fen Lisesi","appName":"VELİ","defaultSlotMinutes":20,"minSlotMinutes":15,"maxBookingDaysAhead":15,"allowParentCancel":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  city = EXCLUDED.city,
  district = EXCLUDED.district,
  settings = EXCLUDED.settings,
  updated_at = NOW();
INSERT INTO schools (id, name, code, city, district, settings)
VALUES ('sch-cumhuriyet-03', 'Cumhuriyet İlkokulu', 'CUMHURIYET01', 'İstanbul', 'Kadıköy', '{"schoolName":"Cumhuriyet İlkokulu","appName":"VELİ","defaultSlotMinutes":15,"minSlotMinutes":10,"maxBookingDaysAhead":20,"allowParentCancel":false}'::jsonb)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  city = EXCLUDED.city,
  district = EXCLUDED.district,
  settings = EXCLUDED.settings,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-parent-1', '+905551234567', 'Ahmet', 'Yılmaz', true, 'İlk evcil hayvanınızın adı nedir?')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-parent-2', '+905559876543', 'Fatma', 'Kaya', true, 'Çocuklukta en sevdiğiniz öğretmenin adı nedir?')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-parent-x', '+905553332211', 'Kemal', 'Aksoy', true, 'İlk arabanızın markası nedir?')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-teacher-1', '+905321112233', 'Mehmet', 'Demir', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-teacher-2', '+905332223344', 'Ayşe', 'Öztürk', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-teacher-b1', '+905338889900', 'Zeki', 'Bulut', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-security-1', '+905550001122', 'Hasan', 'Güvenç', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-security-b1', '+905550003344', 'Osman', 'Kaya', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-admin-1', '+905559998877', 'Okul', 'Yönetimi', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('u-admin-b1', '+905558887766', 'Atatürk Lisesi', 'Müdürlüğü', true, '')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-1', 'sch-kazan-01', 'u-parent-1', 'parent', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-2', 'sch-cumhuriyet-03', 'u-parent-1', 'parent', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-3', 'sch-kazan-01', 'u-parent-2', 'parent', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-4', 'sch-kazan-01', 'u-teacher-1', 'teacher', 'Matematik', 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-5', 'sch-kazan-01', 'u-teacher-2', 'teacher', 'Türkçe', 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-6', 'sch-ataturk-02', 'u-teacher-b1', 'teacher', 'Fizik', 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-7', 'sch-kazan-01', 'u-security-1', 'security', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-8', 'sch-ataturk-02', 'u-security-b1', 'security', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-9', 'sch-kazan-01', 'u-admin-1', 'admin', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-10', 'sch-ataturk-02', 'u-admin-b1', 'admin', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('m-parent-x', 'sch-ataturk-02', 'u-parent-x', 'parent', NULL, 'active', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();
INSERT INTO students (id, school_id, name, class_name, student_number)
VALUES ('s-1', 'sch-kazan-01', 'Emre Yılmaz', '7-B', '412')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  class_name = EXCLUDED.class_name,
  student_number = EXCLUDED.student_number,
  updated_at = NOW();
INSERT INTO students (id, school_id, name, class_name, student_number)
VALUES ('s-2', 'sch-kazan-01', 'Zeynep Yılmaz', '5-A', '108')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  class_name = EXCLUDED.class_name,
  student_number = EXCLUDED.student_number,
  updated_at = NOW();
INSERT INTO students (id, school_id, name, class_name, student_number)
VALUES ('s-3', 'sch-kazan-01', 'Burak Kaya', '8-C', '534')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  class_name = EXCLUDED.class_name,
  student_number = EXCLUDED.student_number,
  updated_at = NOW();
INSERT INTO students (id, school_id, name, class_name, student_number)
VALUES ('s-4', 'sch-cumhuriyet-03', 'Can Yılmaz', '2-A', '34')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  class_name = EXCLUDED.class_name,
  student_number = EXCLUDED.student_number,
  updated_at = NOW();
INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
VALUES ('rel-1', 'sch-kazan-01', 's-1', 'u-parent-1', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET 
  verified_at = EXCLUDED.verified_at;
INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
VALUES ('rel-2', 'sch-kazan-01', 's-2', 'u-parent-1', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET 
  verified_at = EXCLUDED.verified_at;
INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
VALUES ('rel-3', 'sch-kazan-01', 's-3', 'u-parent-2', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET 
  verified_at = EXCLUDED.verified_at;
INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
VALUES ('rel-4', 'sch-cumhuriyet-03', 's-4', 'u-parent-1', '2026-09-20T15:29:54.628Z')
ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET 
  verified_at = EXCLUDED.verified_at;
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-1', 'sch-kazan-01', '+905551234567', 'Ahmet Yılmaz', 'Emre Yılmaz', '7-B', '412', true)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-2', 'sch-kazan-01', '+905551234567', 'Ahmet Yılmaz', 'Zeynep Yılmaz', '5-A', '108', true)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-3', 'sch-kazan-01', '+905559876543', 'Fatma Kaya', 'Burak Kaya', '8-C', '534', true)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-4', 'sch-kazan-01', '+905554443322', 'Ayşe Çetin', 'Selin Çetin', '6-C', '315', false)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-5', 'sch-ataturk-02', '+905551234567', 'Ahmet Yılmaz', 'Mert Yılmaz', '9-B', '89', false)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-6', 'sch-ataturk-02', '+905553332211', 'Kemal Aksoy', 'Barış Aksoy', '10-A', '124', false)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-7', 'sch-cumhuriyet-03', '+905551234567', 'Ahmet Yılmaz', 'Can Yılmaz', '2-A', '34', true)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('rost-1789919140682-879', 'sch-kazan-01', '+905558887766', 'Ali Can', 'Ece Can', '7-B', '512', false)
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();
INSERT INTO teacher_profiles (id, school_id, user_id, first_name, last_name, branch, email, phone)
VALUES ('u-teacher-1', 'sch-kazan-01', 'u-teacher-1', 'Mehmet', 'Demir', 'Matematik', '', '+905321112233')
ON CONFLICT (id) DO UPDATE SET 
  user_id = EXCLUDED.user_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  branch = EXCLUDED.branch,
  updated_at = NOW();
INSERT INTO teacher_profiles (id, school_id, user_id, first_name, last_name, branch, email, phone)
VALUES ('u-teacher-2', 'sch-kazan-01', 'u-teacher-2', 'Ayşe', 'Öztürk', 'Türkçe', '', '+905332223344')
ON CONFLICT (id) DO UPDATE SET 
  user_id = EXCLUDED.user_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  branch = EXCLUDED.branch,
  updated_at = NOW();
INSERT INTO teacher_profiles (id, school_id, user_id, first_name, last_name, branch, email, phone)
VALUES ('u-teacher-b1', 'sch-ataturk-02', 'u-teacher-b1', 'Zeki', 'Bulut', 'Fizik', '', '+905338889900')
ON CONFLICT (id) DO UPDATE SET 
  user_id = EXCLUDED.user_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  branch = EXCLUDED.branch,
  updated_at = NOW();
INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring)
VALUES ('av-1', 'sch-kazan-01', 'u-teacher-1', 1, '09:30', '11:30', 15, true)
ON CONFLICT (id) DO UPDATE SET 
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = NOW();
INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring)
VALUES ('av-2', 'sch-kazan-01', 'u-teacher-1', 3, '13:30', '15:00', 15, true)
ON CONFLICT (id) DO UPDATE SET 
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = NOW();
INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring)
VALUES ('av-3', 'sch-kazan-01', 'u-teacher-2', 2, '10:00', '12:00', 15, true)
ON CONFLICT (id) DO UPDATE SET 
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = NOW();
INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring)
VALUES ('av-4', 'sch-ataturk-02', 'u-teacher-b1', 2, '10:00', '12:00', 15, true)
ON CONFLICT (id) DO UPDATE SET 
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = NOW();
INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('apt-1789919140667', 'sch-kazan-01', 'u-teacher-1', 'Mehmet Demir', 'Matematik', 'u-parent-1', 'Ahmet Yılmaz', '+905551234567', NULL, 'Emre Yılmaz', '8-A', '2026-09-20', '09:30', '09:45', 'pending', '619660', 'Çakışma denemesi', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();
INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('apt-1789918678770', 'sch-kazan-01', 'u-teacher-1', 'Mehmet Demir', 'Matematik', 'u-parent-1', 'Ahmet Yılmaz', '+905551234567', NULL, 'Emre Yılmaz', '8-A', '2026-09-25', '11:00', '11:15', 'pending', '914966', 'Cihazlar arası bildirim testi', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();
INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('apt-1', 'sch-kazan-01', 'u-teacher-1', 'Mehmet Demir', 'Matematik', 'u-parent-1', 'Ahmet Yılmaz', '+905551234567', 's-1', 'Emre Yılmaz', '7-B', '2026-09-20', '10:00', '10:15', 'booked', '482915', 'Matematik yazılı sonuçları değerlendirmesi.', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();
INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('apt-2', 'sch-kazan-01', 'u-teacher-2', 'Ayşe Öztürk', 'Türkçe', 'u-parent-1', 'Ahmet Yılmaz', '+905551234567', 's-2', 'Zeynep Yılmaz', '5-A', '2026-09-23', '10:30', '10:45', 'pending', '729304', 'Okuma etkinlikleri değerlendirmesi.', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();
INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('apt-b1', 'sch-ataturk-02', 'u-teacher-b1', 'Zeki Bulut', 'Fizik', 'u-parent-x', 'Kemal Aksoy', '+905553332211', NULL, 'Barış Aksoy', '10-A', '2026-09-20', '10:00', '10:20', 'booked', '918273', 'Fizik laboratuvarı ve proje seçimi.', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();
INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
VALUES ('notif-1789919140667', 'sch-kazan-01', 'u-teacher-1', 'Yeni Randevu Talebi', 'Ahmet Yılmaz (Emre Yılmaz - 8-A) 2026-09-20 saat 09:30 için randevu talep etti.', 'Yeni', false, 'apt-1789919140667')
ON CONFLICT (id) DO UPDATE SET 
  read = EXCLUDED.read;
INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
VALUES ('notif-1789918678770', 'sch-kazan-01', 'u-teacher-1', 'Yeni Randevu Talebi', 'Ahmet Yılmaz (Emre Yılmaz - 8-A) 2026-09-25 saat 11:00 için randevu talep etti.', 'Yeni', false, 'apt-1789918678770')
ON CONFLICT (id) DO UPDATE SET 
  read = EXCLUDED.read;
INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
VALUES ('notif-1', 'sch-kazan-01', 'u-parent-1', 'Randevunuz Onaylandı', 'Mehmet Demir ile randevunuz onaylandı. Okul giriş kodunuz: 482915', 'Bugün 08:30', false, 'apt-1')
ON CONFLICT (id) DO UPDATE SET 
  read = EXCLUDED.read;
INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('log-1789919165943', 'sch-kazan-01', '15:46', 'Kütük Yükleme (CSV/Excel)', 'Okul Yönetimi (Yönetici)', '0 yeni öğrenci-veli kütük kaydı sisteme aktarıldı.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('log-1789919140682', 'sch-kazan-01', '15:45', 'Kütük Yükleme (CSV/Excel)', 'Okul Yönetimi (Yönetici)', '1 yeni öğrenci-veli kütük kaydı sisteme aktarıldı.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('log-1789919140667', 'sch-kazan-01', '15:45', 'Randevu Talebi', 'Ahmet Yılmaz', 'Mehmet Demir ile 2026-09-20 09:30 randevu talebi oluşturuldu.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('log-1789918678770', 'sch-kazan-01', '15:37', 'Randevu Talebi', 'Ahmet Yılmaz', 'Mehmet Demir ile 2026-09-25 11:00 randevu talebi oluşturuldu.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('log-1', 'sch-kazan-01', '15:29', 'Randevu Onayı', 'Mehmet Demir (Öğretmen)', 'Ahmet Yılmaz için randevu onaylandı.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO invitations (id, school_id, token, description, is_active)
VALUES 
  ('inv-kazan-qr', 'sch-kazan-01', 'QR-KAZAN-2025', 'Kahramankazan Veli Giriş QR Daveti', true),
  ('inv-ataturk-qr', 'sch-ataturk-02', 'QR-ATATURK-2025', 'Atatürk Fen Lisesi Veli Giriş QR Daveti', true),
  ('inv-cumhuriyet-qr', 'sch-cumhuriyet-03', 'QR-CUMHURIYET-2025', 'Cumhuriyet İlkokulu Veli Giriş QR Daveti', true)
ON CONFLICT (id) DO UPDATE SET 
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description;

COMMIT;
