export function appointmentsOnDate<T extends { date: string }>(appointments: T[], date: string): T[] {
  return appointments.filter((appointment) => appointment.date === date);
}

export function parentsInClass<T extends { students: Array<{ className: string }> }>(parents: T[], className: string): T[] {
  if (!className) return [];
  return parents.map((parent) => ({ ...parent, students: parent.students.filter((student) => student.className === className) }))
    .filter((parent) => parent.students.length > 0);
}
