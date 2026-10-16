export interface RecordSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
}

export interface ShortLeaveSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
  reason: string; // e.g., "Bank Work", "Document Work", "Home Work", etc.
}

export type HolidayType = 'full' | 'half-before-lunch' | 'half-after-lunch';

export interface DayRecord {
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'weekly-off' | 'holiday';
  holidayType?: HolidayType;
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
  lateMinutes?: number; // minutes arrived late after shift start (09:00 AM)
  isLateApproved?: boolean; // whether late arrival is approved by admin
  lateReason?: string; // optional note/reason for late arrival
  approvedLateMinutes?: number; // approved late arrival (coverable after 6 PM)
  unapprovedLateMinutes?: number; // unapproved late arrival (cut from salary)
  afterSixMinutes?: number; // minutes worked after 6:00 PM (18:00)
  coveredLateMinutes?: number; // approved late minutes covered by working after 6:00 PM
  leaveCoverMinutes?: number; // time after 6:00 PM that deducts from monthly leave hours
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string; // e.g., "Independence Day"
  type?: HolidayType; // 'full' (default), 'half-before-lunch', 'half-after-lunch'
}

export interface DashboardStats {
  totalWorkDays: number;     // Expected working days (present + absent)
  presentDays: number;       // Number of days present
  absentDays: number;        // Number of days absent
  weeklyOffDays: number;     // Number of weekly offs (Sundays)
  requiredHoursTotal: number;// Expected hours (totalWorkDays * 8)
  hoursWorkedTotal: number;  // Hours actually worked
  pendingHoursTotal: number; // requiredHoursTotal - hoursWorkedTotal
  totalLateMinutes?: number;
  unapprovedLateMinutesTotal?: number; // Total minutes cut from salary due to unapproved late
  approvedLateMinutesTotal?: number;   // Total approved late minutes
  coveredLateMinutesTotal?: number;    // Total approved late minutes covered after 6 PM
  afterSixMinutesTotal?: number;       // Total minutes worked after 6:00 PM
  leaveHoursTotal?: number;            // Total leave/absent hours (absentDays * 8)
  leaveCoverHoursTotal?: number;       // Total hours worked after 6 PM to cover leave
  remainingLeaveHours?: number;        // Net remaining leave hours after deducting leave cover hours
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

export const NEW_POLICY_START_DATE = '2026-10-01';

// Calculate hours for a single day record
export function calculateRecordHours(
  record: DayRecord,
  nowStr?: string,
  defaultAllowedRest: number = 20,
  holiday?: Holiday | null
): DayRecord {
  const effectiveHolidayType: HolidayType | undefined =
    record.holidayType || holiday?.type || (record.status === 'holiday' ? 'full' : undefined);
  const isHalfDay = effectiveHolidayType === 'half-before-lunch' || effectiveHolidayType === 'half-after-lunch';
  const isFullHoliday = effectiveHolidayType === 'full' || (!effectiveHolidayType && record.status === 'holiday');
  const targetRequiredHours = isHalfDay ? 4 : (isFullHoliday ? 0 : 8);

  // New policy (fixed 9-6 shift, late cuts, after-6pm leave cover) starts from October 1st, 2026 (this month)
  const isNewPolicyActive = record.date >= NEW_POLICY_START_DATE;

  if (record.status !== 'present') {
    let pending = 0;
    if (record.status === 'absent') {
      pending = targetRequiredHours;
    }
    return {
      ...record,
      holidayType: effectiveHolidayType,
      earlyTime: 0,
      workedHours: 0,
      pendingHours: pending,
      lateMinutes: 0,
      isLateApproved: Boolean(record.isLateApproved),
      approvedLateMinutes: 0,
      unapprovedLateMinutes: 0,
      afterSixMinutes: 0,
      coveredLateMinutes: 0,
      leaveCoverMinutes: 0,
    };
  }

  if (!record.inTime) {
    return {
      ...record,
      holidayType: effectiveHolidayType,
      earlyTime: 0,
      workedHours: 0,
      pendingHours: targetRequiredHours,
      lateMinutes: 0,
      isLateApproved: Boolean(record.isLateApproved),
      approvedLateMinutes: 0,
      unapprovedLateMinutes: 0,
      afterSixMinutes: 0,
      coveredLateMinutes: 0,
      leaveCoverMinutes: 0,
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
    // Past day and user forgot to clock out - default to 1:00 PM for after-lunch half day, else 6:15 PM (18:15)
    const defaultOutHourStr = effectiveHolidayType === 'half-after-lunch' ? '13:00:00' : '18:15:00';
    const defaultOut = new Date(`${record.date}T${defaultOutHourStr}`);
    outTime = defaultOut;
    outTimeStr = defaultOut.toISOString();
    isAutoClockedOut = true;
  }

  // PREVIOUS MONTH CALCULATION (Pre-October 2026): Standard rules without 6 PM cap or late salary cuts
  if (!isNewPolicyActive) {
    const nineAm = new Date(`${record.date}T09:00:00`);
    let earlyMinutes = 0;
    if (inTime.getTime() < nineAm.getTime()) {
      const earlyEnd = Math.min(outTime.getTime(), nineAm.getTime());
      if (earlyEnd > inTime.getTime()) {
        earlyMinutes = (earlyEnd - inTime.getTime()) / 60000;
      }
    }
    const effectiveStartTime = inTime.getTime() < nineAm.getTime() ? nineAm : inTime;
    let elapsedMs = 0;
    if (outTime.getTime() > effectiveStartTime.getTime()) {
      elapsedMs = outTime.getTime() - effectiveStartTime.getTime();
    }

    const lunchStart = new Date(`${record.date}T13:00:00`);
    const lunchEnd = new Date(`${record.date}T14:00:00`);
    let lunchOverlapMs = 0;
    if (!isHalfDay && !isFullHoliday) {
      const overlapStart = new Date(Math.max(effectiveStartTime.getTime(), lunchStart.getTime()));
      const overlapEnd = new Date(Math.min(outTime.getTime(), lunchEnd.getTime()));
      if (overlapStart.getTime() < overlapEnd.getTime()) {
        lunchOverlapMs = overlapEnd.getTime() - overlapStart.getTime();
      }
    }
    const lunchDeductionMinutes = lunchOverlapMs / 60000;

    let totalRestMinutes = record.restTimeTotal || 0;
    if (record.activeRestStart) {
      const restStart = new Date(record.activeRestStart);
      const restEnd = record.outTime ? new Date(record.outTime) : new Date(nowStr || new Date().toISOString());
      const activeRestMs = restEnd.getTime() - restStart.getTime();
      if (activeRestMs > 0) {
        totalRestMinutes += activeRestMs / 60000;
      }
    }

    const allowedRest = record.allowedRestLimit !== undefined ? record.allowedRestLimit : defaultAllowedRest;
    const excessRestMinutes = Math.max(0, totalRestMinutes - allowedRest);
    const excessRestMs = excessRestMinutes * 60 * 1000;

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
        let lunchOverlap = 0;
        if (!isHalfDay && !isFullHoliday) {
          const lunchOverlapStart = Math.max(sStart, lunchStart.getTime());
          const lunchOverlapEnd = Math.min(sEnd, lunchEnd.getTime());
          lunchOverlap = Math.max(0, lunchOverlapEnd - lunchOverlapStart);
        }
        const netLeaveMs = Math.max(0, (sEnd - sStart) - lunchOverlap);
        totalNetShortLeaveMins += netLeaveMs / 60000;

        const winStart = Math.max(effectiveStartTime.getTime(), sStart);
        const winEnd = Math.min(outTime.getTime(), sEnd);
        if (winEnd > winStart) {
          let spanMs = winEnd - winStart;
          if (!isHalfDay && !isFullHoliday) {
            const lunchWinStart = Math.max(winStart, lunchStart.getTime());
            const lunchWinEnd = Math.min(winEnd, lunchEnd.getTime());
            if (lunchWinEnd > lunchWinStart) {
              spanMs -= (lunchWinEnd - lunchWinStart);
            }
          }
          shortLeaveDeductionMs += Math.max(0, spanMs);
        }
      }
    });

    const netWorkedMs = Math.max(0, elapsedMs - lunchOverlapMs - excessRestMs - shortLeaveDeductionMs);
    const workedHours = netWorkedMs / (1000 * 60 * 60);
    const pendingHours = targetRequiredHours - workedHours;

    return {
      ...record,
      holidayType: effectiveHolidayType,
      outTime: outTimeStr,
      isAutoClockedOut,
      earlyTime: parseFloat(earlyMinutes.toFixed(2)),
      lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
      shortLeaveTotal: Math.round(totalNetShortLeaveMins),
      workedHours: parseFloat(workedHours.toFixed(2)),
      pendingHours: parseFloat(pendingHours.toFixed(2)),
      lateMinutes: 0,
      isLateApproved: false,
      approvedLateMinutes: 0,
      unapprovedLateMinutes: 0,
      afterSixMinutes: 0,
      coveredLateMinutes: 0,
      leaveCoverMinutes: 0,
    };
  }

  // THIS MONTH CALCULATION (From October 1st, 2026 onwards): Fixed 9:00 AM - 6:00 PM shift
  const shiftStartStr = effectiveHolidayType === 'half-before-lunch' ? '14:00:00' : '09:00:00';
  const shiftEndStr = effectiveHolidayType === 'half-after-lunch' ? '13:00:00' : '18:00:00';
  const shiftStart = new Date(`${record.date}T${shiftStartStr}`);
  const shiftEnd = new Date(`${record.date}T${shiftEndStr}`);

  // Calculate Early Time before shift start (in minutes)
  let earlyMinutes = 0;
  if (inTime.getTime() < shiftStart.getTime()) {
    const earlyEnd = Math.min(outTime.getTime(), shiftStart.getTime());
    if (earlyEnd > inTime.getTime()) {
      earlyMinutes = (earlyEnd - inTime.getTime()) / 60000;
    }
  }

  // Work time always starts from shift start (09:00 AM) if inTime is earlier
  const effectiveStartTime = inTime.getTime() < shiftStart.getTime() ? shiftStart : inTime;

  // Calculate Late Arrival after shift start (09:00 AM)
  let lateMinutes = 0;
  if (inTime.getTime() > shiftStart.getTime()) {
    lateMinutes = Math.round((inTime.getTime() - shiftStart.getTime()) / 60000);
  }

  const isLateApproved = Boolean(record.isLateApproved);
  const approvedLateMinutes = isLateApproved ? lateMinutes : 0;
  const unapprovedLateMinutes = isLateApproved ? 0 : lateMinutes;

  // Regular shift window: [effectiveStartTime, min(outTime, shiftEnd)]
  const regularWindowEnd = new Date(Math.min(outTime.getTime(), shiftEnd.getTime()));
  let regularElapsedMs = 0;
  if (regularWindowEnd.getTime() > effectiveStartTime.getTime()) {
    regularElapsedMs = regularWindowEnd.getTime() - effectiveStartTime.getTime();
  }

  // Calculate Lunch Break (1:00 PM to 2:00 PM) overlap within regular window
  const lunchStart = new Date(`${record.date}T13:00:00`);
  const lunchEnd = new Date(`${record.date}T14:00:00`);

  let lunchOverlapMs = 0;
  if (!isHalfDay && !isFullHoliday) {
    const overlapStart = new Date(Math.max(effectiveStartTime.getTime(), lunchStart.getTime()));
    const overlapEnd = new Date(Math.min(regularWindowEnd.getTime(), lunchEnd.getTime()));

    if (overlapStart.getTime() < overlapEnd.getTime()) {
      lunchOverlapMs = overlapEnd.getTime() - overlapStart.getTime();
    }
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

  // Allowed rest limit
  const allowedRest = record.allowedRestLimit !== undefined ? record.allowedRestLimit : defaultAllowedRest;
  const excessRestMinutes = Math.max(0, totalRestMinutes - allowedRest);
  const excessRestMs = excessRestMinutes * 60 * 1000;

  // Calculate Short Leave Deduction (Not counted as work time) within regular shift window
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
      let lunchOverlap = 0;
      if (!isHalfDay && !isFullHoliday) {
        const lunchOverlapStart = Math.max(sStart, lunchStart.getTime());
        const lunchOverlapEnd = Math.min(sEnd, lunchEnd.getTime());
        lunchOverlap = Math.max(0, lunchOverlapEnd - lunchOverlapStart);
      }
      const netLeaveMs = Math.max(0, (sEnd - sStart) - lunchOverlap);
      totalNetShortLeaveMins += netLeaveMs / 60000;

      // Net deduction within work window [effectiveStartTime, regularWindowEnd]
      const winStart = Math.max(effectiveStartTime.getTime(), sStart);
      const winEnd = Math.min(regularWindowEnd.getTime(), sEnd);
      if (winEnd > winStart) {
        let spanMs = winEnd - winStart;
        if (!isHalfDay && !isFullHoliday) {
          const lunchWinStart = Math.max(winStart, lunchStart.getTime());
          const lunchWinEnd = Math.min(winEnd, lunchEnd.getTime());
          if (lunchWinEnd > lunchWinStart) {
            spanMs -= (lunchWinEnd - lunchWinStart);
          }
        }
        shortLeaveDeductionMs += Math.max(0, spanMs);
      }
    }
  });

  // Base worked ms within the regular shift
  const baseShiftWorkedMs = Math.max(0, regularElapsedMs - lunchOverlapMs - excessRestMs - shortLeaveDeductionMs);

  // Time worked after shiftEnd (6:00 PM / 18:00 for full day)
  let afterSixMinutes = 0;
  if (outTime.getTime() > shiftEnd.getTime()) {
    afterSixMinutes = Math.round((outTime.getTime() - shiftEnd.getTime()) / 60000);
  }

  // Coverage and Leave Deduction calculation:
  let coveredLateMinutes = 0;
  let leaveCoverMinutes = 0;

  if (isLateApproved && approvedLateMinutes > 0) {
    // Approved late arrival: coverable by working after 6:00 PM
    coveredLateMinutes = Math.min(afterSixMinutes, approvedLateMinutes);
    leaveCoverMinutes = Math.max(0, afterSixMinutes - coveredLateMinutes);
  } else {
    // Unapproved late arrival: cuts from salary, cannot be covered.
    // Time worked after 6:00 PM directly deducts from leave hours!
    coveredLateMinutes = 0;
    leaveCoverMinutes = afterSixMinutes;
  }

  // Net worked time includes approved late coverage to reach target required hours
  const coveredLateMs = coveredLateMinutes * 60 * 1000;
  const netWorkedMs = baseShiftWorkedMs + coveredLateMs;
  const workedHours = targetRequiredHours > 0
    ? Math.min(targetRequiredHours, netWorkedMs / (1000 * 60 * 60))
    : (netWorkedMs / (1000 * 60 * 60));
  const pendingHours = Math.max(0, targetRequiredHours - workedHours);

  return {
    ...record,
    holidayType: effectiveHolidayType,
    outTime: outTimeStr,
    isAutoClockedOut,
    earlyTime: parseFloat(earlyMinutes.toFixed(2)),
    lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
    shortLeaveTotal: Math.round(totalNetShortLeaveMins),
    workedHours: parseFloat(workedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
    lateMinutes,
    isLateApproved,
    approvedLateMinutes,
    unapprovedLateMinutes,
    afterSixMinutes,
    coveredLateMinutes,
    leaveCoverMinutes,
  };
}
