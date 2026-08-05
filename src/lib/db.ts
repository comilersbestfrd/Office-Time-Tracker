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
  const index = records.findIndex((r) => r.date === record.date);

  // Recalculate hours before saving if it is completed
  const updatedRecord = calculateRecordHours(record);

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

  for (const record of records) {
    // If the record is currently active, compute temporary values for stats
    const evaluated = record.outTime ? record : calculateRecordHours(record, currentNow);
    const isHoliday = holidays.some((h) => h.date === record.date);

    if (evaluated.status === 'present') {
      presentDays++;
      if (!isHoliday) {
        totalWorkDays++; // Expected to work only if not a holiday
      }
      hoursWorkedTotal += evaluated.workedHours;
    } else if (evaluated.status === 'absent') {
      absentDays++;
      if (!isHoliday) {
        totalWorkDays++; // Expected to work only if not a holiday
      }
    } else if (evaluated.status === 'weekly-off') {
      weeklyOffDays++;
      // Weekly offs don't add to required work days
      // However, if they clocked hours on a weekly off (e.g. weekend work), we add it to hours worked
      if (evaluated.workedHours > 0) {
        hoursWorkedTotal += evaluated.workedHours;
      }
    } else if (evaluated.status === 'holiday') {
      // Holiday status (if manually set)
      if (evaluated.workedHours > 0) {
        hoursWorkedTotal += evaluated.workedHours;
      }
    }
  }

  const requiredHoursTotal = totalWorkDays * 8;
  const pendingHoursTotal = Math.max(0, requiredHoursTotal - hoursWorkedTotal);

  return {
    totalWorkDays,
    presentDays,
    absentDays,
    weeklyOffDays,
    requiredHoursTotal: parseFloat(requiredHoursTotal.toFixed(2)),
    hoursWorkedTotal: parseFloat(hoursWorkedTotal.toFixed(2)),
    pendingHoursTotal: parseFloat((requiredHoursTotal - hoursWorkedTotal).toFixed(2)),
  };
}

// Clear all records
export async function clearRecords(): Promise<void> {
  await ensureDb();
  await fs.writeFile(DB_PATH, '[]', 'utf8');
}
