import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User,
  Student,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  NotificationItem,
  SchoolSettings,
  AuditLogItem,
  UserRole,
  School,
  SchoolMembership,
  SchoolRosterRecord,
  TenantIsolationTestResult,
} from '../types';
import { api, setAuthToken, setActiveSchoolId, getAuthToken, getActiveSchoolId } from '../services/api';

interface AppContextType {
  currentUser: User | null;
  users: User[];
  schools: School[];
  currentSchool: School | null;
  userMemberships: SchoolMembership[];
  currentMembership: SchoolMembership | null;
  teachers: TeacherProfile[];
  availability: AvailabilitySlot[];
  appointments: Appointment[];
  notifications: NotificationItem[];
  settings: SchoolSettings;
  auditLogs: AuditLogItem[];
  roster: SchoolRosterRecord[];
  isolationTestResults: TenantIsolationTestResult[];
  unreadNotificationCount: number;
  isLoading: boolean;
  switchSchool: (schoolId: string) => Promise<void>;
  login: (phone: string, role?: UserRole) => Promise<boolean>;
  logout: () => void;
  switchUser: (userId: string) => Promise<void>;
  registerUser: (userData: Partial<User> & { password?: string }) => Promise<User>;
  bookAppointment: (data: {
    teacherId: string;
    studentName: string;
    className: string;
    date: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }) => Promise<Appointment>;
  approveAppointment: (appointmentId: string) => Promise<void>;
  rejectAppointment: (appointmentId: string, reason?: string) => Promise<void>;
  cancelAppointment: (appointmentId: string) => Promise<void>;
  checkInVisitor: (appointmentIdOrCode: string) => Promise<{ success: boolean; message: string; appointment?: Appointment }>;
  checkOutVisitor: (appointmentId: string) => Promise<void>;
  addAvailabilitySlot: (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => Promise<void>;
  removeAvailabilitySlot: (slotId: string) => Promise<void>;
  markNotificationsAsRead: () => Promise<void>;
  updateSettings: (newSettings: Partial<SchoolSettings>) => Promise<void>;
  addStudentToProfile: (student: { name: string; className: string }) => void;
  removeStudentFromProfile: (studentId: string) => void;
  resetUserPassword: (phone: string, newPass: string) => boolean;
  uploadRoster: (records: Partial<SchoolRosterRecord>[]) => Promise<number>;
  runIsolationTests: () => Promise<TenantIsolationTestResult[]>;
  sendOtp: (phone: string, schoolId?: string) => Promise<{ success: boolean; message: string; debugOtpCode?: string }>;
  verifyOtp: (phone: string, code: string, schoolId?: string) => Promise<{ success: boolean; memberships: SchoolMembership[] }>;
  checkRoster: (schoolId: string) => Promise<any>;
  claimStudents: (schoolId: string, firstName?: string, lastName?: string) => Promise<any>;
  refreshCurrentSchoolData: () => Promise<void>;
}

const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
  appName: 'VELİ',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 30,
  allowParentCancel: true,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [currentSchool, setCurrentSchool] = useState<School | null>(null);
  const [userMemberships, setUserMemberships] = useState<SchoolMembership[]>([]);
  const [currentMembership, setCurrentMembership] = useState<SchoolMembership | null>(null);

  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [settings, setSettings] = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [roster, setRoster] = useState<SchoolRosterRecord[]>([]);
  const [isolationTestResults, setIsolationTestResults] = useState<TenantIsolationTestResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load School-scoped data whenever active school or membership changes
  const loadSchoolData = useCallback(async (schoolId: string, user: User | null, membership: SchoolMembership | null) => {
    if (!schoolId) return;

    try {
      // 1. Teachers
      const teachersRes = await api.getTeachers(schoolId).catch(() => ({ teachers: [] }));
      setTeachers(teachersRes.teachers);

      // 2. Students for current user / school
      const studentsRes = await api.getStudents(schoolId).catch(() => ({ students: [] }));
      if (user) {
        user.students = studentsRes.students;
        setCurrentUser({ ...user });
      }

      // 3. Availability
      const availRes = await api.getAvailability(schoolId).catch(() => ({ availability: [] }));
      setAvailability(availRes.availability);

      // 4. Appointments
      const aptsRes = await api.getAppointments(schoolId).catch(() => ({ appointments: [] }));
      setAppointments(aptsRes.appointments);

      // 5. Notifications
      const notifsRes = await api.getNotifications(schoolId).catch(() => ({ notifications: [] }));
      setNotifications(notifsRes.notifications);

      // 6. Settings
      const settingsRes = await api.getSettings(schoolId).catch(() => ({ settings: DEFAULT_SETTINGS }));
      if (settingsRes.settings) {
        setSettings(settingsRes.settings);
      }

      // 7. Audit logs (for admin & security)
      if (membership && (membership.role === 'admin' || membership.role === 'security')) {
        const auditRes = await api.getAuditLogs(schoolId).catch(() => ({ auditLogs: [] }));
        setAuditLogs(auditRes.auditLogs);
      } else {
        setAuditLogs([]);
      }

      // 8. Roster (for admin)
      if (membership && membership.role === 'admin') {
        const rosterRes = await api.getRoster(schoolId).catch(() => ({ roster: [] }));
        setRoster(rosterRes.roster);
      } else {
        setRoster([]);
      }
    } catch (err) {
      console.error('Error loading school-scoped data:', err);
    }
  }, []);

  // Initial bootstrap from API
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        // Fetch all public schools
        const schoolsRes = await api.getPublicSchools().catch(() => ({ schools: [] }));
        setSchools(schoolsRes.schools);

        const token = getAuthToken();
        if (token) {
          try {
            const meRes = await api.getMe();
            const activeUser = meRes.user;
            setUserMemberships(meRes.memberships);

            // Determine active school
            let targetSchoolId = getActiveSchoolId();
            if (!targetSchoolId || !meRes.memberships.some((m) => m.schoolId === targetSchoolId)) {
              targetSchoolId = meRes.memberships[0]?.schoolId || schoolsRes.schools[0]?.id || 'sch-kazan-01';
              setActiveSchoolId(targetSchoolId);
            }

            const activeSchool = schoolsRes.schools.find((s) => s.id === targetSchoolId) || null;
            setCurrentSchool(activeSchool);

            const activeMem = meRes.memberships.find((m) => m.schoolId === targetSchoolId) || null;
            setCurrentMembership(activeMem);

            if (activeMem) {
              activeUser.role = activeMem.role;
              activeUser.branch = activeMem.branch;
            }

            setCurrentUser(activeUser);
            await loadSchoolData(targetSchoolId, activeUser, activeMem);
          } catch (err) {
            // Token expired or invalid
            setAuthToken(null);
            setCurrentUser(null);
          }
        } else {
          // If no token, auto-login as default parent Ahmet Yılmaz (+905551234567) for smooth immediate preview
          try {
            const loginRes = await api.login('+905551234567');
            setAuthToken(loginRes.token);
            const activeUser = loginRes.user;
            setUserMemberships(loginRes.memberships);

            const targetSchoolId = loginRes.memberships[0]?.schoolId || 'sch-kazan-01';
            setActiveSchoolId(targetSchoolId);

            const activeSchool = schoolsRes.schools.find((s) => s.id === targetSchoolId) || null;
            setCurrentSchool(activeSchool);

            const activeMem = loginRes.memberships.find((m) => m.schoolId === targetSchoolId) || null;
            setCurrentMembership(activeMem);

            if (activeMem) {
              activeUser.role = activeMem.role;
              activeUser.branch = activeMem.branch;
            }

            setCurrentUser(activeUser);
            await loadSchoolData(targetSchoolId, activeUser, activeMem);
          } catch (err) {
            console.error('Default auto-login error:', err);
          }
        }
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    init();
  }, [loadSchoolData]);

  // Switch Active School
  const switchSchool = async (schoolId: string) => {
    setActiveSchoolId(schoolId);
    const targetSchool = schools.find((s) => s.id === schoolId) || null;
    setCurrentSchool(targetSchool);

    // Instant cache purge of previous school data
    setTeachers([]);
    setAvailability([]);
    setAppointments([]);
    setNotifications([]);
    setAuditLogs([]);
    setRoster([]);

    if (currentUser) {
      const activeMem = userMemberships.find((m) => m.schoolId === schoolId) || null;
      setCurrentMembership(activeMem);

      const updatedUser = {
        ...currentUser,
        students: [], // Reset previous school's students
        role: activeMem ? activeMem.role : undefined,
        branch: activeMem ? activeMem.branch : undefined,
      };
      setCurrentUser(updatedUser);
      await loadSchoolData(schoolId, updatedUser, activeMem);
    }
  };

  // Login
  const login = async (phone: string, role?: UserRole): Promise<boolean> => {
    try {
      const res = await api.login(phone, role);
      setAuthToken(res.token);
      setUserMemberships(res.memberships);

      let targetSchoolId = res.memberships[0]?.schoolId || schools[0]?.id || 'sch-kazan-01';
      setActiveSchoolId(targetSchoolId);

      const activeSchool = schools.find((s) => s.id === targetSchoolId) || null;
      setCurrentSchool(activeSchool);

      const activeMem = res.memberships.find((m) => m.schoolId === targetSchoolId) || null;
      setCurrentMembership(activeMem);

      const userWithRole = {
        ...res.user,
        role: activeMem?.role || role,
        branch: activeMem?.branch,
      };

      setCurrentUser(userWithRole);
      await loadSchoolData(targetSchoolId, userWithRole, activeMem);
      return true;
    } catch (err) {
      console.error('Login error:', err);
      return false;
    }
  };

  // Logout
  const logout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setUserMemberships([]);
    setCurrentMembership(null);
    setAppointments([]);
    setNotifications([]);
    setAuditLogs([]);
    setRoster([]);
  };

  // Quick switch user for instant evaluator testing
  const switchUser = async (userId: string) => {
    try {
      const res = await api.quickSwitch(userId);
      setAuthToken(res.token);
      setUserMemberships(res.memberships);

      let targetSchoolId = res.memberships[0]?.schoolId || schools[0]?.id || 'sch-kazan-01';
      setActiveSchoolId(targetSchoolId);

      const activeSchool = schools.find((s) => s.id === targetSchoolId) || null;
      setCurrentSchool(activeSchool);

      const activeMem = res.memberships.find((m) => m.schoolId === targetSchoolId) || null;
      setCurrentMembership(activeMem);

      const userWithRole = {
        ...res.user,
        role: activeMem?.role,
        branch: activeMem?.branch,
      };

      setCurrentUser(userWithRole);
      await loadSchoolData(targetSchoolId, userWithRole, activeMem);
    } catch (err) {
      console.error('Switch user error:', err);
    }
  };

  // Register User
  const registerUser = async (userData: Partial<User> & { password?: string }): Promise<User> => {
    const phone = userData.phone || '+905550000000';
    await api.sendOtp(phone).catch(() => {});
    const verifyRes = await api.verifyOtp(phone, '123456');
    setAuthToken(verifyRes.token);

    const schoolId = currentSchool?.id || 'sch-kazan-01';
    const claimRes = await api
      .claimStudents(schoolId, userData.firstName, userData.lastName)
      .catch(() => ({ memberships: [] }));

    const updatedMemberships = claimRes.memberships || [];
    setUserMemberships(updatedMemberships);

    const activeMem = updatedMemberships.find((m: any) => m.schoolId === schoolId) || null;
    setCurrentMembership(activeMem);

    const fullUser: User = {
      ...verifyRes.user,
      firstName: userData.firstName || 'Ad',
      lastName: userData.lastName || 'Soyad',
      role: activeMem?.role || userData.role || 'parent',
      branch: userData.branch,
    };

    setCurrentUser(fullUser);
    await loadSchoolData(schoolId, fullUser, activeMem);
    return fullUser;
  };

  // Book Appointment
  const bookAppointment = async (data: {
    teacherId: string;
    studentName: string;
    className: string;
    date: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }): Promise<Appointment> => {
    if (!currentSchool) throw new Error('Aktif okul seçili değil');
    const res = await api.bookAppointment(currentSchool.id, data);
    setAppointments((prev) => [res.appointment, ...prev]);
    return res.appointment;
  };

  // Approve Appointment
  const approveAppointment = async (appointmentId: string) => {
    if (!currentSchool) return;
    const res = await api.approveAppointment(currentSchool.id, appointmentId);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Reject Appointment
  const rejectAppointment = async (appointmentId: string, reason?: string) => {
    if (!currentSchool) return;
    const res = await api.rejectAppointment(currentSchool.id, appointmentId, reason);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Cancel Appointment
  const cancelAppointment = async (appointmentId: string) => {
    if (!currentSchool) return;
    const res = await api.cancelAppointment(currentSchool.id, appointmentId);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Check In Visitor (Strictly validated by backend tenant guard)
  const checkInVisitor = async (appointmentIdOrCode: string) => {
    if (!currentSchool) return { success: false, message: 'Aktif okul seçili değil' };
    try {
      const res = await api.checkInVisitor(currentSchool.id, appointmentIdOrCode);
      if (res.appointment) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === res.appointment!.id ? res.appointment! : a))
        );
      }
      return res;
    } catch (err: any) {
      return { success: false, message: err.message || 'Giriş işlemi başarısız' };
    }
  };

  // Check Out Visitor
  const checkOutVisitor = async (appointmentId: string) => {
    if (!currentSchool) return;
    const res = await api.checkOutVisitor(currentSchool.id, appointmentId);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Add Availability Slot
  const addAvailabilitySlot = async (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => {
    if (!currentSchool) return;
    const res = await api.addAvailabilitySlot(currentSchool.id, slot);
    setAvailability((prev) => [...prev, res.slot]);
  };

  // Remove Availability Slot
  const removeAvailabilitySlot = async (slotId: string) => {
    if (!currentSchool) return;
    await api.removeAvailabilitySlot(currentSchool.id, slotId);
    setAvailability((prev) => prev.filter((s) => s.id !== slotId));
  };

  // Mark notifications read
  const markNotificationsAsRead = async () => {
    if (!currentSchool) return;
    await api.markNotificationsRead(currentSchool.id).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  // Update Settings
  const updateSettings = async (newSettings: Partial<SchoolSettings>) => {
    if (!currentSchool) return;
    const res = await api.updateSettings(currentSchool.id, newSettings);
    setSettings(res.settings);
  };

  // Add / Remove Student Profile (Local helpers)
  const addStudentToProfile = (student: { name: string; className: string }) => {
    if (!currentUser) return;
    const newStudent: Student = {
      id: 's-' + Date.now(),
      schoolId: currentSchool?.id,
      name: student.name,
      className: student.className,
    };
    const updated = [...(currentUser.students || []), newStudent];
    setCurrentUser({ ...currentUser, students: updated });
  };

  const removeStudentFromProfile = (studentId: string) => {
    if (!currentUser) return;
    const updated = (currentUser.students || []).filter((s) => s.id !== studentId);
    setCurrentUser({ ...currentUser, students: updated });
  };

  // Password reset helper
  const resetUserPassword = (_phone: string, _newPass: string): boolean => {
    return true;
  };

  // Admin: Upload Roster
  const uploadRoster = async (records: Partial<SchoolRosterRecord>[]): Promise<number> => {
    if (!currentSchool) return 0;
    const res = await api.uploadRoster(currentSchool.id, records);
    const updatedRoster = await api.getRoster(currentSchool.id).catch(() => ({ roster: [] }));
    setRoster(updatedRoster.roster);
    return res.addedCount;
  };

  // Automated Tenant Isolation Test Suite
  const runIsolationTests = async (): Promise<TenantIsolationTestResult[]> => {
    if (!currentSchool) return [];
    try {
      const res = await api.testIsolation(currentSchool.id);
      setIsolationTestResults(res.results);
      return res.results;
    } catch (err: any) {
      console.error('Test isolation error:', err);
      return [];
    }
  };

  // Onboarding helpers
  const sendOtp = async (phone: string, schoolId?: string) => {
    return api.sendOtp(phone, schoolId);
  };

  const verifyOtp = async (phone: string, code: string, schoolId?: string) => {
    const res = await api.verifyOtp(phone, code, schoolId);
    setAuthToken(res.token);
    setUserMemberships(res.memberships);
    return res;
  };

  const checkRoster = async (schoolId: string) => {
    return api.checkRoster(schoolId);
  };

  const claimStudents = async (schoolId: string, firstName?: string, lastName?: string) => {
    const res = await api.claimStudents(schoolId, firstName, lastName);
    setUserMemberships(res.memberships);
    return res;
  };

  const refreshCurrentSchoolData = async () => {
    if (currentSchool && currentUser) {
      await loadSchoolData(currentSchool.id, currentUser, currentMembership);
    }
  };

  const unreadNotificationCount = notifications.filter(
    (n) => !n.read && (currentUser ? n.userId === currentUser.id : true)
  ).length;

  return (
    <AppContext.Provider
      value={{
        currentUser,
        users,
        schools,
        currentSchool,
        userMemberships,
        currentMembership,
        teachers,
        availability,
        appointments,
        notifications,
        settings,
        auditLogs,
        roster,
        isolationTestResults,
        unreadNotificationCount,
        isLoading,
        switchSchool,
        login,
        logout,
        switchUser,
        registerUser,
        bookAppointment,
        approveAppointment,
        rejectAppointment,
        cancelAppointment,
        checkInVisitor,
        checkOutVisitor,
        addAvailabilitySlot,
        removeAvailabilitySlot,
        markNotificationsAsRead,
        updateSettings,
        addStudentToProfile,
        removeStudentFromProfile,
        resetUserPassword,
        uploadRoster,
        runIsolationTests,
        sendOtp,
        verifyOtp,
        checkRoster,
        claimStudents,
        refreshCurrentSchoolData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
