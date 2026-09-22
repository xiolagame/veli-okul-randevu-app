import {
  User,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  NotificationItem,
  SchoolSettings,
  AuditLogItem,
} from '../types';

export const INITIAL_SETTINGS: SchoolSettings = {
  schoolName: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
  appName: 'VELİ',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 30,
  allowParentCancel: true,
};

export const INITIAL_USERS: User[] = [
  {
    id: 'u-parent-1',
    role: 'parent',
    firstName: 'Ahmet',
    lastName: 'Yılmaz',
    phone: '+905551234567',
    students: [
      { id: 's-1', name: 'Emre Yılmaz', className: '7-B' },
      { id: 's-2', name: 'Zeynep Yılmaz', className: '5-A' },
    ],
    securityQuestion: 'İlk evcil hayvanınızın adı nedir?',
  },
  {
    id: 'u-parent-2',
    role: 'parent',
    firstName: 'Fatma',
    lastName: 'Kaya',
    phone: '+905559876543',
    students: [
      { id: 's-3', name: 'Burak Kaya', className: '8-C' },
    ],
    securityQuestion: 'Çocuklukta en sevdiğiniz öğretmenin adı nedir?',
  },
  {
    id: 'u-teacher-1',
    role: 'teacher',
    firstName: 'Mehmet',
    lastName: 'Demir',
    phone: '+905321112233',
    branch: 'Matematik',
    securityQuestion: 'Çocukken yaşadığınız mahallenin adı nedir?',
  },
  {
    id: 'u-teacher-2',
    role: 'teacher',
    firstName: 'Ayşe',
    lastName: 'Öztürk',
    phone: '+905332223344',
    branch: 'Türkçe',
    securityQuestion: 'İlk evcil hayvanınızın adı nedir?',
  },
  {
    id: 'u-teacher-3',
    role: 'teacher',
    firstName: 'Kemal',
    lastName: 'Çelik',
    phone: '+905343334455',
    branch: 'Fen Bilimleri',
  },
  {
    id: 'u-teacher-4',
    role: 'teacher',
    firstName: 'Elif',
    lastName: 'Arslan',
    phone: '+905354445566',
    branch: 'İngilizce',
  },
  {
    id: 'u-teacher-5',
    role: 'teacher',
    firstName: 'Mustafa',
    lastName: 'Aydın',
    phone: '+905365556677',
    branch: 'Rehberlik',
  },
  {
    id: 'u-security-1',
    role: 'security',
    firstName: 'Hasan',
    lastName: 'Güvenç',
    phone: '+905550001122',
  },
  {
    id: 'u-admin-1',
    role: 'admin',
    firstName: 'Okul',
    lastName: 'Yönetimi',
    phone: '+905559998877',
  },
];

export const INITIAL_TEACHERS: TeacherProfile[] = [
  {
    id: 'u-teacher-1',
    firstName: 'Mehmet',
    lastName: 'Demir',
    phone: '+905321112233',
    branch: 'Matematik',
    bio: '7. ve 8. sınıf LGS hazırlık matematik dersleri zümre başkanı.',
  },
  {
    id: 'u-teacher-2',
    firstName: 'Ayşe',
    lastName: 'Öztürk',
    phone: '+905332223344',
    branch: 'Türkçe',
    bio: 'Türkçe öğretmeni, kitap okuma kulübü ve münazara danışmanı.',
  },
  {
    id: 'u-teacher-3',
    firstName: 'Kemal',
    lastName: 'Çelik',
    phone: '+905343334455',
    branch: 'Fen Bilimleri',
    bio: 'Fen Laboratuvarı sorumlusu ve TÜBİTAK proje koordinatörü.',
  },
  {
    id: 'u-teacher-4',
    firstName: 'Elif',
    lastName: 'Arslan',
    phone: '+905354445566',
    branch: 'İngilizce',
    bio: 'Yabancı diller zümresi, Cambridge sınav rehberliği.',
  },
  {
    id: 'u-teacher-5',
    firstName: 'Mustafa',
    lastName: 'Aydın',
    phone: '+905365556677',
    branch: 'Rehberlik ve Psikolojik Danışmanlık',
    bio: 'Öğrenci gelişim takibi, sınav kaygısı ve mesleki yönlendirme.',
  },
];

export const INITIAL_AVAILABILITY: AvailabilitySlot[] = [
  { id: 'av-1', teacherId: 'u-teacher-1', dayOfWeek: 1, startTime: '09:30', endTime: '11:30', slotDurationMinutes: 15 },
  { id: 'av-2', teacherId: 'u-teacher-1', dayOfWeek: 3, startTime: '13:30', endTime: '15:00', slotDurationMinutes: 15 },
  { id: 'av-3', teacherId: 'u-teacher-2', dayOfWeek: 2, startTime: '10:00', endTime: '12:00', slotDurationMinutes: 15 },
  { id: 'av-4', teacherId: 'u-teacher-2', dayOfWeek: 4, startTime: '14:00', endTime: '15:30', slotDurationMinutes: 15 },
  { id: 'av-5', teacherId: 'u-teacher-3', dayOfWeek: 3, startTime: '10:00', endTime: '12:00', slotDurationMinutes: 15 },
  { id: 'av-6', teacherId: 'u-teacher-4', dayOfWeek: 1, startTime: '13:00', endTime: '15:00', slotDurationMinutes: 15 },
  { id: 'av-7', teacherId: 'u-teacher-5', dayOfWeek: 5, startTime: '09:00', endTime: '12:00', slotDurationMinutes: 20 },
];

// Helper to get formatted today date
const todayObj = new Date();
export const getTodayDateString = () => todayObj.toISOString().split('T')[0];

const getFutureDateString = (daysAhead: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
};

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-1',
    teacherId: 'u-teacher-1',
    teacherName: 'Mehmet Demir',
    teacherBranch: 'Matematik',
    parentId: 'u-parent-1',
    parentName: 'Ahmet Yılmaz',
    parentPhone: '+905551234567',
    studentName: 'Emre Yılmaz',
    className: '7-B',
    date: getTodayDateString(),
    startTime: '10:00',
    endTime: '10:15',
    status: 'booked',
    entryCode: '482915',
    notes: 'Matematik yazılı sonuçları ve ödev disiplini değerlendirmesi.',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'apt-2',
    teacherId: 'u-teacher-2',
    teacherName: 'Ayşe Öztürk',
    teacherBranch: 'Türkçe',
    parentId: 'u-parent-1',
    parentName: 'Ahmet Yılmaz',
    parentPhone: '+905551234567',
    studentName: 'Zeynep Yılmaz',
    className: '5-A',
    date: getFutureDateString(3),
    startTime: '10:30',
    endTime: '10:45',
    status: 'pending',
    entryCode: '729304',
    notes: 'Okuma etkinlikleri ve Türkçe dersi genel durumu.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'apt-3',
    teacherId: 'u-teacher-1',
    teacherName: 'Mehmet Demir',
    teacherBranch: 'Matematik',
    parentId: 'u-parent-2',
    parentName: 'Fatma Kaya',
    parentPhone: '+905559876543',
    studentName: 'Burak Kaya',
    className: '8-C',
    date: getTodayDateString(),
    startTime: '10:45',
    endTime: '11:00',
    status: 'checked_in',
    entryCode: '159283',
    notes: 'LGS deneme sınavı analizi.',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    checkedInAt: '10:35',
  },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    userId: 'u-parent-1',
    title: 'Randevunuz Onaylandı',
    message: 'Mehmet Demir ile bugün saat 10:00 için randevunuz onaylandı. Okul giriş kodunuz: 482915',
    date: 'Bugün 08:30',
    read: false,
    appointmentId: 'apt-1',
  },
  {
    id: 'notif-2',
    userId: 'u-teacher-1',
    title: 'Yeni Randevu Talebi',
    message: 'Ahmet Yılmaz (Öğrenci: Emre Yılmaz) randevu talebinde bulundu.',
    date: '2 gün önce',
    read: true,
    appointmentId: 'apt-1',
  },
];

export const INITIAL_AUDIT: AuditLogItem[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 3600000 * 4).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    action: 'Randevu Onayı',
    actorName: 'Mehmet Demir (Öğretmen)',
    details: 'Ahmet Yılmaz için 10:00 randevusunu onayladı.',
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 3600000 * 2).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    action: 'Kapı Girişi Kaydı',
    actorName: 'Hasan Güvenç (Güvenlik)',
    details: 'Kod 159283 (Fatma Kaya) okula giriş yaptı.',
  },
];

export const SECURITY_QUESTIONS_LIST = [
  'Çocuklukta en sevdiğiniz öğretmenin adı nedir?',
  'İlk evcil hayvanınızın adı nedir?',
  'Çocukken yaşadığınız mahallenin adı nedir?',
  'En sevdiğiniz çocukluk oyunu nedir?',
  'Sizin için önemli olan özel bir kelime nedir?',
];
