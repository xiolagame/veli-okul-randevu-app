export interface ManagedStudent {
  id: string;
  name: string;
  className: string;
  studentNumber: string;
  birthDate?: string;
}

export interface ManagedParent {
  id: string;
  fullName: string;
  phone: string;
  status: string;
  students: ManagedStudent[];
}

export interface ManagedSchoolAdmin {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  status: 'active' | 'pending';
}
