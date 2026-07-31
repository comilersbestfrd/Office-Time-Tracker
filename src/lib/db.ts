import fs from 'fs/promises';
import path from 'path';

export interface RecordSession {
  start: string; // ISO string
  end: string | null; // ISO string, null if active
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'weekly-off';
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

export interface DashboardStats {
  totalWorkDays: number;     // Expected working days (present + absent)
  presentDays: number;       // Number of days present
  absentDays: number;        // Number of days absent
  weeklyOffDays: number;     // Number of weekly offs (Sundays)
  requiredHoursTotal: number;// Expected hours (totalWorkDays * 8)
  hoursWorkedTotal: number;  // Hours actually worked
  pendingHoursTotal: number; // requiredHoursTotal - hoursWorkedTotal
}

const DB_PATH = path.join(process.cwd(), 'data', 'records.json');

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

// Calculate hours for a single day record
export function calculateRecordHours(record: DayRecord, nowStr?: string): DayRecord {
  if (record.status !== 'present') {
    return {
      ...record,
      workedHours: 0,
      pendingHours: 0, // Weekly off and Absent don't accumulate worked hours on the day itself (absent pending is calculated in stats)
    };
  }

  if (!record.inTime) {
    return {
      ...record,
      workedHours: 0,
      pendingHours: 8,
    };
  }

  const inTime = new Date(record.inTime);
  const outTime = record.outTime ? new Date(record.outTime) : new Date(nowStr || new Date().toISOString());

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
    lunchDeduction: parseFloat(lunchDeductionMinutes.toFixed(2)),
    workedHours: parseFloat(workedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
  };
}

// Get aggregate stats
export async function getStats(nowStr?: string): Promise<DashboardStats> {
  const records = await getRecords();
  const currentNow = nowStr || new Date().toISOString();

  let totalWorkDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let weeklyOffDays = 0;
  let hoursWorkedTotal = 0;

  for (const record of records) {
    // If the record is currently active, compute temporary values for stats
    const evaluated = record.outTime ? record : calculateRecordHours(record, currentNow);

    if (evaluated.status === 'present') {
      presentDays++;
      totalWorkDays++; // Expected to work
      hoursWorkedTotal += evaluated.workedHours;
    } else if (evaluated.status === 'absent') {
      absentDays++;
      totalWorkDays++; // Expected to work, but missed
    } else if (evaluated.status === 'weekly-off') {
      weeklyOffDays++;
      // Weekly offs don't add to required work days
      // However, if they clocked hours on a weekly off (e.g. weekend work), we add it to hours worked
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
