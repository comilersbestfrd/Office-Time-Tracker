export interface RecordSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
}

export interface ShortLeaveSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
  reason: string; // e.g., "Bank Work", "Document Work", "Home Work", etc.
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'weekly-off' | 'holiday';
  inTime: string | null; // ISO string
  outTime: string | null; // ISO string, null if active
  restSessions: RecordSession[];
  restTimeTotal: number; // in minutes (completed sessions)
  activeRestStart: string | null; // ISO string if currently resting
  shortLeaveSessions?: ShortLeaveSession[];
  shortLeaveTotal?: number; // in minutes (completed short leave sessions)
  activeShortLeaveStart?: string | null; // ISO string if currently on short leave
  activeShortLeaveReason?: string | null;
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

// Helper to calculate Short Leave duration and net deduction excluding 1:00 PM - 2:00 PM lunch break
export function calculateShortLeaveDeduction(
  dateStr: string,
  startIsoOrTime: string,
  endIsoOrTime: string
): { grossMinutes: number; lunchOverlapMinutes: number; netDeductedMinutes: number } {
  const getFullIso = (t: string) => (t.includes('T') ? t : `${dateStr}T${t}:00`);
  const s = new Date(getFullIso(startIsoOrTime)).getTime();
  const e = new Date(getFullIso(endIsoOrTime)).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) {
    return { grossMinutes: 0, lunchOverlapMinutes: 0, netDeductedMinutes: 0 };
  }
  const grossMinutes = Math.round((e - s) / 60000);

  const lunchStart = new Date(`${dateStr}T13:00:00`).getTime();
  const lunchEnd = new Date(`${dateStr}T14:00:00`).getTime();

  const overlapStart = Math.max(s, lunchStart);
  const overlapEnd = Math.min(e, lunchEnd);
  let lunchOverlapMinutes = 0;
  if (overlapEnd > overlapStart) {
    lunchOverlapMinutes = Math.round((overlapEnd - overlapStart) / 60000);
  }

  const netDeductedMinutes = Math.max(0, grossMinutes - lunchOverlapMinutes);
  return { grossMinutes, lunchOverlapMinutes, netDeductedMinutes };
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

  // Calculate Short Leave Deduction (Not counted as work time)
  // Each short leave session during shift is subtracted from worked time.
  // To avoid double-deducting time that falls within the 1:00 PM - 2:00 PM lunch window (which is already deducted by lunchOverlapMs):
  let shortLeaveDeductionMs = 0;
  const allShortLeaves: ShortLeaveSession[] = [...(record.shortLeaveSessions || [])];
  if (record.activeShortLeaveStart) {
    const endIso = record.outTime || (nowStr || new Date().toISOString());
    allShortLeaves.push({
      start: record.activeShortLeaveStart,
      end: endIso,
      reason: record.activeShortLeaveReason || 'Short Leave',
    });
  }

  let totalNetShortLeaveMins = 0;
  allShortLeaves.forEach((s) => {
    if (!s.start) return;
    const sStart = new Date(s.start).getTime();
    const sEnd = s.end ? new Date(s.end).getTime() : (record.outTime ? new Date(record.outTime).getTime() : new Date().getTime());
    if (sEnd > sStart) {
      // Exclude lunch break (1:00 PM - 2:00 PM) from short leave minutes
      const lunchOverlapStart = Math.max(sStart, lunchStart.getTime());
      const lunchOverlapEnd = Math.min(sEnd, lunchEnd.getTime());
      const lunchOverlap = Math.max(0, lunchOverlapEnd - lunchOverlapStart);
      const netLeaveMs = Math.max(0, (sEnd - sStart) - lunchOverlap);
      totalNetShortLeaveMins += netLeaveMs / 60000;

      // Net deduction within work window [effectiveStartTime, outTime]
      const winStart = Math.max(effectiveStartTime.getTime(), sStart);
      const winEnd = Math.min(outTime.getTime(), sEnd);
      if (winEnd > winStart) {
        let spanMs = winEnd - winStart;
        // Check overlap with lunch break [lunchStart, lunchEnd]
        const lunchWinStart = Math.max(winStart, lunchStart.getTime());
        const lunchWinEnd = Math.min(winEnd, lunchEnd.getTime());
        if (lunchWinEnd > lunchWinStart) {
          spanMs -= (lunchWinEnd - lunchWinStart);
        }
        shortLeaveDeductionMs += Math.max(0, spanMs);
      }
    }
  });

  // Work time = (elapsed work time after 9:00 AM - lunch break - excess break time - short leave deduction)
  const netWorkedMs = Math.max(0, elapsedMs - lunchOverlapMs - excessRestMs - shortLeaveDeductionMs);
  const workedHours = netWorkedMs / (1000 * 60 * 60);
  const pendingHours = 8 - workedHours;

  return {
    ...record,
    outTime: outTimeStr,
    isAutoClockedOut,
    earlyTime: parseFloat(earlyMinutes.toFixed(2)),
    lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
    shortLeaveTotal: Math.round(totalNetShortLeaveMins),
    workedHours: parseFloat(workedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
  };
}
