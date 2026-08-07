export interface RecordSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'weekly-off' | 'holiday';
  inTime: string | null; // ISO string
  outTime: string | null; // ISO string, null if active
  restSessions: RecordSession[];
  restTimeTotal: number; // in minutes (completed sessions)
  activeRestStart: string | null; // ISO string if currently resting
  workedHours: number; // calculated hours
  pendingHours: number; // calculated pending hours
  lunchDeduction?: number; // in minutes
  notes?: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string; // e.g., "Independence Day"
}

export interface DashboardStats {
  totalWorkDays: number;     // Expected working days (present + absent)
  presentDays: number;       // Number of days present
  absentDays: number;        // Number of days absent
  weeklyOffDays: number;     // Number of weekly offs (Sundays)
  requiredHoursTotal: number;// Expected hours (totalWorkDays * 8)
  hoursWorkedTotal: number;  // Hours actually worked
  pendingHoursTotal: number; // requiredHoursTotal - hoursWorkedTotal
}

// Calculate hours for a single day record
export function calculateRecordHours(record: DayRecord, nowStr?: string): DayRecord {
  if (record.status !== 'present') {
    return {
      ...record,
      workedHours: 0,
      pendingHours: 0, // Weekly off and Absent don't accumulate worked hours on the day itself
    };
  }

  if (!record.inTime) {
    return {
      ...record,
      workedHours: 0,
      pendingHours: 8,
    };
  }

  const todayStr = nowStr ? nowStr.substring(0, 10) : new Date().toISOString().substring(0, 10);
  const isToday = record.date === todayStr;

  const inTime = new Date(record.inTime);
  let outTime: Date;
  let outTimeStr = record.outTime;

  if (record.outTime) {
    outTime = new Date(record.outTime);
  } else if (isToday) {
    outTime = new Date(nowStr || new Date().toISOString());
  } else {
    // Past day and user forgot to clock out - default to 6:10 PM (18:10)
    const defaultOut = new Date(`${record.date}T18:10:00`);
    outTime = defaultOut;
    outTimeStr = defaultOut.toISOString();
  }

  // Total elapsed time in milliseconds
  const elapsedMs = outTime.getTime() - inTime.getTime();
  if (elapsedMs < 0) {
    return { ...record, workedHours: 0, pendingHours: 8 };
  }

  // Calculate Lunch Break (1:00 PM to 2:00 PM) overlap
  const lunchStart = new Date(`${record.date}T13:00:00`);
  const lunchEnd = new Date(`${record.date}T14:00:00`);

  const overlapStart = new Date(Math.max(inTime.getTime(), lunchStart.getTime()));
  const overlapEnd = new Date(Math.min(outTime.getTime(), lunchEnd.getTime()));

  let lunchOverlapMs = 0;
  if (overlapStart.getTime() < overlapEnd.getTime()) {
    lunchOverlapMs = overlapEnd.getTime() - overlapStart.getTime();
  }
  const lunchDeductionMinutes = lunchOverlapMs / 60000;

  // Subtract lunch break from total elapsed time
  const netElapsedMs = Math.max(0, elapsedMs - lunchOverlapMs);

  // Calculate total rest time including active rest session
  let totalRestMinutes = record.restTimeTotal;
  if (record.activeRestStart) {
    const restStart = new Date(record.activeRestStart);
    const restEnd = record.outTime ? new Date(record.outTime) : new Date(nowStr || new Date().toISOString());
    const activeRestMs = restEnd.getTime() - restStart.getTime();
    if (activeRestMs > 0) {
      totalRestMinutes += activeRestMs / 60000;
    }
  }

  // Allowed rest is 20 minutes. Deduct excess break time from actual worked hours.
  const allowedRest = 20;
  const excessRestMinutes = Math.max(0, totalRestMinutes - allowedRest);

  // Worked hours = (net elapsed time - excess rest time)
  const elapsedHours = netElapsedMs / (1000 * 60 * 60);
  const excessRestHours = excessRestMinutes / 60;
  
  const workedHours = Math.max(0, elapsedHours - excessRestHours);
  const pendingHours = 8 - workedHours;

  return {
    ...record,
    outTime: outTimeStr,
    lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
    workedHours: parseFloat(workedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
  };
}
