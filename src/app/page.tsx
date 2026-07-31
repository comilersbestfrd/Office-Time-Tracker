'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { auth, db, googleProvider } from '@/lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, onValue, set, get } from 'firebase/database';

const ADMIN_EMAIL = 'woxxinsolution12@gmail.com';

interface RecordSession {
  start: string;
  end: string | null;
}

interface DayRecord {
  date: string;
  status: 'present' | 'absent' | 'weekly-off';
  inTime: string | null;
  outTime: string | null;
  restSessions: RecordSession[];
  restTimeTotal: number;
  activeRestStart: string | null;
  workedHours: number;
  pendingHours: number;
  lunchDeduction?: number;
  notes?: string;
}

interface DashboardStats {
  totalWorkDays: number;
  presentDays: number;
  absentDays: number;
  weeklyOffDays: number;
  requiredHoursTotal: number;
  hoursWorkedTotal: number;
  pendingHoursTotal: number;
}

export default function Home() {
  const router = useRouter();
  // Data States
  const [records, setRecords] = useState<DayRecord[]>([]);
  const recordsRef = useRef<DayRecord[]>([]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkDays: 0,
    presentDays: 0,
    absentDays: 0,
    weeklyOffDays: 0,
    requiredHoursTotal: 0,
    hoursWorkedTotal: 0,
    pendingHoursTotal: 0,
  });

  // Ticking Clock States
  const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
  const [liveWorkedTime, setLiveWorkedTime] = useState<string>('00:00:00');
  const [liveRestTime, setLiveRestTime] = useState<string>('00:00:00');
  const [liveRestMins, setLiveRestMins] = useState<number>(0);
  const [liveWorkedHoursDecimal, setLiveWorkedHoursDecimal] = useState<number>(0);

  // Scheduler States
  const [scheduledOutTime, setScheduledOutTime] = useState<Date | null>(null);
  const [scheduledBreakTime, setScheduledBreakTime] = useState<Date | null>(null);

  // Auth States
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Username onboarding states
  const [customUsername, setCustomUsername] = useState<string>('');
  const [showUsernameModal, setShowUsernameModal] = useState<boolean>(false);
  const [usernameInput, setUsernameInput] = useState<string>('');
  const [usernameSaving, setUsernameSaving] = useState<boolean>(false);

  // UI/Modal States
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalDate, setModalDate] = useState<string>('');
  const [modalStatus, setModalStatus] = useState<'present' | 'absent' | 'weekly-off'>('present');
  const [modalInTime, setModalInTime] = useState<string>('09:00');
  const [modalOutTime, setModalOutTime] = useState<string>('17:20');
  const [modalRestTime, setModalRestTime] = useState<number>(20);
  const [modalRestSessions, setModalRestSessions] = useState<RecordSession[]>([]);
  const [newBreakStart, setNewBreakStart] = useState<string>('');
  const [newBreakEnd, setNewBreakEnd] = useState<string>('');
  const [modalNotes, setModalNotes] = useState<string>('');

  // Tab & Date Filter States
  const [activeTab, setActiveTab] = useState<'today' | 'stats'>('today');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep refs of actions updated to avoid stale closure issues in the mount interval
  const handleClockOutRef = useRef<(() => Promise<void>) | null>(null);
  const handleStartRestRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    handleClockOutRef.current = handleClockOut;
    handleStartRestRef.current = handleStartRest;
  });

  // Helper: Get local date string YYYY-MM-DD
  const getTodayDateString = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const todayStr = getTodayDateString();
  const todayRecord = records.find((r) => r.date === todayStr);
  const modalRecord = records.find((r) => r.date === modalDate);

  // Fetch local data (when signed out / offline)
  const fetchLocalData = async () => {
    try {
      const recordsRes = await fetch('/api/records');
      const recordsData: DayRecord[] = await recordsRes.json();
      setRecords(recordsData);

      const statsRes = await fetch('/api/stats');
      const statsData: DashboardStats = await statsRes.json();
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching local data:', error);
    }
  };

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        // Check if user already has a username
        try {
          const profileRef = ref(db, `users/${currentUser.uid}/profile`);
          const snapshot = await get(profileRef);
          const existingProfile = snapshot.val();

          if (existingProfile?.username) {
            // User already has a username, just update lastLogin
            setCustomUsername(existingProfile.username);
            await set(profileRef, {
              ...existingProfile,
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              lastLogin: new Date().toISOString(),
            });
          } else {
            // New user — show username modal
            setShowUsernameModal(true);
            // Save basic profile immediately
            await set(profileRef, {
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              lastLogin: new Date().toISOString(),
              username: '',
            });
          }
        } catch (e) {
          console.warn('Could not check/save profile:', e);
        }
      } else {
        setCustomUsername('');
        setShowUsernameModal(false);
        fetchLocalData();
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen to Firebase Realtime Database when logged in
  useEffect(() => {
    if (!user) return;

    const recordsDbRef = ref(db, `records/${user.uid}`);
    const unsubscribe = onValue(recordsDbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: DayRecord[] = Object.values(data);
        const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
        setRecords(sorted);
      } else {
        setRecords([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    setCurrentDateTime(new Date());

    // Initialize date filters to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    setFilterStartDate(getTodayDateString(firstDay));
    setFilterEndDate(getTodayDateString(today));

    // Load scheduled actions from localStorage on mount
    const savedOut = localStorage.getItem('scheduledOutTime');
    const savedBreak = localStorage.getItem('scheduledBreakTime');
    if (savedOut) setScheduledOutTime(new Date(savedOut));
    if (savedBreak) setScheduledBreakTime(new Date(savedBreak));

    const clockInterval = setInterval(() => {
      const now = new Date();
      setCurrentDateTime(now);

      // Check scheduled clock out
      const localSavedOut = localStorage.getItem('scheduledOutTime');
      if (localSavedOut) {
        const target = new Date(localSavedOut);
        if (now.getTime() >= target.getTime()) {
          localStorage.removeItem('scheduledOutTime');
          setScheduledOutTime(null);
          if (handleClockOutRef.current) {
            handleClockOutRef.current();
          }
        }
      }

      // Check scheduled break
      const localSavedBreak = localStorage.getItem('scheduledBreakTime');
      if (localSavedBreak) {
        const target = new Date(localSavedBreak);
        if (now.getTime() >= target.getTime()) {
          localStorage.removeItem('scheduledBreakTime');
          setScheduledBreakTime(null);
          if (handleStartRestRef.current) {
            handleStartRestRef.current();
          }
        }
      }
    }, 1000);

    // Global keyboard shortcut handler for 'R' to toggle break
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        const todayStrLocal = getTodayDateString();
        const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);

        if (freshTodayRecord && freshTodayRecord.status === 'present' && !freshTodayRecord.outTime) {
          if (!freshTodayRecord.activeRestStart) {
            handleStartRest();
          } else {
            handleEndRest();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(clockInterval);
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const setPresetRange = (preset: 'this-month' | 'last-30' | 'all') => {
    const today = new Date();
    if (preset === 'this-month') {
      setFilterStartDate(getTodayDateString(new Date(today.getFullYear(), today.getMonth(), 1)));
      setFilterEndDate(getTodayDateString(today));
    } else if (preset === 'last-30') {
      const past30 = new Date();
      past30.setDate(today.getDate() - 30);
      setFilterStartDate(getTodayDateString(past30));
      setFilterEndDate(getTodayDateString(today));
    } else if (preset === 'all') {
      if (records.length > 0) {
        setFilterStartDate(records[0].date);
      } else {
        setFilterStartDate('2026-01-01');
      }
      setFilterEndDate(getTodayDateString(today));
    }
  };

  // Sync active timers when records or currentDateTime updates
  useEffect(() => {
    if (!todayRecord || todayRecord.status !== 'present' || !todayRecord.inTime || todayRecord.outTime) {
      // Not clocked in or already clocked out
      setLiveWorkedTime('00:00:00');
      setLiveRestTime('00:00:00');
      setLiveRestMins(0);
      setLiveWorkedHoursDecimal(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const updateTimers = () => {
      const now = new Date();
      const inTime = new Date(todayRecord.inTime!);
      
      // Calculate Rest Time
      let totalRestMs = todayRecord.restTimeTotal * 60 * 1000;
      if (todayRecord.activeRestStart) {
        const restStart = new Date(todayRecord.activeRestStart);
        totalRestMs += now.getTime() - restStart.getTime();
      }

      // Calculate Lunch Break (1:00 PM to 2:00 PM) overlap
      const lunchStart = new Date(`${todayRecord.date}T13:00:00`);
      const lunchEnd = new Date(`${todayRecord.date}T14:00:00`);

      const overlapStart = new Date(Math.max(inTime.getTime(), lunchStart.getTime()));
      const overlapEnd = new Date(Math.min(now.getTime(), lunchEnd.getTime()));

      let lunchOverlapMs = 0;
      if (overlapStart.getTime() < overlapEnd.getTime()) {
        lunchOverlapMs = overlapEnd.getTime() - overlapStart.getTime();
      }

      // Calculate Worked Time
      const elapsedMs = now.getTime() - inTime.getTime();
      const allowedRestMs = 20 * 60 * 1000;
      const excessRestMs = Math.max(0, totalRestMs - allowedRestMs);
      const workedMs = Math.max(0, elapsedMs - lunchOverlapMs - excessRestMs);

      // Convert to display strings
      setLiveWorkedTime(formatMsToHMS(workedMs));
      setLiveRestTime(formatMsToHMS(totalRestMs));
      setLiveRestMins(totalRestMs / (60 * 1000));
      setLiveWorkedHoursDecimal(workedMs / (3600 * 1000));
    };

    updateTimers(); // Run once immediately

    // Reset the interval to point to the fresh closure with updated record data
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(updateTimers, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [todayRecord]);

  // Formatter: Milliseconds to HH:MM:SS
  const formatMsToHMS = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  // Formatter: Decimal Hours to "X Hours Y Mins"
  const formatHoursToText = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  // Formatter: ISO DateTime to local string (HH:MM AM/PM)
  const formatISOToTime = (isoString: string | null): string => {
    if (!isoString) return '--:--';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Scheduler Actions
  const scheduleOut = (mins: number) => {
    const target = new Date(Date.now() + mins * 60 * 1000);
    setScheduledOutTime(target);
    localStorage.setItem('scheduledOutTime', target.toISOString());
  };

  const cancelScheduleOut = () => {
    setScheduledOutTime(null);
    localStorage.removeItem('scheduledOutTime');
  };

  const scheduleBreak = (secs: number) => {
    const target = new Date(Date.now() + secs * 1000);
    setScheduledBreakTime(target);
    localStorage.setItem('scheduledBreakTime', target.toISOString());
  };

  const cancelScheduleBreak = () => {
    setScheduledBreakTime(null);
    localStorage.removeItem('scheduledBreakTime');
  };

  const getCountdownSeconds = (target: Date | null): number => {
    if (!target) return 0;
    const diff = target.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 1000));
  };

  const getCountdownHMS = (target: Date | null): string => {
    if (!target) return '00:00';
    const diff = target.getTime() - Date.now();
    const totalSecs = Math.max(0, Math.ceil(diff / 1000));
    const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Clock Actions
  const handleClockIn = async () => {
    const dateStr = getTodayDateString();
    const newRecord: DayRecord = {
      date: dateStr,
      status: 'present',
      inTime: new Date().toISOString(),
      outTime: null,
      restSessions: [],
      restTimeTotal: 0,
      activeRestStart: null,
      workedHours: 0,
      pendingHours: 8,
    };

    await saveRecordApi(newRecord);
  };

  const handleStartRest = async () => {
    cancelScheduleBreak();
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord) return;
    const updatedRecord: DayRecord = {
      ...freshTodayRecord,
      activeRestStart: new Date().toISOString(),
    };

    await saveRecordApi(updatedRecord);
  };

  const handleEndRest = async () => {
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord || !freshTodayRecord.activeRestStart) return;
    const now = new Date();
    const start = new Date(freshTodayRecord.activeRestStart);
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.max(0, diffMs / 60000);

    const newSession: RecordSession = {
      start: freshTodayRecord.activeRestStart,
      end: now.toISOString(),
    };

    const updatedRecord: DayRecord = {
      ...freshTodayRecord,
      activeRestStart: null,
      restTimeTotal: (freshTodayRecord.restTimeTotal || 0) + diffMins,
      restSessions: [...(freshTodayRecord.restSessions || []), newSession],
    };

    await saveRecordApi(updatedRecord);
  };

  const handleClockOut = async () => {
    cancelScheduleOut();
    cancelScheduleBreak();
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord) return;
    let updatedRecord = { ...freshTodayRecord };

    // If currently resting, end the rest session first
    if (updatedRecord.activeRestStart) {
      const now = new Date();
      const start = new Date(updatedRecord.activeRestStart);
      const diffMs = now.getTime() - start.getTime();
      const diffMins = Math.max(0, diffMs / 60000);

      const newSession: RecordSession = {
        start: updatedRecord.activeRestStart,
        end: now.toISOString(),
      };

      updatedRecord.activeRestStart = null;
      updatedRecord.restTimeTotal = (updatedRecord.restTimeTotal || 0) + diffMins;
      updatedRecord.restSessions = [...(updatedRecord.restSessions || []), newSession];
    }

    updatedRecord.outTime = new Date().toISOString();
    await saveRecordApi(updatedRecord);
  };

  const handleMarkAbsentToday = async () => {
    const dateStr = getTodayDateString();
    const newRecord: DayRecord = {
      date: dateStr,
      status: 'absent',
      inTime: null,
      outTime: null,
      restSessions: [],
      restTimeTotal: 0,
      activeRestStart: null,
      workedHours: 0,
      pendingHours: 8,
    };

    await saveRecordApi(newRecord);
  };

  const handleResumeShift = async () => {
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord) return;

    const updatedRecord: DayRecord = {
      ...freshTodayRecord,
      outTime: null,
    };

    await saveRecordApi(updatedRecord);
  };

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  const handleSaveUsername = async () => {
    if (!user || !usernameInput.trim()) return;
    setUsernameSaving(true);
    try {
      const profileRef = ref(db, `users/${user.uid}/profile`);
      const snapshot = await get(profileRef);
      const existingProfile = snapshot.val() || {};
      await set(profileRef, {
        ...existingProfile,
        username: usernameInput.trim(),
      });
      setCustomUsername(usernameInput.trim());
      setShowUsernameModal(false);
      setUsernameInput('');
    } catch (e) {
      console.error('Error saving username:', e);
    } finally {
      setUsernameSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const sanitizeForFirebase = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (Array.isArray(obj)) {
      return obj.map(sanitizeForFirebase);
    }
    if (typeof obj === 'object') {
      const res: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          res[key] = sanitizeForFirebase(obj[key]);
        }
      }
      return res;
    }
    return obj;
  };

  const saveRecordApi = async (record: DayRecord) => {
    if (user) {
      try {
        const recordRef = ref(db, `records/${user.uid}/${record.date}`);
        const sanitized = sanitizeForFirebase(record);
        await set(recordRef, sanitized);
      } catch (error: any) {
        console.error('Error saving record to Firebase:', error);
        alert(`Failed to save record to Firebase: ${error.message}\n\nPlease check your Firebase Realtime Database Rules (read/write permissions).`);
      }
    } else {
      try {
        const res = await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
        if (res.ok) {
          await fetchLocalData();
        } else {
          console.error('Failed to save record via API');
        }
      } catch (error) {
        console.error('Error saving record locally:', error);
      }
    }
  };

  const handleDeleteRecord = async (date: string) => {
    if (!confirm(`Are you sure you want to delete the record for ${date}?`)) return;
    if (user) {
      try {
        const recordRef = ref(db, `records/${user.uid}/${date}`);
        await set(recordRef, null);
      } catch (error: any) {
        console.error('Error deleting record from Firebase:', error);
        alert(`Failed to delete record from Firebase: ${error.message}`);
      }
    } else {
      try {
        const res = await fetch(`/api/records/${date}`, { method: 'DELETE' });
        if (res.ok) {
          await fetchLocalData();
        }
      } catch (error) {
        console.error('Error deleting record locally:', error);
      }
    }
  };

  const handleClearAllData = async () => {
    if (
      !confirm(
        "⚠️ WARNING: This will permanently delete ALL logged attendance records and break history, and start fresh. This action CANNOT be undone!\n\nAre you sure you want to proceed?"
      )
    ) {
      return;
    }

    if (user) {
      try {
        const recordsRef = ref(db, `records/${user.uid}`);
        await set(recordsRef, null);
        alert("Cloud database cleared successfully!");
      } catch (error: any) {
        console.error('Error clearing Firebase database:', error);
        alert(`Failed to clear cloud database: ${error.message}`);
      }
    } else {
      try {
        const res = await fetch('/api/records', { method: 'DELETE' });
        if (res.ok) {
          alert("Local database cleared successfully! Starting fresh.");
          await fetchLocalData();
        } else {
          alert("Failed to clear local database.");
        }
      } catch (err) {
        console.error("Error resetting local data:", err);
        alert("An error occurred while clearing local data.");
      }
    }
  };

  // Open modal for editing or new log entry
  const openEditModal = (dateStr: string) => {
    const record = records.find((r) => r.date === dateStr);
    setModalDate(dateStr);
    
    // Clear new break inputs
    setNewBreakStart('');
    setNewBreakEnd('');
    
    if (record) {
      setModalStatus(record.status);
      setModalRestTime(Math.round(record.restTimeTotal));
      setModalRestSessions(record.restSessions || []);
      setModalNotes(record.notes || '');

      if (record.status === 'present' && record.inTime) {
        const inDate = new Date(record.inTime);
        setModalInTime(
          `${String(inDate.getHours()).padStart(2, '0')}:${String(inDate.getMinutes()).padStart(2, '0')}`
        );
        
        if (record.outTime) {
          const outDate = new Date(record.outTime);
          setModalOutTime(
            `${String(outDate.getHours()).padStart(2, '0')}:${String(outDate.getMinutes()).padStart(2, '0')}`
          );
        } else {
          setModalOutTime(''); // Blank if currently working
        }
      } else {
        setModalInTime('09:00');
        setModalOutTime('17:20');
      }
    } else {
      // Pre-populate empty day
      setModalStatus(new Date(dateStr).getDay() === 0 ? 'weekly-off' : 'present');
      setModalInTime('09:00');
      setModalOutTime('17:20');
      setModalRestTime(20);
      setModalRestSessions([]);
      setModalNotes('');
    }
    
    setShowModal(true);
  };

  const handleAddModalBreak = () => {
    if (!newBreakStart || !newBreakEnd) {
      alert("Please specify both start and end times for the break!");
      return;
    }

    const localStartStr = `${modalDate}T${newBreakStart}:00`;
    const localEndStr = `${modalDate}T${newBreakEnd}:00`;

    let startDate = new Date(localStartStr);
    let endDate = new Date(localEndStr);

    // Handle overnight shift if End Time is smaller than Start Time
    if (endDate.getTime() < startDate.getTime()) {
      endDate.setDate(endDate.getDate() + 1);
    }

    const durationMins = (endDate.getTime() - startDate.getTime()) / 60000;
    if (durationMins <= 0) {
      alert("Break end time must be after the start time!");
      return;
    }

    const newSession: RecordSession = {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    };

    const updatedSessions = [...modalRestSessions, newSession];
    setModalRestSessions(updatedSessions);
    
    // Update modalRestTime total
    let totalMins = 0;
    updatedSessions.forEach((s) => {
      if (s.end) {
        totalMins += (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
      }
    });
    setModalRestTime(Math.round(totalMins));

    // Clear inputs
    setNewBreakStart('');
    setNewBreakEnd('');
  };

  const handleRemoveModalBreak = (indexToRemove: number) => {
    const updatedSessions = modalRestSessions.filter((_, idx) => idx !== indexToRemove);
    setModalRestSessions(updatedSessions);

    let totalMins = 0;
    updatedSessions.forEach((s) => {
      if (s.end) {
        totalMins += (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
      }
    });
    setModalRestTime(Math.round(totalMins));
  };

  // Save Modal Data
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation: No future dates allowed
    const today = new Date();
    const todayStrLocal = getTodayDateString(today);
    if (modalDate > todayStrLocal) {
      alert("You cannot add or edit records for future dates!");
      return;
    }

    let record: DayRecord = {
      date: modalDate,
      status: modalStatus,
      inTime: null,
      outTime: null,
      restSessions: [],
      restTimeTotal: 0,
      activeRestStart: null,
      workedHours: 0,
      pendingHours: modalStatus === 'absent' ? 8 : 0,
      notes: modalNotes,
    };

    if (modalStatus === 'present') {
      const localInStr = `${modalDate}T${modalInTime}:00`;
      const inDate = new Date(localInStr);

      // Validation: No future times allowed
      if (inDate.getTime() > today.getTime()) {
        alert("Clock-in time cannot be in the future!");
        return;
      }

      record.inTime = inDate.toISOString();

      if (modalOutTime) {
        const localOutStr = `${modalDate}T${modalOutTime}:00`;
        let outDate = new Date(localOutStr);

        // Handle overnight shift if Out Time is smaller than In Time
        if (outDate.getTime() < inDate.getTime()) {
          outDate.setDate(outDate.getDate() + 1);
        }

        record.outTime = outDate.toISOString();
      } else {
        if (modalDate !== todayStrLocal) {
          alert("Out Time is required for past dates!");
          return;
        }
        record.outTime = null;
      }

      const existingRecord = records.find((r) => r.date === modalDate);
      record.activeRestStart = existingRecord ? existingRecord.activeRestStart : null;

      if (modalRestSessions.length > 0) {
        record.restSessions = modalRestSessions;
        record.restTimeTotal = modalRestTime;
      } else if (modalRestTime > 0) {
        record.restTimeTotal = modalRestTime;
        // Synthesize a single rest session representing manual rest input
        record.restSessions = [
          {
            start: new Date(inDate.getTime() + 60000).toISOString(),
            end: new Date(inDate.getTime() + (modalRestTime + 1) * 60000).toISOString(),
          },
        ];
      } else {
        record.restSessions = [];
        record.restTimeTotal = 0;
      }
    }

    await saveRecordApi(record);
    setShowModal(false);
  };

  // Calendar Helpers
  const getDaysInMonth = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const result: Date[] = [];
    for (let i = 1; i <= days; i++) {
      result.push(new Date(y, m, i));
    }
    return result;
  };

  const getMonthWeeks = (date: Date) => {
    const days = getDaysInMonth(date);
    const startDay = days[0].getDay(); // 0 is Sunday, 1 is Monday ...
    
    // Convert to 1-indexed for Mon-Sun calendar (0: Monday ... 6: Sunday)
    // Sunday is index 6, Monday is index 0.
    const startOffset = startDay === 0 ? 6 : startDay - 1;
    
    const weeks: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = Array(startOffset).fill(null);

    days.forEach((day) => {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    return weeks;
  };

  const changeMonth = (offset: number) => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(newMonth);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Calendar weeks
  const calendarWeeks = getMonthWeeks(currentMonth);

  // Active status text and styling classes
  let consoleStatusClass = styles.statusOffline;
  let consoleStatusText = 'Not Checked In';
  let clockCardClass = styles.clockCard;

  if (todayRecord) {
    if (todayRecord.status === 'absent') {
      consoleStatusText = 'Absent Today';
    } else if (todayRecord.status === 'weekly-off') {
      consoleStatusText = 'Weekly Off';
    } else if (todayRecord.status === 'present') {
      if (todayRecord.outTime) {
        consoleStatusText = 'Clocked Out';
      } else if (todayRecord.activeRestStart) {
        consoleStatusText = 'On Break';
        consoleStatusClass = styles.statusResting;
        clockCardClass = `${styles.clockCard} ${styles.clockCardActiveRest}`;
      } else {
        consoleStatusText = 'Working';
        consoleStatusClass = styles.statusWorking;
        clockCardClass = `${styles.clockCard} ${styles.clockCardActiveWork}`;
      }
    }
  }

  // Filtered records based on selected date range
  const filteredRecords = records.filter((r) => {
    if (!filterStartDate || !filterEndDate) return true;
    return r.date >= filterStartDate && r.date <= filterEndDate;
  });

  // Calculate dynamic stats for the filtered range
  const getFilteredStats = () => {
    let totalWorkDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let weeklyOffDays = 0;
    let hoursWorkedTotal = 0;

    filteredRecords.forEach((record) => {
      const isToday = record.date === todayStr;
      
      let worked = record.workedHours;
      if (isToday && record.status === 'present' && !record.outTime) {
        worked = liveWorkedHoursDecimal;
      }

      if (record.status === 'present') {
        presentDays++;
        totalWorkDays++;
        hoursWorkedTotal += worked;
      } else if (record.status === 'absent') {
        absentDays++;
        totalWorkDays++;
      } else if (record.status === 'weekly-off') {
        weeklyOffDays++;
        if (worked > 0) {
          hoursWorkedTotal += worked;
        }
      }
    });

    const requiredHoursTotal = totalWorkDays * 8;
    const pendingHoursTotal = requiredHoursTotal - hoursWorkedTotal;

    return {
      totalWorkDays,
      presentDays,
      absentDays,
      weeklyOffDays,
      requiredHoursTotal: parseFloat(requiredHoursTotal.toFixed(2)),
      hoursWorkedTotal: parseFloat(hoursWorkedTotal.toFixed(2)),
      pendingHoursTotal: parseFloat((requiredHoursTotal - hoursWorkedTotal).toFixed(2)),
    };
  };

  const displayStats = getFilteredStats();

  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <header className={`${styles.header} animate-fade-in`}>
        <div className={styles.titleArea}>
          <h1>Office Time Tracker</h1>
          <p>Personal attendance, work hour, and rest interval manager</p>
        </div>
        <div className={styles.headerControls}>
          {/* User Profile / Google Sign-In */}
          {authLoading ? (
            <div className={styles.authLoadingSpinner}>Loading...</div>
          ) : user ? (
            <div className={styles.userProfile}>
              <img src={user.photoURL || '/avatar-placeholder.png'} alt={user.displayName || 'User'} className={styles.userAvatar} />
              <div className={styles.userInfo}>
                <span className={styles.userName}>{customUsername || user.displayName}</span>
                <span className={styles.userEmail}>{user.email}</span>
              </div>
              <button className={styles.btnSignOut} onClick={handleSignOut} title="Sign Out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              </button>
            </div>
          ) : (
            <button className={styles.btnGoogleSignIn} onClick={handleSignIn}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: '8px' }}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              Continue with Google
            </button>
          )}

          {currentDateTime && (
            <div className={styles.liveClock}>
              <span className={styles.pulseDot}></span>
              <span>
                {currentDateTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {currentDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          )}
          <button className={styles.btnReset} onClick={handleClearAllData}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
            Clear Data
          </button>
        </div>
      </header>

      {!user && !authLoading ? (
        <div className={`${styles.landingContainer} animate-fade-in`}>
          <div className={`${styles.glass} ${styles.landingCard}`}>
            <div className={styles.landingIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h2>Track Your Office Time</h2>
            <p>Keep logs of your punches, break times, and worked hours. Access your logs securely from anywhere using your Google Account.</p>
            
            <button className={styles.btnGoogleSignInLarge} onClick={handleSignIn}>
              <svg width="22" height="22" viewBox="0 0 24 24" style={{ marginRight: '12px' }}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              Continue with Google
            </button>

            <div className={styles.landingDetails}>
              <div className={styles.landingDetailItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Real-time cloud database syncing</span>
              </div>
              <div className={styles.landingDetailItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Automatic lunch break overlap deductions</span>
              </div>
              <div className={styles.landingDetailItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Interactive daily history calendar log</span>
              </div>
            </div>
          </div>
        </div>
      ) : authLoading ? (
        <div className={styles.dashboardLoading}>
          <div className={styles.loadingSpinner}></div>
          <p>Connecting securely to database...</p>
        </div>
      ) : (
        <>
          {/* Navigation Tabs */}
      <div className={`${styles.tabNav} animate-fade-in`}>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'today' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('today')}
        >
          ⏱️ Today&apos;s Console
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'stats' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Stats & Historical Logs
        </button>
      </div>
      {/* Admin Dashboard navigation */}
      {user?.email === ADMIN_EMAIL && (
        <button
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => router.push('/admin')}
          style={{ marginLeft: '0.5rem' }}
        >
          🛡️ Admin Dashboard
        </button>
      )}

      {activeTab === 'today' ? (
        /* Main Column Layout for Today */
        <main className={`${styles.singleColumnLayout} animate-fade-in`}>
          {/* Console Controls */}
          <section className={`${styles.clockConsole} ${styles.centeredConsole}`}>
            <div className={`${styles.glass} ${clockCardClass}`}>
            <span className={`${styles.statusIndicator} ${consoleStatusClass}`}>
              {consoleStatusText}
            </span>

            <div className={styles.mainTimer}>
              {todayRecord && todayRecord.status === 'present' && !todayRecord.outTime
                ? liveWorkedTime
                : todayRecord && todayRecord.status === 'present' && todayRecord.outTime
                ? formatHoursToText(todayRecord.workedHours)
                : '00:00:00'}
            </div>

            <div className={styles.timerSub}>
              {todayRecord && todayRecord.status === 'present'
                ? `Clocked In: ${formatISOToTime(todayRecord.inTime)}`
                : 'Clock in to start tracking worked hours'}
            </div>

            {/* Rest Limit Progress Bar */}
            {todayRecord && todayRecord.status === 'present' && (
              <div className={styles.restProgressContainer}>
                <div className={styles.restText}>
                  <span>Rest Time: <strong>{liveRestMins > 0 ? formatHoursToText(liveRestMins / 60) : '0h 00m'}</strong></span>
                  <span>Limit: 20 mins</span>
                </div>
                <div className={styles.restBarWrapper}>
                  <div
                    className={`${styles.restBarFill} ${liveRestMins > 20 ? styles.restLimitExceeded : styles.restLimitOk}`}
                    style={{ width: `${Math.min(100, (liveRestMins / 20) * 100)}%` }}
                  />
                </div>
                {liveRestMins > 20 && (
                  <span className={styles.restText} style={{ color: 'var(--color-absent)', fontWeight: 'bold' }}>
                    ⚠️ Excess Rest (+{Math.round(liveRestMins - 20)}m) is deducted from work hours!
                  </span>
                )}
              </div>
            )}

            <div className={styles.clockButtons}>
              {/* Not clocked in yet */}
              {(!todayRecord || (todayRecord.status !== 'present' && todayRecord.status !== 'absent' && todayRecord.status !== 'weekly-off')) && (
                <>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleClockIn}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                    Clock In
                  </button>
                  <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleMarkAbsentToday}>
                    Mark Absent
                  </button>
                </>
              )}

              {/* Present and tracking */}
              {todayRecord && todayRecord.status === 'present' && !todayRecord.outTime && (
                <>
                  {!todayRecord.activeRestStart ? (
                    <button className={`${styles.btn} ${styles.btnWarning}`} onClick={handleStartRest}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
                      Start Break (Shortcut: R)
                    </button>
                  ) : (
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleEndRest}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6z"/></svg>
                      Resume Work (Shortcut: R)
                    </button>
                  )}
                  
                  <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleClockOut}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                    Leave Today
                  </button>
                </>
              )}

              {/* Already clocked out, or absent, or weekly off */}
              {todayRecord && (todayRecord.outTime || todayRecord.status === 'absent' || todayRecord.status === 'weekly-off') && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Today&apos;s shift is locked. You can manually edit it in the logs or resume working.
                  </div>
                  {todayRecord.status === 'present' && todayRecord.outTime && (
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleResumeShift} style={{ width: '100%' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                      Resume Work
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Scheduled Actions Status / Shortcuts */}
            {todayRecord && todayRecord.status === 'present' && !todayRecord.outTime && (
              <div className={styles.schedulerContainer}>
                {/* Break Scheduler (only if not currently resting) */}
                {!todayRecord.activeRestStart && (
                  <div className={styles.schedulerSection}>
                    {scheduledBreakTime ? (
                      <div className={styles.activeSchedulerRow}>
                        <span>
                          <span className={styles.pulseDotWarning}></span>
                          Auto-Break in <strong>{getCountdownSeconds(scheduledBreakTime)}s</strong>
                        </span>
                        <button className={styles.btnCancelMini} onClick={cancelScheduleBreak}>Cancel</button>
                      </div>
                    ) : (
                      <div className={styles.shortcutRow}>
                        <span className={styles.shortcutLabel}>Break in:</span>
                        <button className={styles.btnShortcut} onClick={() => scheduleBreak(30)}>30s</button>
                        <button className={styles.btnShortcut} onClick={() => scheduleBreak(60)}>60s</button>
                        <button className={styles.btnShortcut} onClick={() => scheduleBreak(90)}>90s</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Leave Scheduler */}
                <div className={styles.schedulerSection}>
                  {scheduledOutTime ? (
                    <div className={styles.activeSchedulerRow}>
                      <span>
                        <span className={styles.pulseDotDanger}></span>
                        Auto-Leave in <strong>{getCountdownHMS(scheduledOutTime)}</strong>
                      </span>
                      <button className={styles.btnCancelMini} onClick={cancelScheduleOut}>Cancel</button>
                    </div>
                  ) : (
                    <div className={styles.shortcutRow}>
                      <span className={styles.shortcutLabel}>Leave in:</span>
                      <button className={styles.btnShortcut} onClick={() => scheduleOut(5)}>5m</button>
                      <button className={styles.btnShortcut} onClick={() => scheduleOut(10)}>10m</button>
                      <button className={styles.btnShortcut} onClick={() => scheduleOut(15)}>15m</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Stats Panel */}
            {todayRecord && todayRecord.status === 'present' && (
              <div className={styles.quickStatsRow}>
                <div className={styles.quickStat}>
                  <div className={styles.quickStatLabel}>Check-In</div>
                  <div className={styles.quickStatVal}>{formatISOToTime(todayRecord.inTime)}</div>
                </div>
                <div className={styles.quickStat}>
                  <div className={styles.quickStatLabel}>Check-Out</div>
                  <div className={styles.quickStatVal}>{formatISOToTime(todayRecord.outTime)}</div>
                </div>
                <div className={styles.quickStat}>
                  <div className={styles.quickStatLabel}>Worked Time</div>
                  <div className={styles.quickStatVal}>
                    {todayRecord.outTime 
                      ? formatHoursToText(todayRecord.workedHours)
                      : formatHoursToText(liveWorkedHoursDecimal)}
                  </div>
                </div>
              </div>
            )}

            {/* Today's Breaks Log */}
            {todayRecord && todayRecord.status === 'present' && ((todayRecord.restSessions && todayRecord.restSessions.length > 0) || todayRecord.activeRestStart) && (
              <div className={styles.todayBreaksContainer}>
                <h4>Today&apos;s Breaks</h4>
                <div className={styles.todayBreaksList}>
                  {(todayRecord.restSessions || []).map((session, idx) => (
                    <div key={idx} className={styles.todayBreakItem}>
                      <span>Break #{idx + 1}</span>
                      <span>
                        {formatISOToTime(session.start)} - {session.end ? formatISOToTime(session.end) : 'Active'}
                        {session.end && ` (${Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60000)}m)`}
                      </span>
                    </div>
                  ))}
                  {todayRecord.activeRestStart && (
                    <div className={styles.todayBreakItem} style={{ borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.03)' }}>
                      <span style={{ color: 'var(--color-warning)' }}>Active Break</span>
                      <span style={{ color: 'var(--color-warning)' }}>
                        {formatISOToTime(todayRecord.activeRestStart)} - Now
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
            <button 
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => openEditModal(todayStr)}
              style={{ width: '100%', marginTop: '1rem' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"/></svg>
              Manual Log Entry / Edit
            </button>
          </section>
        </main>
      ) : (
        /* Stats Dashboard with Date Filter */
        <main className={`${styles.statsDashboard} animate-fade-in`}>
          {/* Date Filter Bar */}
          <div className={`${styles.glass} ${styles.filterBar}`}>
            <div className={styles.filterInputs}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>From:</span>
                <input 
                  type="date" 
                  className={styles.filterInput}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>To:</span>
                <input 
                  type="date" 
                  className={styles.filterInput}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.filterPresets}>
              <button className={styles.presetBtn} onClick={() => setPresetRange('this-month')}>This Month</button>
              <button className={styles.presetBtn} onClick={() => setPresetRange('last-30')}>Last 30 Days</button>
              <button className={styles.presetBtn} onClick={() => setPresetRange('all')}>All Time</button>
            </div>
          </div>
          
          {/* Stats KPI Row */}
          <div className={styles.statsGrid}>
            <div className={`${styles.glass} ${styles.statCard}`}>
              <div className={styles.statCardHeader}>
                <span>Expected Work Days</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className={styles.statValue}>{displayStats.totalWorkDays}</div>
              <div className={styles.statSubtext}>Present: {displayStats.presentDays} | Absent: {displayStats.absentDays}</div>
            </div>

            <div className={`${styles.glass} ${styles.statCard}`}>
              <div className={styles.statCardHeader}>
                <span>Required Hours</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div className={styles.statValue}>{formatHoursToText(displayStats.requiredHoursTotal)}</div>
              <div className={styles.statSubtext}>Based on {displayStats.totalWorkDays} work days (8h/day)</div>
            </div>

            <div className={`${styles.glass} ${styles.statCard}`}>
              <div className={styles.statCardHeader}>
                <span>Hours Worked</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div className={styles.statValue} style={{ color: 'var(--color-present)' }}>
                {formatHoursToText(displayStats.hoursWorkedTotal)}
              </div>
              <div className={styles.statSubtext}>Actual time (rest exceeding 20m deducted)</div>
            </div>

            <div className={`${styles.glass} ${styles.statCard} ${displayStats.pendingHoursTotal > 0 ? styles.statCardPendingPositive : styles.statCardPendingNegative}`}>
              <div className={styles.statCardHeader}>
                <span>{displayStats.pendingHoursTotal >= 0 ? 'Pending Hours' : 'Overtime Hours'}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div 
                className={styles.statValue} 
                style={{ color: displayStats.pendingHoursTotal >= 0 ? 'var(--color-absent)' : 'var(--color-present)' }}
              >
                {formatHoursToText(Math.abs(displayStats.pendingHoursTotal))}
              </div>
              <div className={styles.statSubtext}>
                {displayStats.pendingHoursTotal >= 0 ? 'Hours remaining to meet quota' : 'Extra hours accumulated'}
              </div>
            </div>
          </div>

          {/* Calendar Month View */}
          <div className={`${styles.glass} ${styles.calendarCard}`}>
            <div className={styles.calendarHeader}>
              <div className={styles.calendarTitle}>
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </div>
              <div className={styles.calendarNav}>
                <button className={`${styles.btn} ${styles.btnSecondary}`} style={{ padding: '0.4rem 0.8rem' }} onClick={() => changeMonth(-1)}>
                  ◄
                </button>
                <button className={`${styles.btn} ${styles.btnSecondary}`} style={{ padding: '0.4rem 0.8rem' }} onClick={() => changeMonth(1)}>
                  ►
                </button>
              </div>
            </div>

            <div className={styles.calendarGrid}>
              <div className={styles.weekday}>Mon</div>
              <div className={styles.weekday}>Tue</div>
              <div className={styles.weekday}>Wed</div>
              <div className={styles.weekday}>Thu</div>
              <div className={styles.weekday}>Fri</div>
              <div className={styles.weekday}>Sat</div>
              <div className={styles.weekday}>Sun</div>

              {calendarWeeks.map((week, wIndex) => (
                <React.Fragment key={wIndex}>
                  {week.map((day, dIndex) => {
                    if (!day) {
                      return <div key={`empty-${dIndex}`} className={`${styles.dayCell} ${styles.dayCellEmpty}`} />;
                    }

                    const dateStr = getTodayDateString(day);
                    const isToday = dateStr === todayStr;
                    const record = records.find((r) => r.date === dateStr);
                    const isSunday = day.getDay() === 0;
                    const isOutOfRange = (filterStartDate && dateStr < filterStartDate) || (filterEndDate && dateStr > filterEndDate);
                    const isFuture = dateStr > todayStr;

                    let statusClass = '';
                    let label = '';
                    let restLabel = '';

                    if (record) {
                      if (record.status === 'present') {
                        statusClass = styles.dayPresent;
                        label = formatHoursToText(record.workedHours);
                        if (record.restTimeTotal > 0) {
                          restLabel = `Rest: ${Math.round(record.restTimeTotal)}m`;
                        }
                      } else if (record.status === 'absent') {
                        statusClass = styles.dayAbsent;
                        label = 'Absent';
                      } else if (record.status === 'weekly-off') {
                        statusClass = styles.dayWeeklyOff;
                        label = 'Weekly Off';
                      }
                    } else if (isSunday) {
                      statusClass = styles.dayWeeklyOff;
                      label = 'Weekly Off';
                    }

                    return (
                      <div
                        key={dateStr}
                        className={`${styles.dayCell} ${isToday ? styles.dayCellToday : ''} ${statusClass}`}
                        onClick={isFuture ? undefined : () => openEditModal(dateStr)}
                        style={{
                          opacity: isOutOfRange || isFuture ? 0.3 : 1,
                          cursor: isFuture ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <div className={styles.dayNumber}>{day.getDate()}</div>
                        {label && (
                          <div 
                            className={
                              record?.status === 'present' 
                                ? styles.dayHoursLabel 
                                : record?.status === 'absent'
                                ? styles.dayStatusPill + ' ' + styles.dayPillAbsent
                                : styles.dayStatusPill + ' ' + styles.dayPillWeeklyOff
                            }
                          >
                            {label}
                          </div>
                        )}
                        {restLabel && <div className={styles.dayRestLabel}>{restLabel}</div>}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Logs / History Table */}
          <div className={`${styles.glass} ${styles.historyCard}`}>
            <div className={styles.historyHeader}>
              <div className={styles.historyTitle}>Attendance Log</div>
            </div>
            
            <div className={styles.tableWrapper}>
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>In Time</th>
                    <th>Out Time</th>
                    <th>Lunch Break</th>
                    <th>Rest Time</th>
                    <th>Hours Worked</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No records logged in the selected date range.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.slice().reverse().map((record) => (
                      <tr key={record.date}>
                        <td style={{ fontWeight: 'bold' }}>{record.date}</td>
                        <td>
                          <span className={`${styles.badge} ${
                            record.status === 'present'
                              ? styles.badgePresent
                              : record.status === 'absent'
                              ? styles.badgeAbsent
                              : styles.badgeWeeklyOff
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td>{formatISOToTime(record.inTime)}</td>
                        <td>{formatISOToTime(record.outTime)}</td>
                        <td>{record.status === 'present' ? `${record.lunchDeduction ? Math.round(record.lunchDeduction) : 0} mins` : '--'}</td>
                        <td>
                          <div style={{ fontWeight: '600' }}>
                            {record.status === 'present' ? `${Math.round(record.restTimeTotal)} mins` : '--'}
                          </div>
                          {record.status === 'present' && record.restSessions && record.restSessions.length > 0 && (
                            <div className={styles.breakList}>
                              {record.restSessions.map((session, idx) => (
                                <div key={idx} className={styles.breakItem}>
                                  • {formatISOToTime(session.start)} - {session.end ? formatISOToTime(session.end) : 'Active'} 
                                  {session.end && ` (${Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60000)}m)`}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ fontWeight: 'bold', color: record.status === 'present' ? 'var(--color-present)' : 'inherit' }}>
                          {record.status === 'present' ? formatHoursToText(record.workedHours) : '--'}
                        </td>
                        <td>
                          <div className={styles.actionCell}>
                            <button className={`${styles.btnAction} ${styles.btnEdit}`} onClick={() => openEditModal(record.date)}>
                              Edit
                            </button>
                            <button className={`${styles.btnAction} ${styles.btnDelete}`} onClick={() => handleDeleteRecord(record.date)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      )}

      {/* Manual Entry / Edit Modal */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={`${styles.glass} ${styles.modalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Log Attendance: {modalDate}</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowModal(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveModal}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Status</label>
                <select
                  className={styles.formSelect}
                  value={modalStatus}
                  onChange={(e) => setModalStatus(e.target.value as any)}
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="weekly-off">Weekly Off (Sunday)</option>
                </select>
              </div>

              {modalStatus === 'present' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>In Time (Clock In)</label>
                    <input
                      type="time"
                      className={styles.formInput}
                      value={modalInTime}
                      onChange={(e) => setModalInTime(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Out Time (Clock Out)</label>
                    <input
                      type="time"
                      className={styles.formInput}
                      value={modalOutTime}
                      onChange={(e) => setModalOutTime(e.target.value)}
                      placeholder="Still working..."
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Total Rest Time (Minutes)</label>
                    <input
                      type="number"
                      min="0"
                      className={styles.formInput}
                      value={modalRestTime}
                      onChange={(e) => setModalRestTime(parseInt(e.target.value) || 0)}
                      required
                    />
                  </div>

                  {/* Manual Break In / Out Entry */}
                  <div className={styles.manualBreaksEditor}>
                    <label className={styles.formLabel}>Manage Breaks (Start / End)</label>
                    {modalRestSessions.length > 0 && (
                      <div className={styles.modalBreaksEditList}>
                        {modalRestSessions.map((session, idx) => {
                          const duration = session.end
                            ? Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60000)
                            : 0;
                          return (
                            <div key={idx} className={styles.modalBreakEditItem}>
                              <span>
                                {formatISOToTime(session.start)} - {session.end ? formatISOToTime(session.end) : 'Active'} ({duration}m)
                              </span>
                              <button
                                type="button"
                                className={styles.btnDeleteBreak}
                                onClick={() => handleRemoveModalBreak(idx)}
                              >
                                Delete
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className={styles.addBreakForm}>
                      <div className={styles.addBreakInputs}>
                        <div className={styles.addBreakInputGroup}>
                          <span className={styles.addBreakLabel}>Start:</span>
                          <input
                            type="time"
                            className={styles.formInputMini}
                            value={newBreakStart}
                            onChange={(e) => setNewBreakStart(e.target.value)}
                          />
                        </div>
                        <div className={styles.addBreakInputGroup}>
                          <span className={styles.addBreakLabel}>End:</span>
                          <input
                            type="time"
                            className={styles.formInputMini}
                            value={newBreakEnd}
                            onChange={(e) => setNewBreakEnd(e.target.value)}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnAddBreak}`}
                        onClick={handleAddModalBreak}
                      >
                        + Add Break
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Work from home, Doctor appointment..."
                  className={styles.formInput}
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>

              {modalStatus === 'present' && (
                <div className={styles.manualNote}>
                  💡 <strong>Calculation Note:</strong> Net work hours will be calculated as <code>(Clock Out - Clock In) - (Lunch Break overlap, max 1h) - Math.max(0, Rest Time - 20 minutes)</code>.
                </div>
              )}

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Username Onboarding Modal */}
      {showUsernameModal && user && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.glass} ${styles.modalContent}`} style={{ maxWidth: '420px' }}>
            <div className={styles.modalHeader}>
              <h3>👋 Welcome! Set Your Username</h3>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                You&apos;re signed in as <strong>{user.email}</strong>. Please choose a username that your admin and teammates will see.
              </p>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Username</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. John Doe"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveUsername(); } }}
                />
              </div>
              <div className={styles.modalFooter} style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleSaveUsername}
                  disabled={!usernameInput.trim() || usernameSaving}
                >
                  {usernameSaving ? 'Saving...' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
