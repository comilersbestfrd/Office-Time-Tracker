import fs from 'fs/promises';
import path from 'path';
import { RecordSession, DayRecord, DashboardStats, calculateRecordHours, Holiday } from './calculations';

const DB_PATH = path.join(process.cwd(), 'data', 'records.json');
const HOLIDAYS_PATH = path.join(process.cwd(), 'data', 'holidays.json');

// Helper to ensure database directory and file exist
async function ensureDb() {
  const dir = path.dirname(DB_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
  try {
    await fs.access(DB_PATH);
  } catch (err) {
    await fs.writeFile(DB_PATH, '[]', 'utf8');
  }
}

// Get all records, sorted by date ascending
export async function getRecords(): Promise<DayRecord[]> {
  await ensureDb();
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    const records: DayRecord[] = JSON.parse(data);
    return records.sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error('Error reading records db:', error);
    return [];
  }
}

// Save a record (inserts or updates)
export async function saveRecord(record: DayRecord): Promise<DayRecord> {
  await ensureDb();
  const records = await getRecords();
  const holidays = await getHolidays();
  const holiday = holidays.find((h) => h.date === record.date);
  const index = records.findIndex((r) => r.date === record.date);

  // Recalculate hours before saving if it is completed
  const updatedRecord = calculateRecordHours(record, undefined, undefined, holiday);

  if (index >= 0) {
    records[index] = updatedRecord;
  } else {
    records.push(updatedRecord);
  }

  await fs.writeFile(DB_PATH, JSON.stringify(records, null, 2), 'utf8');
  return updatedRecord;
}

// Get a record by date
export async function getRecordByDate(date: string): Promise<DayRecord | null> {
  const records = await getRecords();
  return records.find((r) => r.date === date) || null;
}

// Delete a record by date
export async function deleteRecord(date: string): Promise<boolean> {
  await ensureDb();
  const records = await getRecords();
  const filtered = records.filter((r) => r.date !== date);
  if (filtered.length === records.length) return false;
  await fs.writeFile(DB_PATH, JSON.stringify(filtered, null, 2), 'utf8');
  return true;
}

// Ensure holidays database exists
async function ensureHolidaysDb() {
  const dir = path.dirname(HOLIDAYS_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
  try {
    await fs.access(HOLIDAYS_PATH);
  } catch (err) {
    await fs.writeFile(HOLIDAYS_PATH, '[]', 'utf8');
  }
}

// Get all holidays, sorted by date ascending
export async function getHolidays(): Promise<Holiday[]> {
  await ensureHolidaysDb();
  try {
    const data = await fs.readFile(HOLIDAYS_PATH, 'utf8');
    const holidays: Holiday[] = JSON.parse(data);
    return holidays.sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error('Error reading holidays db:', error);
    return [];
  }
}

// Save a holiday (inserts or updates)
export async function saveHoliday(holiday: Holiday): Promise<Holiday> {
  await ensureHolidaysDb();
  const holidays = await getHolidays();
  const index = holidays.findIndex((h) => h.date === holiday.date);

  if (index >= 0) {
    holidays[index] = holiday;
  } else {
    holidays.push(holiday);
  }

  await fs.writeFile(HOLIDAYS_PATH, JSON.stringify(holidays, null, 2), 'utf8');
  return holiday;
}

// Delete a holiday by date
export async function deleteHoliday(date: string): Promise<boolean> {
  await ensureHolidaysDb();
  const holidays = await getHolidays();
  const filtered = holidays.filter((h) => h.date !== date);
  if (filtered.length === holidays.length) return false;
  await fs.writeFile(HOLIDAYS_PATH, JSON.stringify(filtered, null, 2), 'utf8');
  return true;
}

// Get aggregate stats
export async function getStats(nowStr?: string): Promise<DashboardStats> {
  const records = await getRecords();
  const holidays = await getHolidays();
  const currentNow = nowStr || new Date().toISOString();

  let totalWorkDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let weeklyOffDays = 0;
  let hoursWorkedTotal = 0;
  let pendingHoursTotal = 0;
  let totalLateMinutes = 0;
  let unapprovedLateMinutesTotal = 0;
  let approvedLateMinutesTotal = 0;
  let coveredLateMinutesTotal = 0;
  let afterSixMinutesTotal = 0;
  let leaveCoverMinutesTotal = 0;
  let leaveHoursTotal = 0;

  for (const record of records) {
    const holiday = holidays.find((h) => h.date === record.date);
    const holidayType = record.holidayType || holiday?.type;
    const isHalfDay = holidayType === 'half-before-lunch' || holidayType === 'half-after-lunch';
    const isFullHoliday = holidayType === 'full' || (!holidayType && (!!holiday || record.status === 'holiday'));

    // If the record is currently active, compute temporary values for stats
    const evaluated = record.outTime ? record : calculateRecordHours(record, currentNow, undefined, holiday);

    if (evaluated.status === 'present') {
      presentDays++;
      if (isHalfDay) {
        totalWorkDays += 0.5; // Expected half working day (4h)
        pendingHoursTotal += (evaluated.pendingHours !== undefined ? evaluated.pendingHours : 0);
      } else if (!isFullHoliday) {
        totalWorkDays += 1; // Expected full working day (8h)
        pendingHoursTotal += (evaluated.pendingHours !== undefined ? evaluated.pendingHours : 0);
      }
      hoursWorkedTotal += evaluated.workedHours;
      totalLateMinutes += evaluated.lateMinutes || 0;
      unapprovedLateMinutesTotal += evaluated.unapprovedLateMinutes || 0;
      approvedLateMinutesTotal += evaluated.approvedLateMinutes || 0;
      coveredLateMinutesTotal += evaluated.coveredLateMinutes || 0;
      afterSixMinutesTotal += evaluated.afterSixMinutes || 0;
      leaveCoverMinutesTotal += evaluated.leaveCoverMinutes || 0;
    } else if (evaluated.status === 'absent') {
      absentDays++;
      if (isHalfDay) {
        totalWorkDays += 0.5;
        pendingHoursTotal += 4;
        leaveHoursTotal += 4;
      } else if (!isFullHoliday) {
        totalWorkDays += 1;
        pendingHoursTotal += 8;
        leaveHoursTotal += 8;
      }
    } else if (evaluated.status === 'weekly-off') {
      weeklyOffDays++;
      if (evaluated.workedHours > 0) {
        hoursWorkedTotal += evaluated.workedHours;
      }
    } else if (evaluated.status === 'holiday') {
      if (isHalfDay) {
        totalWorkDays += 0.5;
        if (evaluated.workedHours > 0) {
          hoursWorkedTotal += evaluated.workedHours;
          pendingHoursTotal += (evaluated.pendingHours !== undefined ? evaluated.pendingHours : (4 - evaluated.workedHours));
        } else {
          pendingHoursTotal += 4;
        }
      } else {
        if (evaluated.workedHours > 0) {
          hoursWorkedTotal += evaluated.workedHours;
        }
      }
    }
  }

  const requiredHoursTotal = totalWorkDays * 8;
  const leaveCoverHoursTotal = parseFloat((leaveCoverMinutesTotal / 60).toFixed(2));
  const remainingLeaveHours = Math.max(0, parseFloat((leaveHoursTotal - leaveCoverHoursTotal).toFixed(2)));

  return {
    totalWorkDays,
    presentDays,
    absentDays,
    weeklyOffDays,
    requiredHoursTotal: parseFloat(requiredHoursTotal.toFixed(2)),
    hoursWorkedTotal: parseFloat(hoursWorkedTotal.toFixed(2)),
    pendingHoursTotal: parseFloat(pendingHoursTotal.toFixed(2)),
    totalLateMinutes,
    unapprovedLateMinutesTotal,
    approvedLateMinutesTotal,
    coveredLateMinutesTotal,
    afterSixMinutesTotal,
    leaveHoursTotal,
    leaveCoverHoursTotal,
    remainingLeaveHours,
  };
}

// Clear all records
export async function clearRecords(): Promise<void> {
  await ensureDb();
  await fs.writeFile(DB_PATH, '[]', 'utf8');
}
