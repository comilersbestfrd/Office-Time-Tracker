'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ref, onValue, set, remove } from 'firebase/database';
import { auth, db } from '@/lib/firebase';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import styles from './admin.module.css';

import { DayRecord, Holiday, HolidayType, calculateRecordHours, NEW_POLICY_START_DATE } from '@/lib/calculations';

interface UserProfile {
  email: string;
  displayName: string;
  photoURL: string;
  lastLogin: string;
  username?: string;
}

interface UserData {
  uid: string;
  profile: UserProfile | null;
  records: DayRecord[];
}

const getTodayDateString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getMonthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const formatTime = (iso: string | null) => {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '--';
  }
};

const formatHoursToHHMM = (hours: number | null | undefined): string => {
  if (hours == null) return '--';
  const isNegative = hours < 0;
  const absHours = Math.abs(hours);
  const h = Math.floor(absHours);
  const m = Math.round((absHours - h) * 60);
  const sign = isNegative ? '-' : '';
  const mmStr = String(m).padStart(2, '0');
  return `${sign}${h}:${mmStr}`;
};

export default function AdminDashboard() {
  const { isAdminUser, loading: adminLoading } = useAdminGuard();
  const router = useRouter();

  const [rawUsersMap, setRawUsersMap] = useState<Record<string, DayRecord[]>>({});
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date range filters
  const [filterStart, setFilterStart] = useState(getMonthStart());
  const [filterEnd, setFilterEnd] = useState(getTodayDateString());

  // Selected user filter
  const [selectedUid, setSelectedUid] = useState<string>('all');

  // Holiday states
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDateInput, setHolidayDateInput] = useState('');
  const [holidayNameInput, setHolidayNameInput] = useState('');
  const [holidayTypeInput, setHolidayTypeInput] = useState<HolidayType>('full');

  // Load user profiles
  useEffect(() => {
    if (!isAdminUser) return;
    const usersRef = ref(db, 'users');
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const profileMap: Record<string, UserProfile> = {};
      Object.keys(data).forEach((uid) => {
        const userNode = data[uid] || {};
        const profile = userNode.profile || {};
        
        // Extract fields from either nested profile node or flat user node
        profileMap[uid] = {
          email: profile.email || userNode.email || '',
          displayName: profile.displayName || userNode.displayName || '',
          photoURL: profile.photoURL || userNode.photoURL || '',
          lastLogin: profile.lastLogin || userNode.lastLogin || '',
          username: profile.username || userNode.username || '',
        };
      });
      setProfiles(profileMap);
    }, (err) => {
      console.warn('Could not load profiles:', err);
    });
    return () => unsub();
  }, [isAdminUser]);

  // Load all records
  useEffect(() => {
    if (!isAdminUser) return;
    setLoading(true);
    setError(null);

    const recordsRef = ref(db, 'records');
    const unsub = onValue(recordsRef, (snap) => {
      const data = snap.val();
      if (!data) {
        setRawUsersMap({});
        setLoading(false);
        return;
      }
      const map: Record<string, DayRecord[]> = {};
      Object.keys(data).forEach((uid) => {
        const userRecords = data[uid] || {};
        map[uid] = Object.values(userRecords);
      });
      setRawUsersMap(map);
      setLoading(false);
    }, (err) => {
      console.error('Failed to load records:', err);
      setError(
        'Permission denied. Please update your Firebase Realtime Database rules to allow admin access. ' +
        'Go to Firebase Console → Realtime Database → Rules and add read/write permission for your admin email on the /records node.'
      );
      setLoading(false);
    });
    return () => unsub();
  }, [isAdminUser]);

  // Recalculate all user records using matching holidays
  const allUsersData: UserData[] = useMemo(() => {
    return Object.keys(rawUsersMap).map((uid) => {
      const records = rawUsersMap[uid] || [];
      const recalculated = records.map((r) => {
        const matchingHoliday = holidays.find((h) => h.date === r.date);
        return calculateRecordHours(r, undefined, undefined, matchingHoliday);
      });
      return {
        uid,
        profile: null,
        records: recalculated.sort((a, b) => b.date.localeCompare(a.date)),
      };
    });
  }, [rawUsersMap, holidays]);

  // Load holidays
  useEffect(() => {
    if (!isAdminUser) return;
    const holidaysRef = ref(db, 'holidays');
    const unsub = onValue(holidaysRef, (snap) => {
      const data = snap.val() || {};
      const list: Holiday[] = Object.values(data);
      setHolidays(list.sort((a, b) => b.date.localeCompare(a.date)));
    }, async (err) => {
      console.warn('Could not load holidays from Firebase, trying local API:', err);
      try {
        const res = await fetch('/api/holidays');
        const data = await res.json();
        setHolidays(data.sort((a: Holiday, b: Holiday) => b.date.localeCompare(a.date)));
      } catch (localErr) {
        console.error('Failed to load holidays from local API:', localErr);
      }
    });
    return () => unsub();
  }, [isAdminUser]);

  // Compute filtered data
  const filteredData = useMemo(() => {
    return allUsersData.map((userData) => {
      const filtered = userData.records.filter((rec) => {
        if (filterStart && rec.date < filterStart) return false;
        if (filterEnd && rec.date > filterEnd) return false;
        return true;
      });
      return { ...userData, records: filtered };
    }).filter((userData) => {
      if (selectedUid === 'all') return true;
      return userData.uid === selectedUid;
    });
  }, [allUsersData, filterStart, filterEnd, selectedUid]);

  // Stats
  const totalStats = useMemo(() => {
    let totalRecords = 0;
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalWeeklyOff = 0;
    let totalHoursWorked = 0;
    let totalUnapprovedLateMinutes = 0;
    let totalApprovedLateMinutes = 0;
    let totalLeaveCoverMinutes = 0;

    filteredData.forEach((u) => {
      u.records.forEach((r) => {
        totalRecords++;
        if (r.status === 'present') {
          totalPresent++;
          totalHoursWorked += (r.workedHours || 0);
          if (r.date >= NEW_POLICY_START_DATE) {
            totalUnapprovedLateMinutes += (r.unapprovedLateMinutes || 0);
            totalApprovedLateMinutes += (r.approvedLateMinutes || 0);
            totalLeaveCoverMinutes += (r.leaveCoverMinutes || 0);
          }
        }
        if (r.status === 'absent') totalAbsent++;
        if (r.status === 'weekly-off') totalWeeklyOff++;
      });
    });

    return {
      totalRecords,
      totalPresent,
      totalAbsent,
      totalWeeklyOff,
      totalHoursWorked,
      totalUnapprovedLateMinutes,
      totalApprovedLateMinutes,
      totalLeaveCoverMinutes,
    };
  }, [filteredData]);

  const getUserLabel = (uid: string) => {
    const profile = profiles[uid];
    if (profile?.username) return profile.username;
    if (profile?.displayName) return profile.displayName;
    if (profile?.email) return profile.email;
    return uid.substring(0, 12) + '...';
  };

  const getUserEmail = (uid: string) => {
    return profiles[uid]?.email || 'N/A';
  };

  const handleDeleteRecord = async (uid: string, date: string) => {
    if (!window.confirm(`Delete record for ${date}?`)) return;
    await set(ref(db, `records/${uid}/${date}`), null);
  };

  const handleToggleLateApproval = async (uid: string, record: DayRecord) => {
    const matchingHoliday = holidays.find((h) => h.date === record.date);
    const updated: DayRecord = {
      ...record,
      isLateApproved: !record.isLateApproved,
    };
    const recalculated = calculateRecordHours(updated, undefined, undefined, matchingHoliday);
    await set(ref(db, `records/${uid}/${record.date}`), recalculated);
  };

  const handleDeleteAllUserRecords = async (uid: string) => {
    const label = getUserLabel(uid);
    if (!window.confirm(`Delete ALL records for ${label}? This cannot be undone.`)) return;
    await remove(ref(db, `records/${uid}`));
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDateInput || !holidayNameInput.trim()) {
      alert('Please specify both Date and Holiday Name!');
      return;
    }
    const holiday: Holiday = {
      date: holidayDateInput,
      name: holidayNameInput.trim(),
      type: holidayTypeInput,
    };

    // Update local state instantly for immediate UI feedback
    setHolidays((prev) => {
      const filtered = prev.filter((h) => h.date !== holiday.date);
      return [...filtered, holiday].sort((a, b) => b.date.localeCompare(a.date));
    });

    try {
      // Write to Firebase
      const holidayRef = ref(db, `holidays/${holiday.date}`);
      await set(holidayRef, holiday);
      
      // Sync to local JSON database API
      await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(holiday),
      });

      setHolidayDateInput('');
      setHolidayNameInput('');
      setHolidayTypeInput('full');
    } catch (err: any) {
      console.error('Error saving holiday:', err);
      alert(`Failed to save holiday: ${err.message}`);
    }
  };

  const handleDeleteHoliday = async (date: string) => {
    if (!window.confirm(`Delete holiday for ${date}?`)) return;

    // Update local state instantly for immediate UI feedback
    setHolidays((prev) => prev.filter((h) => h.date !== date));

    try {
      // Delete from Firebase
      await set(ref(db, `holidays/${date}`), null);
      
      // Sync to local JSON database API
      await fetch(`/api/holidays/${date}`, {
        method: 'DELETE',
      });
    } catch (err: any) {
      console.error('Error deleting holiday:', err);
      alert(`Failed to delete holiday: ${err.message}`);
    }
  };

  if (adminLoading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner}></div>
        <p>Verifying admin access...</p>
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className={styles.accessDenied}>
        <div className={styles.accessDeniedCard}>
          <span className={styles.lockIcon}>🔒</span>
          <h2>Access Denied</h2>
          <p>You do not have admin privileges.</p>
          <button className={styles.btnPrimary} onClick={() => router.push('/')}>Go Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.adminDashboard}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🛡️ Admin Dashboard</h1>
          <p className={styles.subtitle}>Manage all user attendance records</p>
        </div>
        <button className={styles.btnBack} onClick={() => router.push('/')}>
          ← Back to Tracker
        </button>
      </header>

      {/* Error Banner */}
      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{allUsersData.length}</span>
          <span className={styles.statLabel}>Total Users</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{totalStats.totalRecords}</span>
          <span className={styles.statLabel}>Records</span>
        </div>
        <div className={`${styles.statCard} ${styles.statPresent}`}>
          <span className={styles.statNumber}>{totalStats.totalPresent}</span>
          <span className={styles.statLabel}>Present Days</span>
        </div>
        <div className={`${styles.statCard} ${styles.statAbsent}`}>
          <span className={styles.statNumber}>{totalStats.totalAbsent}</span>
          <span className={styles.statLabel}>Absent Days</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{formatHoursToHHMM(totalStats.totalHoursWorked)}</span>
          <span className={styles.statLabel}>Hours Worked</span>
        </div>
        <div className={`${styles.statCard} ${styles.statAbsent}`}>
          <span className={styles.statNumber}>{totalStats.totalUnapprovedLateMinutes}m</span>
          <span className={styles.statLabel}>Salary Cut (Late)</span>
        </div>
        <div className={`${styles.statCard} ${styles.statPresent}`}>
          <span className={styles.statNumber}>{totalStats.totalLeaveCoverMinutes}m</span>
          <span className={styles.statLabel}>Leave Cover Earned</span>
        </div>
      </div>

      {/* Holidays Management */}
      <div className={styles.userSection} style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem' }}>
          📅 Manage Public Holidays
        </h2>
        
        <form onSubmit={handleAddHoliday} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
          <div className={styles.filterGroup}>
            <label>Holiday Date</label>
            <input
              type="date"
              value={holidayDateInput}
              onChange={(e) => setHolidayDateInput(e.target.value)}
              className={styles.dateInput}
              required
            />
          </div>
          <div className={styles.filterGroup} style={{ flex: '1', minWidth: '200px' }}>
            <label>Holiday Name</label>
            <input
              type="text"
              placeholder="e.g. Independence Day / Diwali"
              value={holidayNameInput}
              onChange={(e) => setHolidayNameInput(e.target.value)}
              className={styles.dateInput}
              style={{ width: '100%' }}
              required
            />
          </div>
          <div className={styles.filterGroup} style={{ minWidth: '220px' }}>
            <label>Holiday / Leave Type</label>
            <select
              value={holidayTypeInput}
              onChange={(e) => setHolidayTypeInput(e.target.value as HolidayType)}
              className={styles.selectInput}
              style={{ width: '100%' }}
            >
              <option value="full">Full Day Holiday</option>
              <option value="half-before-lunch">Half Leave (Before Lunch)</option>
              <option value="half-after-lunch">Half Leave (After Lunch)</option>
            </select>
          </div>
          <button type="submit" className={styles.btnPrimary} style={{ padding: '0.65rem 1.5rem', borderRadius: '8px' }}>
            ➕ Add Holiday
          </button>
        </form>

        {holidays.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>No public holidays added yet.</p>
        ) : (
          <div className={styles.tableWrapper} style={{ maxHeight: '200px', overflowY: 'auto' }}>
            <table className={styles.recordsTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Holiday Name</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.date}>
                    <td className={styles.dateCell}>{h.date}</td>
                    <td>
                      {h.type === 'half-before-lunch' ? '🌓' : h.type === 'half-after-lunch' ? '🌗' : '🎉'} {h.name}
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${h.type?.startsWith('half') ? styles.badgeHalfLeave : styles.badgeHoliday}`}>
                        {h.type === 'half-before-lunch'
                          ? 'Half Leave (Before Lunch)'
                          : h.type === 'half-after-lunch'
                          ? 'Half Leave (After Lunch)'
                          : 'Full Day'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.btnSmallDanger}
                        onClick={() => handleDeleteHoliday(h.date)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className={styles.filtersRow}>
        <div className={styles.filterGroup}>
          <label>From</label>
          <input
            type="date"
            value={filterStart}
            onChange={(e) => setFilterStart(e.target.value)}
            className={styles.dateInput}
          />
        </div>
        <div className={styles.filterGroup}>
          <label>To</label>
          <input
            type="date"
            value={filterEnd}
            onChange={(e) => setFilterEnd(e.target.value)}
            className={styles.dateInput}
          />
        </div>
        <div className={styles.filterGroup}>
          <label>User</label>
          <select
            value={selectedUid}
            onChange={(e) => setSelectedUid(e.target.value)}
            className={styles.selectInput}
          >
            <option value="all">All Users</option>
            {allUsersData.map((u) => (
              <option key={u.uid} value={u.uid}>
                {getUserLabel(u.uid)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Records */}
      {loading ? (
        <div className={styles.loadingInline}>
          <div className={styles.spinner}></div>
          <p>Loading records...</p>
        </div>
      ) : filteredData.length === 0 ? (
        <div className={styles.emptyState}>
          <span>📋</span>
          <p>No records found for the selected filters.</p>
        </div>
      ) : (
        filteredData.map((userData) => (
          <div key={userData.uid} className={styles.userSection}>
            <div className={styles.userHeader}>
              <div className={styles.userInfo}>
                <h3>{getUserLabel(userData.uid)}</h3>
                <span className={styles.userEmail}>{getUserEmail(userData.uid)}</span>
                <span className={styles.userUid}>UID: {userData.uid}</span>
              </div>
              <div className={styles.userActions}>
                <span className={styles.recordCount}>{userData.records.length} records</span>
                <button
                  className={styles.btnDanger}
                  onClick={() => handleDeleteAllUserRecords(userData.uid)}
                >
                  🗑️ Delete All
                </button>
              </div>
            </div>

            {userData.records.length === 0 ? (
              <p className={styles.noRecords}>No records in selected date range.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.recordsTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>In Time</th>
                      <th>Out Time</th>
                      <th>Early (min)</th>
                      <th>Break (min)</th>
                      <th>Lunch (min)</th>
                      <th>Late (Salary Cut)</th>
                      <th>After 6 PM (Leave Cover)</th>
                      <th>Worked (hh:mm)</th>
                      <th>Pending (hh:mm)</th>
                      <th>Notes</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userData.records.map((rec) => (
                      <tr key={rec.date}>
                        <td className={styles.dateCell}>{rec.date}</td>
                        <td>
                          <span className={`${styles.statusBadge} ${
                            rec.status === 'present' ? (rec.holidayType?.startsWith('half') ? styles.badgeHalfLeave : styles.badgePresent) :
                            rec.status === 'absent' ? styles.badgeAbsent :
                            rec.status === 'holiday' ? styles.badgeHoliday :
                            styles.badgeOff
                          }`}>
                            {rec.status === 'present' ? (rec.holidayType === 'half-before-lunch' ? '🌓' : rec.holidayType === 'half-after-lunch' ? '🌗' : '✅') : 
                             rec.status === 'absent' ? '❌' : 
                             rec.status === 'holiday' ? '🎉' : '🔵'} {rec.status}
                            {rec.holidayType === 'half-before-lunch' ? ' (Half: AM)' : rec.holidayType === 'half-after-lunch' ? ' (Half: PM)' : ''}
                          </span>
                        </td>
                        <td>{formatTime(rec.inTime)}</td>
                        <td>{formatTime(rec.outTime)}</td>
                        <td>{rec.status === 'present' && rec.earlyTime && rec.earlyTime > 0 ? Math.round(rec.earlyTime) : '--'}</td>
                        <td>{rec.status === 'present' && rec.restTimeTotal ? Math.round(rec.restTimeTotal) : (rec.status === 'present' ? 0 : '--')}</td>
                        <td>
                          {rec.status === 'present'
                            ? (rec.holidayType?.startsWith('half')
                              ? '0m (Half Day)'
                              : (rec.lunchDeduction ? `${Math.round(rec.lunchDeduction)}m` : '0m'))
                            : '--'}
                        </td>
                        <td>
                          {rec.status === 'present' && rec.date >= NEW_POLICY_START_DATE ? (
                            rec.lateMinutes && rec.lateMinutes > 0 ? (
                              rec.isLateApproved ? (
                                <span className={`${styles.statusBadge} ${styles.badgeApproved}`} title={rec.lateReason || 'Late approved by admin'}>
                                  0m (Approved {rec.lateMinutes}m)
                                </span>
                              ) : (
                                <span className={`${styles.statusBadge} ${styles.badgeCut}`} title="Unapproved late cuts directly from salary">
                                  ⚠️ {rec.lateMinutes}m Cut
                                </span>
                              )
                            ) : (
                              '--'
                            )
                          ) : (
                            '--'
                          )}
                        </td>
                        <td>
                          {rec.status === 'present' && rec.date >= NEW_POLICY_START_DATE ? (
                            rec.afterSixMinutes && rec.afterSixMinutes > 0 ? (
                              <span className={`${styles.statusBadge} ${styles.badgeCover}`} title="Time past 6 PM deducts from monthly leave hours">
                                🌙 +{rec.afterSixMinutes}m ({rec.leaveCoverMinutes || 0}m Cover)
                              </span>
                            ) : (
                              '--'
                            )
                          ) : (
                            '--'
                          )}
                        </td>
                        <td className={styles.hoursCell}>
                          {formatHoursToHHMM(rec.workedHours)}
                        </td>
                        <td>{formatHoursToHHMM(rec.pendingHours)}</td>
                        <td className={styles.notesCell}>{rec.notes || '--'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {rec.status === 'present' && rec.date >= NEW_POLICY_START_DATE && rec.lateMinutes && rec.lateMinutes > 0 && (
                            <button
                              type="button"
                              className={rec.isLateApproved ? styles.btnSmallWarning : styles.btnSmallSuccess}
                              onClick={() => handleToggleLateApproval(userData.uid, rec)}
                              title={rec.isLateApproved ? 'Revoke late approval' : 'Approve late arrival so employee can cover it after 6 PM'}
                            >
                              {rec.isLateApproved ? 'Revoke' : '✅ Approve'}
                            </button>
                          )}
                          <button
                            className={styles.btnSmallDanger}
                            onClick={() => handleDeleteRecord(userData.uid, rec.date)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
