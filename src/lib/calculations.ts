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
  earlyTime?: number; // in minutes (punched in before 09:00 AM)
  lunchDeduction?: number; // in minutes
  notes?: string;
  isAutoClockedOut?: boolean;
  allowedRestLimit?: number; // custom allowed rest limit in minutes
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
export function calculateRecordHours(record: DayRecord, nowStr?: string, defaultAllowedRest: number = 20): DayRecord {
  if (record.status !== 'present') {
    return {
      ...record,
      earlyTime: 0,
      workedHours: 0,
      pendingHours: 0, // Weekly off and Absent don't accumulate worked hours on the day itself
    };
  }

  if (!record.inTime) {
    return {
      ...record,
      earlyTime: 0,
      workedHours: 0,
      pendingHours: 8,
    };
  }

  const todayStr = nowStr ? nowStr.substring(0, 10) : new Date().toISOString().substring(0, 10);
  const isToday = record.date === todayStr;

  const inTime = new Date(record.inTime);
  let outTime: Date;
  let outTimeStr = record.outTime;
  let isAutoClockedOut = false;

  if (record.outTime) {
    outTime = new Date(record.outTime);
  } else if (isToday) {
    outTime = new Date(nowStr || new Date().toISOString());
  } else {
    // Past day and user forgot to clock out - default to 6:15 PM (18:15)
    const defaultOut = new Date(`${record.date}T18:15:00`);
    outTime = defaultOut;
    outTimeStr = defaultOut.toISOString();
    isAutoClockedOut = true;
  }

  const nineAm = new Date(`${record.date}T09:00:00`);

  // Calculate Early Time before 9:00 AM (in minutes)
  let earlyMinutes = 0;
  if (inTime.getTime() < nineAm.getTime()) {
    const earlyEnd = Math.min(outTime.getTime(), nineAm.getTime());
    if (earlyEnd > inTime.getTime()) {
      earlyMinutes = (earlyEnd - inTime.getTime()) / 60000;
    }
  }

  // Work time always starts from 09:00 AM if inTime is earlier
  const effectiveStartTime = inTime.getTime() < nineAm.getTime() ? nineAm : inTime;

  // Elapsed work time in milliseconds (only counts time after 9 AM to out punch)
  let elapsedMs = 0;
  if (outTime.getTime() > effectiveStartTime.getTime()) {
    elapsedMs = outTime.getTime() - effectiveStartTime.getTime();
  }

  // Calculate Lunch Break (1:00 PM to 2:00 PM) overlap
  const lunchStart = new Date(`${record.date}T13:00:00`);
  const lunchEnd = new Date(`${record.date}T14:00:00`);

  const overlapStart = new Date(Math.max(effectiveStartTime.getTime(), lunchStart.getTime()));
  const overlapEnd = new Date(Math.min(outTime.getTime(), lunchEnd.getTime()));

  let lunchOverlapMs = 0;
  if (overlapStart.getTime() < overlapEnd.getTime()) {
    lunchOverlapMs = overlapEnd.getTime() - overlapStart.getTime();
  }
  const lunchDeductionMinutes = lunchOverlapMs / 60000;

  // Calculate total rest / break time including active rest session
  let totalRestMinutes = record.restTimeTotal || 0;
  if (record.activeRestStart) {
    const restStart = new Date(record.activeRestStart);
    const restEnd = record.outTime ? new Date(record.outTime) : new Date(nowStr || new Date().toISOString());
    const activeRestMs = restEnd.getTime() - restStart.getTime();
    if (activeRestMs > 0) {
      totalRestMinutes += activeRestMs / 60000;
    }
  }

  // Allowed rest limit. Daily break time is counted in work time up to allowed limit (default 20m).
  // Any break time that goes beyond the limit is deducted from work time and becomes pending.
  const allowedRest = record.allowedRestLimit !== undefined ? record.allowedRestLimit : defaultAllowedRest;
  const excessRestMinutes = Math.max(0, totalRestMinutes - allowedRest);
  const excessRestMs = excessRestMinutes * 60 * 1000;

  // Work time = (elapsed work time after 9:00 AM - lunch break - excess break time)
  const netWorkedMs = Math.max(0, elapsedMs - lunchOverlapMs - excessRestMs);
  const workedHours = netWorkedMs / (1000 * 60 * 60);
  const pendingHours = 8 - workedHours;

  return {
    ...record,
    outTime: outTimeStr,
    isAutoClockedOut,
    earlyTime: parseFloat(earlyMinutes.toFixed(2)),
    lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
    workedHours: parseFloat(workedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
  };
}
