'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ref, onValue, set, remove } from 'firebase/database';
import { auth, db } from '@/lib/firebase';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import styles from './admin.module.css';

interface UserProfile {
  email: string;
  displayName: string;
  photoURL: string;
  lastLogin: string;
  username?: string;
}

interface DayRecord {
  date: string;
  status: 'present' | 'absent' | 'weekly-off';
  inTime: string | null;
  outTime: string | null;
  restSessions: any[];
  restTimeTotal: number;
  activeRestStart: string | null;
  workedHours: number;
  pendingHours: number;
  lunchDeduction?: number;
  notes?: string;
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

export default function AdminDashboard() {
  const { isAdminUser, loading: adminLoading } = useAdminGuard();
  const router = useRouter();

  const [allUsersData, setAllUsersData] = useState<UserData[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date range filters
  const [filterStart, setFilterStart] = useState(getMonthStart());
  const [filterEnd, setFilterEnd] = useState(getTodayDateString());

  // Selected user filter
  const [selectedUid, setSelectedUid] = useState<string>('all');

  // Load user profiles
  useEffect(() => {
    if (!isAdminUser) return;
    const usersRef = ref(db, 'users');
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const profileMap: Record<string, UserProfile> = {};
      Object.keys(data).forEach((uid) => {
        if (data[uid]?.profile) {
          profileMap[uid] = data[uid].profile;
        }
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
        setAllUsersData([]);
        setLoading(false);
        return;
      }
      const users: UserData[] = Object.keys(data).map((uid) => {
        const userRecords = data[uid] || {};
        const records: DayRecord[] = Object.values(userRecords);
        return {
          uid,
          profile: null,
          records: records.sort((a, b) => b.date.localeCompare(a.date)),
        };
      });
      setAllUsersData(users);
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

    filteredData.forEach((u) => {
      u.records.forEach((r) => {
        totalRecords++;
        if (r.status === 'present') {
          totalPresent++;
          totalHoursWorked += (r.workedHours || 0);
        }
        if (r.status === 'absent') totalAbsent++;
        if (r.status === 'weekly-off') totalWeeklyOff++;
      });
    });

    return { totalRecords, totalPresent, totalAbsent, totalWeeklyOff, totalHoursWorked };
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

  const handleDeleteAllUserRecords = async (uid: string) => {
    const label = getUserLabel(uid);
    if (!window.confirm(`Delete ALL records for ${label}? This cannot be undone.`)) return;
    await remove(ref(db, `records/${uid}`));
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
          <span className={styles.statNumber}>{totalStats.totalHoursWorked.toFixed(1)}h</span>
          <span className={styles.statLabel}>Hours Worked</span>
        </div>
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
                      <th>Rest (min)</th>
                      <th>Lunch (min)</th>
                      <th>Worked (hrs)</th>
                      <th>Pending (hrs)</th>
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
                            rec.status === 'present' ? styles.badgePresent :
                            rec.status === 'absent' ? styles.badgeAbsent :
                            styles.badgeOff
                          }`}>
                            {rec.status === 'present' ? '✅' : rec.status === 'absent' ? '❌' : '🔵'} {rec.status}
                          </span>
                        </td>
                        <td>{formatTime(rec.inTime)}</td>
                        <td>{formatTime(rec.outTime)}</td>
                        <td>{rec.restTimeTotal ? Math.round(rec.restTimeTotal) : 0}</td>
                        <td>{rec.lunchDeduction ? Math.round(rec.lunchDeduction) : '--'}</td>
                        <td className={styles.hoursCell}>
                          {rec.workedHours != null ? rec.workedHours.toFixed(2) : '--'}
                        </td>
                        <td>{rec.pendingHours != null ? rec.pendingHours.toFixed(2) : '--'}</td>
                        <td className={styles.notesCell}>{rec.notes || '--'}</td>
                        <td>
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
