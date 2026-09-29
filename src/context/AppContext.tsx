import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
  SecurityQrVerification,
} from '../types';
import { api, setAuthToken, setActiveSchoolId, getAuthToken, getActiveSchoolId, setPlatformTargetSchoolId, getPlatformTargetSchoolId } from '../services/api';
import { ManagedSchool } from '../types/platform';

interface AppContextType {
  refreshSchoolData: () => Promise<void>;
  refreshPlatformSchools: () => Promise<void>;
  currentUser: User | null;
  users: User[];
  usersLoading: boolean;
  usersError: string;
  schools: School[];
  platformSchools: ManagedSchool[];
  isPlatformAdmin: boolean;
  platformContextActive: boolean;
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
  returnToPlatform: () => Promise<void>;
  login: (phone: string, password: string, role?: UserRole) => Promise<boolean>;
  logout: () => void;
  switchUser: (userId: string) => Promise<void>;
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
  verifySecurityQr: (qrToken: string) => Promise<SecurityQrVerification>;
  addAvailabilitySlot: (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => Promise<void>;
  createTeacher: (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => Promise<unknown>;
  removeAvailabilitySlot: (slotId: string) => Promise<void>;
  markNotificationsAsRead: () => Promise<void>;
  clearParentNotifications: () => Promise<void>;
  clearParentHistory: () => Promise<void>;
  getParentClasses: () => Promise<string[]>;
  updateSettings: (newSettings: Partial<SchoolSettings>) => Promise<void>;
  addStudentToProfile: (student: { name: string; className: string }) => Promise<void>;
  removeStudentFromProfile: (studentId: string) => void;
  runIsolationTests: () => Promise<TenantIsolationTestResult[]>;
}

const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
  appName: 'Veli Randevu',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 30,
  allowParentCancel: true,
};

const asSchool = (school: ManagedSchool): School => ({ ...school, settings: DEFAULT_SETTINGS });

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const schoolLoadSequence = useRef(0);
  const [schools, setSchools] = useState<School[]>([]);
  const [platformSchools, setPlatformSchools] = useState<ManagedSchool[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
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
  const platformContextActive = !!getPlatformTargetSchoolId() && isPlatformAdmin;

  // Load School-scoped data whenever active school or membership changes
  const loadSchoolData = useCallback(async (schoolId: string, user: User | null, membership: SchoolMembership | null, platformContext = false) => {
    if (!schoolId) return;
    const sequence = ++schoolLoadSequence.current;
    setUsers([]);
    setUsersError('');
    const role = platformContext ? 'admin' : membership?.role;
    const isAdmin = role === 'admin';
    setUsersLoading(isAdmin);
    const [teachersRes, usersRes, studentsRes, availRes, aptsRes, notifsRes, settingsRes, auditRes, rosterRes] = await Promise.all([
      api.getTeachers(schoolId).catch(() => { if (isAdmin) setUsersError('Öğretmen listesi yüklenemedi. Lütfen tekrar deneyin.'); return { teachers: [] }; }),
      isAdmin ? api.getSecurityUsers(schoolId).catch(() => { setUsersError('Güvenlik personeli yüklenemedi. Lütfen tekrar deneyin.'); return { users: [] }; }) : Promise.resolve({ users: [] }),
      api.getStudents(schoolId).catch(() => ({ students: [] })),
      api.getAvailability(schoolId).catch(() => ({ availability: [] })),
      role === 'security' ? Promise.resolve({ appointments: [] }) : api.getAppointments(schoolId).catch(() => ({ appointments: [] })),
      api.getNotifications(schoolId).catch(() => ({ notifications: [] })),
      api.getSettings(schoolId).catch(() => ({ settings: DEFAULT_SETTINGS })),
      role === 'admin' || role === 'security' ? api.getAuditLogs(schoolId).catch(() => ({ auditLogs: [] })) : Promise.resolve({ auditLogs: [] }),
      isAdmin ? api.getRoster(schoolId).catch(() => ({ roster: [] })) : Promise.resolve({ roster: [] }),
    ]);
    if (sequence !== schoolLoadSequence.current) return;
    setTeachers(teachersRes.teachers);
    setUsers(usersRes.users);
    setUsersLoading(false);
    if (user) setCurrentUser({ ...user, students: studentsRes.students });
    setAvailability(availRes.availability);
    setAppointments(aptsRes.appointments);
    setNotifications(notifsRes.notifications);
    setSettings(settingsRes.settings);
    setAuditLogs(auditRes.auditLogs);
    setRoster(rosterRes.roster);
  }, []);

  // Initial bootstrap from API
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const token = getAuthToken();
        if (token) {
          try {
            const [meRes, schoolsRes, capabilities] = await Promise.all([
              api.getMe(), api.getPublicSchools().catch(() => ({ schools: [] })),
              api.getPlatformCapabilities().catch(() => ({ manageSchools: false })),
            ]);
            const activeUser = meRes.user;
            setUserMemberships(meRes.memberships);
            setSchools(schoolsRes.schools);
            setIsPlatformAdmin(capabilities.manageSchools);
            const managed = capabilities.manageSchools ? await api.getManagedSchools().then((result) => result.schools).catch(() => []) : [];
            setPlatformSchools(managed);
            const savedTargetId = getPlatformTargetSchoolId();
            const savedTarget = managed.find((school) => school.id === savedTargetId && !school.disabledAt);
            const activeMemberships = meRes.memberships.filter((membership) => membership.status === 'active' && schoolsRes.schools.some((school) => school.id === membership.schoolId));
            const activeMembershipSchool = activeMemberships.some((membership) => membership.schoolId === getActiveSchoolId());
            const targetSchoolId = savedTarget?.id || (activeMembershipSchool ? getActiveSchoolId()! : activeMemberships[0]?.schoolId || managed.find((school) => !school.disabledAt)?.id || schoolsRes.schools[0]?.id || 'sch-kazan-01');
            const platformContext = !!savedTarget;
            setPlatformTargetSchoolId(platformContext ? targetSchoolId : null);
            setActiveSchoolId(targetSchoolId);
            const activeSchool = platformContext ? asSchool(savedTarget!) : schoolsRes.schools.find((s) => s.id === targetSchoolId) || (managed.find((s) => s.id === targetSchoolId) ? asSchool(managed.find((s) => s.id === targetSchoolId)!) : null);
            setCurrentSchool(activeSchool);

            const activeMem = meRes.memberships.find((m) => m.schoolId === targetSchoolId && m.status === 'active') || null;
            setCurrentMembership(activeMem);

            activeUser.role = platformContext ? 'admin' : activeMem?.role;
            activeUser.branch = activeMem?.branch;

            setCurrentUser(activeUser);
            void loadSchoolData(targetSchoolId, activeUser, activeMem, platformContext);
          } catch (err) {
            // Token expired or invalid
            setAuthToken(null);
            setCurrentUser(null);
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
    const platformSchool = isPlatformAdmin && platformSchools.find((school) => school.id === schoolId && !school.disabledAt);
    const membership = userMemberships.find((item) => item.schoolId === schoolId && item.status === 'active') || null;
    if (!platformSchool && !membership) return;
    if (!isPlatformAdmin && (currentUser?.role === 'teacher' || currentUser?.role === 'security')) return;
    schoolLoadSequence.current += 1;
    setUsers([]);
    setUsersError('');
    setPlatformTargetSchoolId(platformSchool ? schoolId : null);
    setActiveSchoolId(schoolId);
    const targetSchool = platformSchool ? asSchool(platformSchool) : schools.find((s) => s.id === schoolId) || null;
    setCurrentSchool(targetSchool);

    // Instant cache purge of previous school data
    setTeachers([]);
    setAvailability([]);
    setAppointments([]);
    setNotifications([]);
    setAuditLogs([]);
    setRoster([]);

    if (currentUser) {
      const activeMem = membership;
      setCurrentMembership(activeMem);

      const updatedUser = {
        ...currentUser,
        students: [], // Reset previous school's students
        role: platformSchool ? 'admin' as const : activeMem?.role,
        branch: activeMem ? activeMem.branch : undefined,
      };
      setCurrentUser(updatedUser);
      await loadSchoolData(schoolId, updatedUser, activeMem, !!platformSchool);
    }
  };

  const returnToPlatform = async () => {
    const fallback = userMemberships.find((membership) => membership.status === 'active' && schools.some((school) => school.id === membership.schoolId));
    setPlatformTargetSchoolId(null);
    if (fallback) {
      const target = schools.find((school) => school.id === fallback.schoolId) || null;
      setActiveSchoolId(fallback.schoolId);
      setCurrentSchool(target);
      setCurrentMembership(fallback);
      setTeachers([]); setUsers([]); setAvailability([]); setAppointments([]); setNotifications([]); setAuditLogs([]); setRoster([]); setSettings(DEFAULT_SETTINGS); setIsolationTestResults([]);
      if (currentUser) {
        const updatedUser = { ...currentUser, role: fallback.role, branch: fallback.branch, students: [] };
        setCurrentUser(updatedUser);
        await loadSchoolData(fallback.schoolId, updatedUser, fallback);
      }
    }
    else {
      schoolLoadSequence.current += 1;
      setCurrentSchool(null); setCurrentMembership(null); setTeachers([]); setUsers([]); setAvailability([]); setAppointments([]); setNotifications([]); setRoster([]); setAuditLogs([]); setSettings(DEFAULT_SETTINGS); setIsolationTestResults([]);
      if (currentUser) setCurrentUser({ ...currentUser, role: undefined, students: [] });
    }
  };

  // Login
  const login = async (phone: string, password: string, role?: UserRole): Promise<boolean> => {
    try {
      const res = await api.login(phone, password, role);
      setAuthToken(res.token);
      setUserMemberships(res.memberships);
      const [ownSchoolsResult, capabilities] = await Promise.all([
        api.getPublicSchools(), api.getPlatformCapabilities().catch(() => ({ manageSchools: false })),
      ]);
      const ownSchools = ownSchoolsResult.schools;
      const managedSchools = capabilities.manageSchools ? await api.getManagedSchools().then((result) => result.schools).catch(() => []) : [];
      setIsPlatformAdmin(capabilities.manageSchools);
      setPlatformSchools(managedSchools);
      setSchools(ownSchools);
      const activeMembership = res.memberships.find((membership) => membership.status === 'active' && ownSchools.some((school) => school.id === membership.schoolId));
      const targetSchoolId = activeMembership?.schoolId || (capabilities.manageSchools ? managedSchools.find((school) => !school.disabledAt)?.id : undefined) || ownSchools[0]?.id || 'sch-kazan-01';
      const platformContext = !activeMembership && capabilities.manageSchools;
      setPlatformTargetSchoolId(platformContext ? targetSchoolId : null);
      setActiveSchoolId(targetSchoolId);

      const activeSchool = ownSchools.find((s) => s.id === targetSchoolId) || (managedSchools.find((s) => s.id === targetSchoolId) ? asSchool(managedSchools.find((s) => s.id === targetSchoolId)!) : null);
      setCurrentSchool(activeSchool);

      const activeMem = res.memberships.find((m) => m.schoolId === targetSchoolId && m.status === 'active') || null;
      setCurrentMembership(activeMem);

      const userWithRole = {
        ...res.user,
        role: activeMem?.role || role,
        branch: activeMem?.branch,
      };

      setCurrentUser(userWithRole);
      void loadSchoolData(targetSchoolId, userWithRole, activeMem, platformContext);
      return true;
    } catch (err) {
      console.error('Login error:', err);
      return false;
    }
  };

  // Logout
  const logout = () => {
    schoolLoadSequence.current += 1;
    setUsers([]);
    setUsersError('');
    setUsersLoading(false);
    setAuthToken(null);
    setPlatformTargetSchoolId(null);
    setCurrentUser(null);
    setIsPlatformAdmin(false);
    setPlatformSchools([]);
    setSchools([]);
    setCurrentSchool(null);
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
      setPlatformTargetSchoolId(null);
      const capabilities = await api.getPlatformCapabilities().catch(() => ({ manageSchools: false }));
      setIsPlatformAdmin(capabilities.manageSchools);
      const managedSchools = capabilities.manageSchools ? await api.getManagedSchools().then((result) => result.schools).catch(() => []) : [];
      setPlatformSchools(managedSchools);
      const ownSchools = (await api.getPublicSchools()).schools;
      setSchools(ownSchools);

      const targetSchoolId = res.memberships.find((membership) => membership.status === 'active' && ownSchools.some((school) => school.id === membership.schoolId))?.schoolId || ownSchools[0]?.id || 'sch-kazan-01';
      setActiveSchoolId(targetSchoolId);

      const activeSchool = ownSchools.find((s) => s.id === targetSchoolId) || null;
      setCurrentSchool(activeSchool);

      const activeMem = res.memberships.find((m) => m.schoolId === targetSchoolId && m.status === 'active') || null;
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

  // Read-only QR verification (Strictly validated by backend tenant guard)
  const verifySecurityQr = async (qrToken: string) => {
    if (!currentSchool) {
      return { success: false, allowed: false, decision: 'INVALID' as const, title: 'RANDEVU DOĞRULANAMADI', message: 'Bu randevu giriş için doğrulanamadı.' };
    }
    return api.verifySecurityQr(currentSchool.id, qrToken);
  };

  // Add Availability Slot
  const addAvailabilitySlot = async (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => {
    if (!currentSchool) return;
    const res = await api.addAvailabilitySlot(currentSchool.id, slot);
    setAvailability((prev) => [...prev, res.slot]);
  };

  const createTeacher = async (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => {
    if (!currentSchool) throw new Error('Aktif okul bulunamadı.');
    try {
      const result = await api.createStaff(currentSchool.id, data);
      await loadSchoolData(currentSchool.id, currentUser, currentMembership, platformContextActive);
      return result;
    } catch (error) {
      await loadSchoolData(currentSchool.id, currentUser, currentMembership, platformContextActive);
      throw error;
    }
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

  const clearParentNotifications = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return;
    await api.clearParentNotifications(currentSchool.id);
    setNotifications((previous) => previous.filter((notification) => notification.userId !== currentUser?.id));
  };

  const clearParentHistory = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return;
    await api.clearParentHistory(currentSchool.id);
    const result = await api.getAppointments(currentSchool.id);
    setAppointments(result.appointments);
  };

  const getParentClasses = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return [];
    return (await api.getParentClasses(currentSchool.id)).classes;
  };

  // Update Settings
  const updateSettings = async (newSettings: Partial<SchoolSettings>) => {
    if (!currentSchool) return;
    const res = await api.updateSettings(currentSchool.id, newSettings);
    setSettings(res.settings);
  };

  // Add / Remove Student Profile (Local helpers)
  const addStudentToProfile = async (student: { name: string; className: string }) => {
    if (!currentUser || !currentSchool || currentMembership?.role !== 'parent') throw new Error('Aktif veli hesabı bulunamadı.');
    await api.claimParentStudent(currentSchool.id, student);
    const result = await api.getStudents(currentSchool.id);
    setCurrentUser((previous) => previous ? { ...previous, students: result.students } : previous);
  };

  const removeStudentFromProfile = (studentId: string) => {
    if (!currentUser) return;
    const updated = (currentUser.students || []).filter((s) => s.id !== studentId);
    setCurrentUser({ ...currentUser, students: updated });
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

  const unreadNotificationCount = notifications.filter(
    (n) => !n.read && (currentUser ? n.userId === currentUser.id : true)
  ).length;

  return (
    <AppContext.Provider
      value={{
        refreshSchoolData: async () => {
          const schoolId = currentSchool?.id;
          if (!schoolId || getActiveSchoolId() !== schoolId || (currentMembership?.role !== 'admin' && !platformContextActive)) return;
          const [teacherData, userData, rosterData, logData] = await Promise.all([
            api.getTeachers(schoolId), api.getSecurityUsers(schoolId), api.getRoster(schoolId), api.getAuditLogs(schoolId),
          ]);
          if (getActiveSchoolId() !== schoolId) return;
          setTeachers(teacherData.teachers);
          setUsers(userData.users);
          setRoster(rosterData.roster);
          setAuditLogs(logData.auditLogs);
        },
        refreshPlatformSchools: async () => {
          if (!isPlatformAdmin) return;
          const result = await api.getManagedSchools();
          setPlatformSchools(result.schools);
          setSchools((current) => current.map((school) => {
            const updated = result.schools.find((candidate) => candidate.id === school.id);
            return updated ? asSchool(updated) : school;
          }));
          const active = currentSchool && result.schools.find((school) => school.id === currentSchool.id);
          if ((!active || active.disabledAt) && currentSchool && platformContextActive) {
            await returnToPlatform();
          } else if (active) setCurrentSchool(asSchool(active));
        },
        currentUser,
        users,
        usersLoading,
        usersError,
        schools,
        platformSchools,
        isPlatformAdmin,
        platformContextActive,
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
        returnToPlatform,
        login,
        logout,
        switchUser,
        bookAppointment,
        approveAppointment,
        rejectAppointment,
        cancelAppointment,
        verifySecurityQr,
        addAvailabilitySlot,
        createTeacher,
        removeAvailabilitySlot,
        markNotificationsAsRead,
        clearParentNotifications,
        clearParentHistory,
        getParentClasses,
        updateSettings,
        addStudentToProfile,
        removeStudentFromProfile,
        runIsolationTests,
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
