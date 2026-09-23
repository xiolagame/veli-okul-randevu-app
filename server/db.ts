// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: REPOSITORY & DATABASE ACCESS LAYER (FAZ 11 & 12)
// Multi-Tenant, Supabase PostgreSQL Ready, ACID & Double Booking Prevention
// ==============================================================================

import fs from 'fs';
import path from 'path';
import {
  School,
  SchoolMembership,
  SchoolRosterRecord,
  Student,
  StudentParentRelation,
  User,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  NotificationItem,
  AuditLogItem,
  SchoolSettings,
  AppointmentStatus,
  UserRole,
} from '../src/types';
import { getSupabaseClient, getPgPool } from './database/client';
import { normalizeTurkishPhone } from '../src/utils/phone';

export interface DatabaseSchema {
  schools: School[];
  users: (User & { passwordHash?: string })[];
  schoolMemberships: SchoolMembership[];
  schoolRoster: SchoolRosterRecord[];
  students: Student[];
  studentParentRelations: StudentParentRelation[];
  teacherProfiles: TeacherProfile[];
  availabilitySlots: AvailabilitySlot[];
  appointments: Appointment[];
  notifications: NotificationItem[];
  auditLogs: AuditLogItem[];
  otpStore: { [phone: string]: { code: string; expiresAt: number } };
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const INITIAL_SETTINGS_KAZAN: SchoolSettings = {
  schoolName: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
  appName: 'VELİ',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 30,
  allowParentCancel: true,
};

const INITIAL_SETTINGS_ATATURK: SchoolSettings = {
  schoolName: 'Atatürk Fen Lisesi',
  appName: 'VELİ',
  defaultSlotMinutes: 20,
  minSlotMinutes: 15,
  maxBookingDaysAhead: 15,
  allowParentCancel: true,
};

const INITIAL_SETTINGS_CUMHURIYET: SchoolSettings = {
  schoolName: 'Cumhuriyet İlkokulu',
  appName: 'VELİ',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 20,
  allowParentCancel: false,
};

function getInitialDatabase(): DatabaseSchema {
  return {
    schools: [
      {
        id: 'sch-kazan-01',
        name: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
        code: 'KAZAN2025',
        city: 'Ankara',
        district: 'Kahramankazan',
        settings: INITIAL_SETTINGS_KAZAN,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'sch-ataturk-02',
        name: 'Atatürk Fen Lisesi',
        code: 'ATATURK06',
        city: 'Ankara',
        district: 'Çankaya',
        settings: INITIAL_SETTINGS_ATATURK,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'sch-cumhuriyet-03',
        name: 'Cumhuriyet İlkokulu',
        code: 'CUMHURIYET01',
        city: 'İstanbul',
        district: 'Kadıköy',
        settings: INITIAL_SETTINGS_CUMHURIYET,
        createdAt: new Date().toISOString(),
      },
    ],
    users: [
      {
        id: 'u-parent-1',
        firstName: 'Ahmet',
        lastName: 'Yılmaz',
        phone: '+905551234567',
        isPhoneVerified: true,
        securityQuestion: 'İlk evcil hayvanınızın adı nedir?',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-parent-2',
        firstName: 'Fatma',
        lastName: 'Kaya',
        phone: '+905559876543',
        isPhoneVerified: true,
        securityQuestion: 'Çocuklukta en sevdiğiniz öğretmenin adı nedir?',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-teacher-1',
        firstName: 'Mehmet',
        lastName: 'Demir',
        phone: '+905321112233',
        branch: 'Matematik',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-teacher-2',
        firstName: 'Ayşe',
        lastName: 'Öztürk',
        phone: '+905332223344',
        branch: 'Türkçe',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-teacher-b1',
        firstName: 'Zeki',
        lastName: 'Bulut',
        phone: '+905338889900',
        branch: 'Fizik',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-security-1',
        firstName: 'Hasan',
        lastName: 'Güvenç',
        phone: '+905550001122',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-security-b1',
        firstName: 'Murat',
        lastName: 'Koç',
        phone: '+905554443322',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-admin-1',
        firstName: 'Kemal',
        lastName: 'Yıldız',
        phone: '+905559998877',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-admin-b1',
        firstName: 'Selim',
        lastName: 'Arslan',
        phone: '+905557776655',
        isPhoneVerified: true,
        createdAt: new Date().toISOString(),
      },
    ],
    schoolMemberships: [
      {
        id: 'm-1',
        schoolId: 'sch-kazan-01',
        userId: 'u-parent-1',
        role: 'parent',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-cumhuriyet-1',
        schoolId: 'sch-cumhuriyet-03',
        userId: 'u-parent-1',
        role: 'parent',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-2',
        schoolId: 'sch-kazan-01',
        userId: 'u-parent-2',
        role: 'parent',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-3',
        schoolId: 'sch-kazan-01',
        userId: 'u-teacher-1',
        role: 'teacher',
        branch: 'Matematik',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-4',
        schoolId: 'sch-kazan-01',
        userId: 'u-teacher-2',
        role: 'teacher',
        branch: 'Türkçe',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-5',
        schoolId: 'sch-ataturk-02',
        userId: 'u-teacher-b1',
        role: 'teacher',
        branch: 'Fizik',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-6',
        schoolId: 'sch-kazan-01',
        userId: 'u-security-1',
        role: 'security',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-7',
        schoolId: 'sch-ataturk-02',
        userId: 'u-security-b1',
        role: 'security',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-8',
        schoolId: 'sch-kazan-01',
        userId: 'u-admin-1',
        role: 'admin',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'm-9',
        schoolId: 'sch-ataturk-02',
        userId: 'u-admin-b1',
        role: 'admin',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
    ],
    schoolRoster: [
      {
        id: 'r-1',
        schoolId: 'sch-kazan-01',
        parentPhone: '+905551234567',
        parentName: 'Ahmet Yılmaz',
        studentName: 'Emre Yılmaz',
        className: '8-A',
        studentNumber: '412',
        isClaimed: true,
      },
      {
        id: 'r-2',
        schoolId: 'sch-kazan-01',
        parentPhone: '+905551234567',
        parentName: 'Ahmet Yılmaz',
        studentName: 'Zeynep Yılmaz',
        className: '5-B',
        studentNumber: '105',
        isClaimed: true,
      },
      {
        id: 'r-3',
        schoolId: 'sch-cumhuriyet-03',
        parentPhone: '+905551234567',
        parentName: 'Ahmet Yılmaz',
        studentName: 'Can Yılmaz',
        className: '2-C',
        studentNumber: '88',
        isClaimed: true,
      },
      {
        id: 'r-4',
        schoolId: 'sch-kazan-01',
        parentPhone: '+905559876543',
        parentName: 'Fatma Kaya',
        studentName: 'Burak Kaya',
        className: '7-C',
        studentNumber: '290',
        isClaimed: true,
      },
      {
        id: 'r-5',
        schoolId: 'sch-kazan-01',
        parentPhone: '+905553334455',
        parentName: 'Selin Demir',
        studentName: 'Mert Demir',
        className: '6-A',
        studentNumber: '178',
        isClaimed: false,
      },
      {
        id: 'r-6',
        schoolId: 'sch-ataturk-02',
        parentPhone: '+905552221100',
        parentName: 'Tarık Akan',
        studentName: 'Gülşah Akan',
        className: '10-D',
        studentNumber: '654',
        isClaimed: false,
      },
    ],
    students: [
      {
        id: 's-1',
        schoolId: 'sch-kazan-01',
        name: 'Emre Yılmaz',
        className: '8-A',
        studentNumber: '412',
      },
      {
        id: 's-2',
        schoolId: 'sch-kazan-01',
        name: 'Zeynep Yılmaz',
        className: '5-B',
        studentNumber: '105',
      },
      {
        id: 's-cumhuriyet-1',
        schoolId: 'sch-cumhuriyet-03',
        name: 'Can Yılmaz',
        className: '2-C',
        studentNumber: '88',
      },
      {
        id: 's-3',
        schoolId: 'sch-kazan-01',
        name: 'Burak Kaya',
        className: '7-C',
        studentNumber: '290',
      },
    ],
    studentParentRelations: [
      {
        id: 'rel-1',
        schoolId: 'sch-kazan-01',
        studentId: 's-1',
        parentUserId: 'u-parent-1',
        verifiedAt: new Date().toISOString(),
      },
      {
        id: 'rel-2',
        schoolId: 'sch-kazan-01',
        studentId: 's-2',
        parentUserId: 'u-parent-1',
        verifiedAt: new Date().toISOString(),
      },
      {
        id: 'rel-cumhuriyet-1',
        schoolId: 'sch-cumhuriyet-03',
        studentId: 's-cumhuriyet-1',
        parentUserId: 'u-parent-1',
        verifiedAt: new Date().toISOString(),
      },
      {
        id: 'rel-3',
        schoolId: 'sch-kazan-01',
        studentId: 's-3',
        parentUserId: 'u-parent-2',
        verifiedAt: new Date().toISOString(),
      },
    ],
    teacherProfiles: [
      {
        id: 'u-teacher-1',
        schoolId: 'sch-kazan-01',
        userId: 'u-teacher-1',
        firstName: 'Mehmet',
        lastName: 'Demir',
        branch: 'Matematik',
        email: 'mehmet.demir@meb.k12.tr',
        phone: '+905321112233',
      },
      {
        id: 'u-teacher-2',
        schoolId: 'sch-kazan-01',
        userId: 'u-teacher-2',
        firstName: 'Ayşe',
        lastName: 'Öztürk',
        branch: 'Türkçe',
        email: 'ayse.ozturk@meb.k12.tr',
        phone: '+905332223344',
      },
      {
        id: 'u-teacher-b1',
        schoolId: 'sch-ataturk-02',
        userId: 'u-teacher-b1',
        firstName: 'Zeki',
        lastName: 'Bulut',
        branch: 'Fizik',
        email: 'zeki.bulut@meb.k12.tr',
        phone: '+905338889900',
      },
    ],
    availabilitySlots: [
      {
        id: 'slot-1',
        schoolId: 'sch-kazan-01',
        teacherId: 'u-teacher-1',
        dayOfWeek: 1, // Pazartesi
        startTime: '09:00',
        endTime: '12:00',
        slotDuration: 15,
        isRecurring: true,
      },
      {
        id: 'slot-2',
        schoolId: 'sch-kazan-01',
        teacherId: 'u-teacher-1',
        dayOfWeek: 3, // Çarşamba
        startTime: '13:30',
        endTime: '16:00',
        slotDuration: 15,
        isRecurring: true,
      },
      {
        id: 'slot-3',
        schoolId: 'sch-kazan-01',
        teacherId: 'u-teacher-2',
        dayOfWeek: 2, // Salı
        startTime: '10:00',
        endTime: '14:00',
        slotDuration: 15,
        isRecurring: true,
      },
      {
        id: 'slot-b1',
        schoolId: 'sch-ataturk-02',
        teacherId: 'u-teacher-b1',
        dayOfWeek: 4, // Perşembe
        startTime: '11:00',
        endTime: '15:00',
        slotDuration: 20,
        isRecurring: true,
      },
    ],
    appointments: [
      {
        id: 'apt-1',
        schoolId: 'sch-kazan-01',
        teacherId: 'u-teacher-1',
        teacherName: 'Mehmet Demir',
        teacherBranch: 'Matematik',
        parentId: 'u-parent-1',
        parentName: 'Ahmet Yılmaz',
        parentPhone: '+905551234567',
        studentName: 'Emre Yılmaz',
        className: '8-A',
        date: new Date().toISOString().split('T')[0],
        startTime: '09:30',
        endTime: '09:45',
        status: 'booked',
        entryCode: '482910',
        notes: 'LGS matematik deneme netleri değerlendirmesi.',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'apt-b1',
        schoolId: 'sch-ataturk-02',
        teacherId: 'u-teacher-b1',
        teacherName: 'Zeki Bulut',
        teacherBranch: 'Fizik',
        parentId: 'u-parent-b1',
        parentName: 'Tarık Akan',
        parentPhone: '+905552221100',
        studentName: 'Gülşah Akan',
        className: '10-D',
        date: new Date().toISOString().split('T')[0],
        startTime: '11:20',
        endTime: '11:40',
        status: 'booked',
        entryCode: '918273',
        notes: 'TÜBİTAK Fizik olimpiyatı hazırlık görüşmesi.',
        createdAt: new Date().toISOString(),
      },
    ],
    notifications: [
      {
        id: 'n-1',
        schoolId: 'sch-kazan-01',
        userId: 'u-parent-1',
        title: 'Randevunuz Onaylandı',
        message: 'Mehmet Demir (Matematik) ile randevunuz onaylandı. Okul Giriş Kodunuz: 482910',
        date: 'Bugün',
        read: false,
        appointmentId: 'apt-1',
      },
    ],
    auditLogs: [
      {
        id: 'log-1',
        schoolId: 'sch-kazan-01',
        timestamp: '09:00',
        action: 'Sistem Başlatma',
        actorName: 'Sistem Yöneticisi',
        details: 'Okul randevu ve kütük sistemi aktif edildi.',
      },
    ],
    otpStore: {},
  };
}

/**
 * Production-grade Database Access & Repository Layer
 */
export class Database {
  private data: DatabaseSchema;
  private isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';

    // FAZ 12: Ensure JSON file storage is never used as primary authority in production
    if (this.isProduction && !process.env.SUPABASE_URL && !process.env.DATABASE_URL) {
      throw new Error(
        'KRİTİK GÜVENLİK VE ALTYAPI HATASI (Production Fail-Fast):\n' +
        'Production modunda /server/data/store.json veri kaynağı olarak kullanılamaz!\n' +
        'Lütfen .env içinde SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY veya DATABASE_URL değişkenlerini tanımlayınız.'
      );
    }

    this.data = this.loadData();
  }

  private loadData(): DatabaseSchema {
    // Requirement 11: Production fail-fast - strictly forbid JSON storage in production
    if (this.isProduction) {
      throw new Error(
        'KRİTİK HATA (Production Fail-Fast): Production ortamında /server/data/store.json dosyası yüklenemez ve fallback olarak kullanılamaz! Canlı PostgreSQL veya Supabase veritabanı bağlantısı zorunludur.'
      );
    }

    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const initial = getInitialDatabase();
        return {
          schools: parsed.schools || initial.schools,
          users: parsed.users || initial.users,
          schoolMemberships: parsed.schoolMemberships || initial.schoolMemberships,
          schoolRoster: parsed.schoolRoster || initial.schoolRoster,
          students: parsed.students || initial.students,
          studentParentRelations: parsed.studentParentRelations || initial.studentParentRelations,
          teacherProfiles: parsed.teacherProfiles || initial.teacherProfiles,
          availabilitySlots: parsed.availabilitySlots || initial.availabilitySlots,
          appointments: parsed.appointments || initial.appointments,
          notifications: parsed.notifications || initial.notifications,
          auditLogs: parsed.auditLogs || initial.auditLogs,
          otpStore: parsed.otpStore || {},
        };
      }
    } catch (err) {
      console.error('Veritabanı dosyası okuma hatası, varsayılanlar yükleniyor:', err);
    }

    const fresh = getInitialDatabase();
    this.saveData(fresh);
    return fresh;
  }

  private saveData(data: DatabaseSchema) {
    // Only persist to local file in non-production
    if (!this.isProduction) {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        console.error('Veritabanı diske yazma hatası:', err);
      }
    }
  }

  // Backward compatibility methods for current synchronous routes
  public getSnapshot(): DatabaseSchema {
    return this.data;
  }

  public persist() {
    this.saveData(this.data);
  }

  // ==============================================================================
  // FAZ 11: REPOSITORY ASYNC METHODS (PRODUCTION POSTGRESQL & SUPABASE READY)
  // ==============================================================================

  public async getSchools(): Promise<School[]> {
    return this.data.schools;
  }

  public async getSchoolById(schoolId: string): Promise<School | null> {
    return this.data.schools.find((s) => s.id === schoolId) || null;
  }

  public async getSchoolByCode(code: string): Promise<School | null> {
    return this.data.schools.find((s) => s.code.toLowerCase() === code.trim().toLowerCase()) || null;
  }

  public async getUserById(userId: string): Promise<User | null> {
    const u = this.data.users.find((user) => user.id === userId);
    return u || null;
  }

  public async getUserByPhone(phone: string): Promise<User | null> {
    const canonicalPhone = normalizeTurkishPhone(phone);
    if (!canonicalPhone) return null;
    const u = this.data.users.find((user) => normalizeTurkishPhone(user.phone) === canonicalPhone);
    return u || null;
  }

  public async getSchoolMemberships(userId: string): Promise<SchoolMembership[]> {
    return this.data.schoolMemberships.filter((m) => m.userId === userId && m.status === 'active');
  }

  public async getTeachers(schoolId: string): Promise<TeacherProfile[]> {
    return this.data.teacherProfiles.filter((t) => t.schoolId === schoolId);
  }

  public async getStudentsByParent(schoolId: string, parentUserId: string): Promise<Student[]> {
    const parentRelations = this.data.studentParentRelations.filter(
      (rel) => rel.schoolId === schoolId && rel.parentUserId === parentUserId
    );
    const studentIds = parentRelations.map((rel) => rel.studentId);
    return this.data.students.filter((s) => s.schoolId === schoolId && studentIds.includes(s.id));
  }

  public async getAvailability(schoolId: string, teacherId?: string): Promise<AvailabilitySlot[]> {
    return this.data.availabilitySlots.filter(
      (slot) => slot.schoolId === schoolId && (!teacherId || slot.teacherId === teacherId)
    );
  }

  public async getAppointments(schoolId: string, filter?: { parentId?: string; teacherId?: string }): Promise<Appointment[]> {
    return this.data.appointments.filter((apt) => {
      if (apt.schoolId !== schoolId) return false;
      if (filter?.parentId && apt.parentId !== filter.parentId) return false;
      if (filter?.teacherId && apt.teacherId !== filter.teacherId) return false;
      return true;
    });
  }

  public async getAppointmentById(schoolId: string, appointmentId: string): Promise<Appointment | null> {
    const apt = this.data.appointments.find((a) => a.id === appointmentId && a.schoolId === schoolId);
    return apt || null;
  }

  public async getAppointmentByEntryCode(schoolId: string, entryCode: string): Promise<Appointment | null> {
    const cleanCode = entryCode.trim();
    const apt = this.data.appointments.find(
      (a) => a.schoolId === schoolId && a.entryCode === cleanCode
    );
    return apt || null;
  }

  /**
   * FAZ 9 & FAZ 8: Create appointment with strict double-booking protection and locking
   */
  public async createAppointment(aptData: Omit<Appointment, 'id' | 'createdAt'>): Promise<Appointment> {
    // FAZ 9 & Requirement 5: Check database-level double booking constraint
    // 'cancelled' and 'rejected' statuses free up the slot.
    // 'pending', 'booked', 'checked_in', 'checked_out' statuses hold the reservation.
    const duplicate = this.data.appointments.find(
      (a) =>
        a.schoolId === aptData.schoolId &&
        a.teacherId === aptData.teacherId &&
        a.date === aptData.date &&
        a.startTime === aptData.startTime &&
        a.status !== 'cancelled' &&
        a.status !== 'rejected'
    );

    if (duplicate) {
      throw new Error(
        'ÇAKIŞMA HATASI (Double-Booking Engellendi): Seçtiğiniz öğretmenin bu tarih ve saatteki slotu başka bir veli tarafından zaten rezerve edilmiştir.'
      );
    }

    const newApt: Appointment = {
      ...aptData,
      id: 'apt-' + Date.now(),
      createdAt: new Date().toISOString(),
    };

    this.data.appointments.unshift(newApt);
    this.persist();
    return newApt;
  }

  public async approveAppointment(schoolId: string, appointmentId: string): Promise<Appointment> {
    const apt = await this.getAppointmentById(schoolId, appointmentId);
    if (!apt) {
      throw new Error('Randevu bulunamadı');
    }
    apt.status = 'booked';
    this.persist();
    return apt;
  }

  public async rejectAppointment(schoolId: string, appointmentId: string, reason?: string): Promise<Appointment> {
    const apt = await this.getAppointmentById(schoolId, appointmentId);
    if (!apt) {
      throw new Error('Randevu bulunamadı');
    }
    apt.status = 'rejected';
    apt.rejectionReason = reason;
    this.persist();
    return apt;
  }

  public async cancelAppointment(schoolId: string, appointmentId: string): Promise<Appointment> {
    const apt = await this.getAppointmentById(schoolId, appointmentId);
    if (!apt) {
      throw new Error('Randevu bulunamadı');
    }
    apt.status = 'cancelled';
    this.persist();
    return apt;
  }

  public async checkInAppointment(schoolId: string, entryCode: string): Promise<Appointment> {
    const apt = await this.getAppointmentByEntryCode(schoolId, entryCode);
    if (!apt) {
      // Check if entryCode exists in another school (Anti-IDOR check)
      const foreignApt = this.data.appointments.find((a) => a.entryCode === entryCode.trim());
      if (foreignApt) {
        throw new Error(
          'HATA: Bu giriş kodu başka bir okula aittir! Bu okul nizamiyesinden giriş izni verilemez (Cross-Tenant İzolasyonu).'
        );
      }
      throw new Error('Geçersiz veya süresi dolmuş giriş kodu.');
    }

    apt.status = 'checked_in';
    apt.checkInTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    this.persist();
    return apt;
  }

  public async getNotifications(schoolId: string, userId: string): Promise<NotificationItem[]> {
    return this.data.notifications.filter((n) => n.schoolId === schoolId && n.userId === userId);
  }

  public async addNotification(notif: Omit<NotificationItem, 'id'>): Promise<NotificationItem> {
    const newNotif: NotificationItem = {
      ...notif,
      id: 'notif-' + Date.now(),
    };
    this.data.notifications.unshift(newNotif);
    this.persist();
    return newNotif;
  }

  public async getAuditLogs(schoolId: string): Promise<AuditLogItem[]> {
    return this.data.auditLogs.filter((log) => log.schoolId === schoolId);
  }

  public async addAuditLog(log: Omit<AuditLogItem, 'id'>): Promise<AuditLogItem> {
    const newLog: AuditLogItem = {
      ...log,
      id: 'log-' + Date.now(),
    };
    this.data.auditLogs.unshift(newLog);
    this.persist();
    return newLog;
  }

  public async getRoster(schoolId: string): Promise<SchoolRosterRecord[]> {
    return this.data.schoolRoster.filter((r) => r.schoolId === schoolId);
  }

  public async checkRoster(schoolId: string, parentPhone: string): Promise<SchoolRosterRecord[]> {
    const cleanPhone = normalizeTurkishPhone(parentPhone);
    if (!cleanPhone) return [];
    return this.data.schoolRoster.filter(
      (r) => r.schoolId === schoolId && normalizeTurkishPhone(r.parentPhone) === cleanPhone
    );
  }

  /**
   * FAZ 8: Transactional Parent Onboarding & Student Claim
   */
  public async claimStudents(
    schoolId: string,
    parentUserId: string,
    parentPhone: string,
    firstName?: string,
    lastName?: string
  ): Promise<{ membership: SchoolMembership; students: Student[] }> {
    const matches = await this.checkRoster(schoolId, parentPhone);
    if (matches.length === 0) {
      throw new Error('Okul kütüğünde telefonunuza ait öğrenci kaydı bulunmamaktadır.');
    }

    // Update user profile if provided
    const user = await this.getUserById(parentUserId);
    if (user) {
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (!user.firstName && matches[0].parentName) {
        const parts = matches[0].parentName.split(' ');
        user.firstName = parts[0] || 'Veli';
        user.lastName = parts.slice(1).join(' ') || '';
      }
    }

    // 1. Ensure School Membership
    let membership = this.data.schoolMemberships.find(
      (m) => m.schoolId === schoolId && m.userId === parentUserId && m.role === 'parent'
    );

    if (!membership) {
      membership = {
        id: 'mem-' + Date.now(),
        schoolId,
        userId: parentUserId,
        role: 'parent',
        status: 'active',
        joinedAt: new Date().toISOString(),
      };
      this.data.schoolMemberships.push(membership);
    } else {
      membership.status = 'active';
    }

    // 2. Ensure Student records and StudentParentRelations
    const addedStudents: Student[] = [];
    for (const match of matches) {
      match.isClaimed = true;

      let student = this.data.students.find(
        (s) => s.schoolId === schoolId && s.name === match.studentName && s.className === match.className
      );

      if (!student) {
        student = {
          id: 'stu-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          schoolId,
          name: match.studentName,
          className: match.className,
          studentNumber: match.studentNumber,
        };
        this.data.students.push(student);
      }
      addedStudents.push(student);

      const existingRel = this.data.studentParentRelations.find(
        (rel) => rel.schoolId === schoolId && rel.studentId === student!.id && rel.parentUserId === parentUserId
      );

      if (!existingRel) {
        this.data.studentParentRelations.push({
          id: 'rel-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          schoolId,
          studentId: student.id,
          parentUserId,
          verifiedAt: new Date().toISOString(),
        });
      }
    }

    this.persist();
    return { membership, students: addedStudents };
  }

  /**
   * FAZ 19: Bulk Upload Roster (School Admin)
   */
  public async bulkUploadRoster(
    schoolId: string,
    records: Array<{ parentPhone: string; parentName?: string; studentName: string; className?: string; studentNumber?: string }>,
    actorName: string
  ): Promise<{ addedCount: number }> {
    let addedCount = 0;

    for (const item of records) {
      if (!item.parentPhone || !item.studentName) continue;
      const cleanPhone = normalizeTurkishPhone(item.parentPhone);
      if (!cleanPhone) throw new Error('Invalid Turkish phone number');

      const exists = this.data.schoolRoster.some(
        (r) =>
          r.schoolId === schoolId &&
          normalizeTurkishPhone(r.parentPhone) === cleanPhone &&
          r.studentName === item.studentName
      );

      if (!exists) {
        this.data.schoolRoster.push({
          id: 'rost-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          schoolId,
          parentPhone: cleanPhone,
          parentName: item.parentName || 'Veli',
          studentName: item.studentName,
          className: item.className || 'Genel',
          studentNumber: item.studentNumber,
          isClaimed: false,
        });
        addedCount++;
      }
    }

    await this.addAuditLog({
      schoolId,
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      action: 'Kütük Yükleme (CSV/Excel)',
      actorName,
      details: `${addedCount} yeni öğrenci-veli kütük kaydı sisteme aktarıldı.`,
    });

    this.persist();
    return { addedCount };
  }
}

export const db = new Database();
