export function appointmentsOnDate<T extends { date: string }>(appointments: T[], date: string): T[] {
  return appointments.filter((appointment) => appointment.date === date);
}

export function sortAppointmentsForAdmin<T extends { id: string; date: string; startTime: string }>(
  appointments: T[],
  now: { date: string; time: string }
): T[] {
  const key = (appointment: T) => `${appointment.date}T${appointment.startTime}`;
  const current = `${now.date}T${now.time}`;
  return [...appointments].sort((left, right) => {
    const leftFuture = key(left) >= current;
    const rightFuture = key(right) >= current;
    if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
    const order = key(left).localeCompare(key(right));
    if (order) return leftFuture ? order : -order;
    return left.id.localeCompare(right.id);
  });
}

export function parentsInClass<T extends { students: Array<{ className: string }> }>(parents: T[], className: string): T[] {
  if (!className) return [];
  return parents.map((parent) => ({ ...parent, students: parent.students.filter((student) => student.className === className) }))
    .filter((parent) => parent.students.length > 0);
}
