'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { auth, db, googleProvider, remoteConfig, logAnalyticsEvent } from '@/lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, onValue, set, get } from 'firebase/database';
import { fetchAndActivate, getValue, onConfigUpdate, activate } from 'firebase/remote-config';
import { RecordSession, DayRecord, DashboardStats, calculateRecordHours, Holiday } from '@/lib/calculations';

const ADMIN_EMAIL = 'woxxinsolution12@gmail.com';

const detectAdBlocker = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  try {
    const testAd = document.createElement('div');
    testAd.className = 'adsbox ad-placement doubleclick-ad ad-placeholder pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links';
    testAd.style.position = 'absolute';
    testAd.style.left = '-9999px';
    testAd.style.top = '-9999px';
    testAd.style.width = '10px';
    testAd.style.height = '10px';
    document.body.appendChild(testAd);

    const isHidden = window.getComputedStyle(testAd).display === 'none' ||
      window.getComputedStyle(testAd).visibility === 'hidden';
    document.body.removeChild(testAd);

    return isHidden;
  } catch (e) {
    return false;
  }
};

export default function Home() {
  const router = useRouter();

  // Remote Config: controls whether ads are shown
  // appConfig === 1 => show ads, appConfig === 0 => hide ads
  const [showAds, setShowAds] = useState<boolean>(true);
  const [isAdBlockActive, setIsAdBlockActive] = useState<boolean>(false);
  const [adRefreshTime, setAdRefreshTime] = useState<number>(15);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [defaultDailyRestLimit, setDefaultDailyRestLimit] = useState<number>(20);
  const [allowedRestLimit, setAllowedRestLimit] = useState<number>(20);
  const [liveActiveBreakMs, setLiveActiveBreakMs] = useState<number>(0);
  const [isPipOpen, setIsPipOpen] = useState<boolean>(false);

  // App Simulation States
  const [activeAppModal, setActiveAppModal] = useState<'dialer' | 'message' | 'browser' | 'camera' | null>(null);

  // Dialer State
  const [dialNumber, setDialNumber] = useState<string>('');
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);
  const callingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Message App State
  const [chatInputText, setChatInputText] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'bot' | 'user'; text: string }>>([
    { sender: 'bot', text: '👋 Hello! I am your Office Helper Bot. How can I help you today? You can ask me about "stats", "break", or "work".' }
  ]);

  // Browser App State
  const [browserSearchQuery, setBrowserSearchQuery] = useState<string>('');
  const [currentBrowserPage, setCurrentBrowserPage] = useState<'google' | 'search'>('google');

  // Camera App State
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFilter, setCameraFilter] = useState<string>('none');
  const [showShutterFlash, setShowShutterFlash] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Data States
  const [records, setRecords] = useState<DayRecord[]>([]);
  const recordsRef = useRef<DayRecord[]>([]);
  const pipWindowRef = useRef<any>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

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



  // Auth States
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Username onboarding states
  const [customUsername, setCustomUsername] = useState<string>('');
  const [showUsernameModal, setShowUsernameModal] = useState<boolean>(false);
  const [usernameInput, setUsernameInput] = useState<string>('');
  const [usernameSaving, setUsernameSaving] = useState<boolean>(false);

  // UI/Modal States (extended)
  const [showManualBreakModal, setShowManualBreakModal] = useState<boolean>(false);
  const [manualBreakStart, setManualBreakStart] = useState<string>('');
  const [manualBreakEnd, setManualBreakEnd] = useState<string>('');
  const [showManualStartModal, setShowManualStartModal] = useState<boolean>(false);
  const [manualInPunch, setManualInPunch] = useState<string>('');
  const [modalDate, setModalDate] = useState<string>('');
  const [modalStatus, setModalStatus] = useState<'present' | 'absent' | 'weekly-off' | 'holiday'>('present');
  const [modalInTime, setModalInTime] = useState<string>('09:00');
  const [modalOutTime, setModalOutTime] = useState<string>('17:20');
  const [modalRestTime, setModalRestTime] = useState<number>(20);
  const [modalRestSessions, setModalRestSessions] = useState<RecordSession[]>([]);
  const [newBreakStart, setNewBreakStart] = useState<string>('');
  const [newBreakEnd, setNewBreakEnd] = useState<string>('');
  const [modalNotes, setModalNotes] = useState<string>('');

  // Forgotten clock-out / "Still Working?" popup states
  const [forgottenRecord, setForgottenRecord] = useState<DayRecord | null>(null);
  const [confirmTimeInput, setConfirmTimeInput] = useState<string>('18:15');
  const [showStillWorkingModal, setShowStillWorkingModal] = useState<boolean>(false);

  // Manual entry modal state
  const [showModal, setShowModal] = useState<boolean>(false);

  // Tab & Date Filter States
  const [activeTab, setActiveTab] = useState<'today' | 'stats'>('today');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  // Current month state for calendar navigation
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const timerRef = useRef<NodeJS.Timeout | null>(null);



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

  // Load saved default rest limit from localStorage on mount & log analytics page_view
  useEffect(() => {
    logAnalyticsEvent('page_view', { page_title: 'Office Time Tracker' });
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('office_timer_default_rest_limit');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) {
          setDefaultDailyRestLimit(parsed);
          setAllowedRestLimit(parsed);
        }
      }
    }
  }, []);

  // Keep allowedRestLimit in sync with active record or user default daily limit
  useEffect(() => {
    if (todayRecord && todayRecord.allowedRestLimit !== undefined) {
      setAllowedRestLimit(todayRecord.allowedRestLimit);
    } else {
      setAllowedRestLimit(defaultDailyRestLimit);
    }
  }, [todayRecord, defaultDailyRestLimit]);

  // Fetch local data (when signed out / offline)
  const fetchLocalData = async () => {
    try {
      const recordsRes = await fetch('/api/records');
      const recordsData: DayRecord[] = await recordsRes.json();
      const recalculated = recordsData.map(r => calculateRecordHours(r, undefined, defaultDailyRestLimit));
      setRecords(recalculated);

      const statsRes = await fetch('/api/stats');
      const statsData: DashboardStats = await statsRes.json();
      setStats(statsData);

      const holidaysRes = await fetch('/api/holidays');
      const holidaysData: Holiday[] = await holidaysRes.json();
      setHolidays(holidaysData);
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
        // Check if user already has a username & default daily rest limit
        try {
          const profileRef = ref(db, `users/${currentUser.uid}/profile`);
          const snapshot = await get(profileRef);
          const existingProfile = snapshot.val();

          if (existingProfile?.defaultDailyRestLimit) {
            const savedLimit = Number(existingProfile.defaultDailyRestLimit);
            if (!isNaN(savedLimit) && savedLimit > 0) {
              setDefaultDailyRestLimit(savedLimit);
              if (typeof window !== 'undefined') {
                localStorage.setItem('office_timer_default_rest_limit', String(savedLimit));
              }
            }
          }

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
              defaultDailyRestLimit: defaultDailyRestLimit || 20,
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
        const recalculated = list.map(r => calculateRecordHours(r, undefined, defaultDailyRestLimit));
        const sorted = recalculated.sort((a, b) => a.date.localeCompare(b.date));
        setRecords(sorted);
      } else {
        setRecords([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user, defaultDailyRestLimit]);

  // Listen to holidays in Firebase
  useEffect(() => {
    if (!user) return;

    const holidaysDbRef = ref(db, 'holidays');
    const unsubscribe = onValue(holidaysDbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: Holiday[] = Object.values(data);
        setHolidays(list);
      } else {
        setHolidays([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  // Listen for any forgotten clock-outs
  useEffect(() => {
    // Find the first past record that has been auto-clocked out
    const found = records.find(r => r.status === 'present' && r.isAutoClockedOut);
    if (found) {
      setForgottenRecord(found);
      setConfirmTimeInput('18:15');
    } else {
      setForgottenRecord(null);
    }
  }, [records]);

  useEffect(() => {
    setCurrentDateTime(new Date());

    // Initialize date filters to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    setFilterStartDate(getTodayDateString(firstDay));
    setFilterEndDate(getTodayDateString(today));

    const clockInterval = setInterval(() => {
      const now = new Date();
      setCurrentDateTime(now);

      // Still working late prompt check (it is past 6:15 PM / 18:15)
      const todayStrLocal = getTodayDateString(now);
      const todayRec = recordsRef.current.find(r => r.date === todayStrLocal);
      
      if (
        todayRec && 
        todayRec.status === 'present' && 
        !todayRec.outTime && 
        (now.getHours() > 18 || (now.getHours() === 18 && now.getMinutes() >= 15))
      ) {
        // Show prompt if we haven't prompted today
        const lastPromptDate = localStorage.getItem('lastWorkingLatePromptDate');
        if (lastPromptDate !== todayStrLocal) {
          setShowStillWorkingModal(true);
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

  }, []);

  // Firebase Remote Config: fetch appConfig, handle updates and ad refresh
  useEffect(() => {
    const handleConfigParse = () => {
      const valStr = getValue(remoteConfig, 'appConfig').asString();
      try {
        const parsed = JSON.parse(valStr);
        // 1 = show ads, 0 = hide ads
        setShowAds(parsed.adStatus === 1);
        if (typeof parsed.adRefreshTime === 'number' && parsed.adRefreshTime > 0) {
          setAdRefreshTime(parsed.adRefreshTime);
        }
      } catch (e) {
        console.warn('Failed to parse appConfig JSON string:', valStr, e);
        setShowAds(true); // fallback: show ads
        setAdRefreshTime(15);
      }
    };

    // 1. Initial fetch & activate
    fetchAndActivate(remoteConfig)
      .then(() => {
        handleConfigParse();
      })
      .catch((err) => {
        console.warn('Remote Config fetch failed, using default (show ads):', err);
        setShowAds(true); // fallback: show ads
        setAdRefreshTime(15);
      });

    // 2. Real-time Remote Config updates subscription
    try {
      const unsubscribe = onConfigUpdate(remoteConfig, {
        next: (configUpdate) => {
          activate(remoteConfig)
            .then(() => {
              handleConfigParse();
            })
            .catch((activateErr) => {
              console.error('Remote Config activation failed:', activateErr);
            });
        },
        error: (err) => {
          console.warn('Remote Config real-time update error:', err);
        },
        complete: () => {}
      });
      return () => unsubscribe();
    } catch (realtimeErr) {
      console.warn('Realtime Remote Config not supported or failed to init:', realtimeErr);
    }
  }, []);

  // AdBlocker check effect
  useEffect(() => {
    if (!showAds) {
      setIsAdBlockActive(false);
      return;
    }

    const checkBlocker = async () => {
      // Small timeout to let initial script loading attempt execute
      await new Promise((resolve) => setTimeout(resolve, 800));
      const isBlocked = await detectAdBlocker();
      setIsAdBlockActive(isBlocked);
    };

    checkBlocker();
  }, [showAds]);

  // Periodic Ad Refresh scheduler
  useEffect(() => {
    if (!showAds || isAdBlockActive || adRefreshTime <= 0) return;

    const interval = setInterval(() => {
      // Only increment refresh trigger and reload ad iframes if the browser tab is active/visible
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        setRefreshTrigger((prev) => prev + 1);
      }
    }, adRefreshTime * 1000);

    return () => clearInterval(interval);
  }, [showAds, isAdBlockActive, adRefreshTime]);

  // Popunder Ad Trigger — triggers only on specific user action events
  const triggerPopunder = () => {
    // Scripts are loaded at root layout level for consistent delivery
  };
  // Break Running Background Notification — fires when tab is hidden or minimized while break is active
  useEffect(() => {
    const isBreakActive = !!(todayRecord?.status === 'present' && todayRecord?.activeRestStart);
    if (!isBreakActive) {
      if (typeof document !== 'undefined') {
        document.title = 'Office Time Tracker';
      }
      return;
    }

    const sendBreakNotification = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        const durationStr = new Date(Date.now() - new Date(todayRecord!.activeRestStart!).getTime())
          .toISOString()
          .substr(11, 8);
        try {
          const notif = new Notification('☕ Break is Running!', {
            body: `Your break has been running for ${durationStr}. Click to resume work.`,
            icon: '/favicon.ico',
            tag: 'break-reminder',
            requireInteraction: true, // Keeps notification toast pinned on Windows desktop!
          });
          notif.onclick = () => {
            window.focus();
            notif.close();
          };
        } catch (err) {
          console.warn('Could not trigger notification:', err);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendBreakNotification();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const notifInterval = setInterval(sendBreakNotification, 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(notifInterval);
    };
  }, [todayRecord?.activeRestStart]);

  // Dialer Call Timer Effect
  useEffect(() => {
    if (isCalling) {
      setCallDuration(0);
      callingTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (callingTimerRef.current) {
        clearInterval(callingTimerRef.current);
        callingTimerRef.current = null;
      }
    }
    return () => {
      if (callingTimerRef.current) {
        clearInterval(callingTimerRef.current);
      }
    };
  }, [isCalling]);

  // Camera Track Cleanup Effect
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  // App Simulation Actions
  const handleOpenCamera = async () => {
    setActiveAppModal('camera');
    setCameraFilter('none');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraStream(stream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 150);
    } catch (err) {
      console.warn("Camera access denied or unavailable:", err);
    }
  };

  const handleCloseCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setActiveAppModal(null);
  };

  const handleSendMessage = () => {
    if (!chatInputText.trim()) return;
    const userMsg = { sender: 'user' as const, text: chatInputText };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInputText('');

    setTimeout(() => {
      const query = chatInputText.toLowerCase();
      let replyText = '';

      if (query.includes('stat') || query.includes('worked') || query.includes('hour')) {
        const workedStr = todayRecord ? formatHoursToText(todayRecord.workedHours) : '0h 00m';
        const pendingStr = todayRecord ? formatHoursToText(todayRecord.pendingHours) : '8h 00m';
        replyText = `📊 Today's Stats: You have worked ${workedStr} so far. Pending hours: ${pendingStr}. Keep grinding! 🚀`;
      } else if (query.includes('break') || query.includes('rest') || query.includes('lunch')) {
        const breakMins = todayRecord ? Math.round(todayRecord.restTimeTotal) : 0;
        replyText = `☕ Break Stats: You have logged ${breakMins} minutes of rest breaks today. The allowed paid limit is 20 minutes.`;
      } else if (query.includes('hello') || query.includes('hi') || query.includes('hey')) {
        replyText = `👋 Hello! I am here to assist you with tracking your office hours. Type "stats" to view your hours or "break" to see break time!`;
      } else {
        const responses = [
          "Focus is the key! 🎯 Remember to drink some water.",
          "Keep up the great work! You're doing awesome. 👍",
          "Need a screen break? Look away 20 feet for 20 seconds to protect your eyes. 👀",
          "Working hard! Let me know if you need help summarizing your day's work logs.",
          "Did you know? Exceeding 20 minutes of break time automatically deducts from your actual worked hours. Stay mindful! ⏱️"
        ];
        replyText = responses[Math.floor(Math.random() * responses.length)];
      }

      setChatMessages((prev) => [...prev, { sender: 'bot', text: replyText }]);
    }, 600);
  };

  const formatCallTime = (secs: number) => {
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const appShortcuts = [
    {
      id: 'dialer',
      name: 'Default Dialer',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      ),
      action: () => { setActiveAppModal('dialer'); setIsCalling(false); setDialNumber(''); }
    },
    {
      id: 'message',
      name: 'Our Message App',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      action: () => setActiveAppModal('message')
    },
    {
      id: 'browser',
      name: 'Default Browser',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
      action: () => { setActiveAppModal('browser'); setCurrentBrowserPage('google'); setBrowserSearchQuery(''); }
    },
    {
      id: 'camera',
      name: 'Camera',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      ),
      action: () => handleOpenCamera()
    }
  ];

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

      // Calculate Worked Time using dynamic or default limit
      const currentRestLimit = todayRecord.allowedRestLimit !== undefined ? todayRecord.allowedRestLimit : 20;
      const elapsedMs = now.getTime() - inTime.getTime();
      const allowedRestMs = currentRestLimit * 60 * 1000;
      const excessRestMs = Math.max(0, totalRestMs - allowedRestMs);
      const workedMs = Math.max(0, elapsedMs - lunchOverlapMs - excessRestMs);

      // Calculate running active break timer
      let activeBreakMs = 0;
      if (todayRecord.activeRestStart) {
        const restStart = new Date(todayRecord.activeRestStart);
        activeBreakMs = Math.max(0, now.getTime() - restStart.getTime());
      }
      setLiveActiveBreakMs(activeBreakMs);

      // Update PiP floating window if open
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        const timerEl = pipWindowRef.current.document.getElementById('pip-timer');
        if (timerEl) {
          timerEl.textContent = formatMsToHMS(activeBreakMs);
        }
      }

      // Live Tab Title in taskbar/browser
      if (typeof document !== 'undefined') {
        if (todayRecord.activeRestStart) {
          document.title = `☕ [${formatMsToHMS(activeBreakMs)}] Break Running - Office Timer`;
        } else if (todayRecord.status === 'present' && !todayRecord.outTime) {
          document.title = `⏱️ [${formatMsToHMS(workedMs)}] Working - Office Timer`;
        } else {
          document.title = 'Office Time Tracker';
        }
      }

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

  const formatExtraHoursSign = (hours: number): string => {
    const isNegative = hours < 0;
    const absMins = Math.round(Math.abs(hours) * 60);
    const sign = isNegative ? '-' : '+';
    if (absMins < 60) {
      return `${sign}${absMins}m`;
    }
    const h = Math.floor(absMins / 60);
    const m = absMins % 60;
    if (m === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${m}m`;
  };

  // Formatter: ISO DateTime to local string (HH:MM AM/PM)
  const formatISOToTime = (isoString: string | null): string => {
    if (!isoString) return '--:--';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };



  // Helper: Check if two time ranges overlap
  const isOverlapping = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => {
    return aStart < bEnd && aEnd > bStart;
  };

  // Clock Actions
  const handleClockIn = async () => {
    triggerPopunder();
    logAnalyticsEvent('clock_in');
    const now = new Date();
    // Enforce minimum In time: 8:00 AM
    if (now.getHours() < 8) {
      alert('Clock-in is not allowed before 8:00 AM!');
      return;
    }
    const dateStr = getTodayDateString();
    const newRecord: DayRecord = {
      date: dateStr,
      status: 'present',
      inTime: now.toISOString(),
      outTime: null,
      restSessions: [],
      restTimeTotal: 0,
      activeRestStart: null,
      workedHours: 0,
      pendingHours: 8,
      allowedRestLimit: defaultDailyRestLimit,
    };

    await saveRecordApi(newRecord);
  };

  const openDesktopPipWidget = async () => {
    if (typeof window === 'undefined' || !('documentPictureInPicture' in window)) {
      return;
    }
    try {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.focus();
        return;
      }
      // @ts-ignore
      const pip = await window.documentPictureInPicture.requestWindow({
        width: 320,
        height: 180,
      });
      pipWindowRef.current = pip;
      setIsPipOpen(true);

      // Inject styling and HTML
      pip.document.head.innerHTML = `
        <title>☕ Break Running - Office Timer</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body {
            background: #090d16;
            color: #f8fafc;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            padding: 14px;
            user-select: none;
          }
          .header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 700;
            color: #fbbf24;
            margin-bottom: 6px;
          }
          .pulse {
            width: 8px;
            height: 8px;
            background: #ef4444;
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 8px #ef4444;
          }
          .timer {
            font-size: 32px;
            font-weight: 800;
            font-family: monospace;
            color: #38bdf8;
            margin-bottom: 10px;
            letter-spacing: 1px;
          }
          .btn {
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            width: 100%;
            transition: transform 0.1s, opacity 0.2s;
          }
          .btn:hover {
            opacity: 0.9;
            transform: scale(1.02);
          }
        </style>
      `;

      pip.document.body.innerHTML = `
        <div class="header"><span class="pulse"></span> ☕ Break in Progress</div>
        <div id="pip-timer" class="timer">00:00:00</div>
        <button id="pip-resume-btn" class="btn">⏸️ Resume Work</button>
      `;

      const btn = pip.document.getElementById('pip-resume-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          handleEndRest();
          try {
            pip.close();
          } catch (e) {}
          setIsPipOpen(false);
        });
      }

      pip.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setIsPipOpen(false);
      });
    } catch (e) {
      console.warn('Document Picture-in-Picture not available or user closed:', e);
      setIsPipOpen(false);
    }
  };

  const handleStartRest = async () => {
    logAnalyticsEvent('break_start');
    // Explicitly request notification permission during click gesture
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (e) {}
    }

    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord) return;
    const updatedRecord: DayRecord = {
      ...freshTodayRecord,
      activeRestStart: new Date().toISOString(),
    };

    await saveRecordApi(updatedRecord);

    // If supported, open Picture-in-Picture floating desktop widget
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window) {
      openDesktopPipWidget();
    }
  };

  const handleEndRest = async () => {
    triggerPopunder();
    logAnalyticsEvent('break_end');
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch (e) {}
      pipWindowRef.current = null;
    }
    setIsPipOpen(false);

    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord || !freshTodayRecord.activeRestStart) return;
    const now = new Date();
    const start = new Date(freshTodayRecord.activeRestStart);
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.max(0, diffMs / 60000);

    let updatedRecord: DayRecord;
    // If break is less than 60 seconds, discard it as an accidental click
    if (diffMs < 60000) {
      updatedRecord = {
        ...freshTodayRecord,
        activeRestStart: null,
      };
    } else {
      const newSession: RecordSession = {
        start: freshTodayRecord.activeRestStart,
        end: now.toISOString(),
      };
      updatedRecord = {
        ...freshTodayRecord,
        activeRestStart: null,
        restTimeTotal: (freshTodayRecord.restTimeTotal || 0) + diffMins,
        restSessions: [...(freshTodayRecord.restSessions || []), newSession],
      };
    }

    await saveRecordApi(updatedRecord);
  };

  const handleAdjustRestLimit = async (amount: number) => {
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);

    const currentLimit = freshTodayRecord?.allowedRestLimit !== undefined 
      ? freshTodayRecord.allowedRestLimit 
      : (allowedRestLimit || defaultDailyRestLimit || 20);
    const newLimit = Math.max(5, currentLimit + amount);

    setAllowedRestLimit(newLimit);
    setDefaultDailyRestLimit(newLimit);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('office_timer_default_rest_limit', String(newLimit));
      } catch (e) {
        console.warn('Could not save rest limit to localStorage:', e);
      }
    }

    if (user) {
      try {
        const profileRef = ref(db, `users/${user.uid}/profile`);
        const snapshot = await get(profileRef);
        const existingProfile = snapshot.val() || {};
        await set(profileRef, {
          ...existingProfile,
          defaultDailyRestLimit: newLimit,
        });
      } catch (e) {
        console.warn('Could not save default rest limit to profile:', e);
      }
    }

    if (freshTodayRecord) {
      const updatedRecord: DayRecord = {
        ...freshTodayRecord,
        allowedRestLimit: newLimit,
      };

      const calculated = calculateRecordHours(updatedRecord, undefined, newLimit);
      await saveRecordApi(calculated);
    }
  };

  const handleClockOut = async () => {
    triggerPopunder();
    logAnalyticsEvent('clock_out');
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch (e) {}
      pipWindowRef.current = null;
    }
    setIsPipOpen(false);

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

      // Only save if break is at least 60 seconds
      if (diffMs >= 60000) {
        const newSession: RecordSession = {
          start: updatedRecord.activeRestStart,
          end: now.toISOString(),
        };
        updatedRecord.restTimeTotal = (updatedRecord.restTimeTotal || 0) + diffMins;
        updatedRecord.restSessions = [...(updatedRecord.restSessions || []), newSession];
      }
      updatedRecord.activeRestStart = null;
    }

    updatedRecord.outTime = new Date().toISOString();
    await saveRecordApi(updatedRecord);
  };

  // Manual Break Handler - adds a break session to today's record
  const handleSaveManualBreak = async () => {
    triggerPopunder();
    if (!manualBreakStart || !manualBreakEnd) {
      alert('Please specify both start and end times for the break!');
      return;
    }
    const todayStrLocal = getTodayDateString();
    const freshTodayRecord = recordsRef.current.find((r) => r.date === todayStrLocal);
    if (!freshTodayRecord || freshTodayRecord.status !== 'present') {
      alert('You need an active (present) record for today to add a break!');
      return;
    }

    const localStartStr = `${todayStrLocal}T${manualBreakStart}:00`;
    const localEndStr = `${todayStrLocal}T${manualBreakEnd}:00`;
    const startDate = new Date(localStartStr);
    const endDate = new Date(localEndStr);

    const diffMs = endDate.getTime() - startDate.getTime();
    if (Math.round(diffMs / 60000) <= 0) {
      alert('Break duration must be at least 1 minute!');
      return;
    }

    // Validate: break must be within In-Time and Out-Time (or current time)
    if (freshTodayRecord.inTime) {
      const inTime = new Date(freshTodayRecord.inTime).getTime();
      if (startDate.getTime() < inTime) {
        alert('Break start time cannot be before your In-Punch time!');
        return;
      }
    }
    const outBound = freshTodayRecord.outTime
      ? new Date(freshTodayRecord.outTime).getTime()
      : new Date().getTime();
    if (endDate.getTime() > outBound) {
      alert('Break end time cannot be after your Out-Punch time (or current time if still working)!');
      return;
    }

    // Validate: no overlapping breaks
    const existingSessions = freshTodayRecord.restSessions || [];
    const hasOverlap = existingSessions.some((s) => {
      if (!s.end) return false;
      return isOverlapping(
        startDate.getTime(), endDate.getTime(),
        new Date(s.start).getTime(), new Date(s.end).getTime()
      );
    });
    if (hasOverlap) {
      alert('This break overlaps with an existing break! Please choose a different time range.');
      return;
    }

    const newSession: RecordSession = {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    };

    const updatedSessions = [...existingSessions, newSession];
    let totalMins = 0;
    updatedSessions.forEach((s) => {
      if (s.end) {
        totalMins += (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
      }
    });

    const updatedRecord: DayRecord = {
      ...freshTodayRecord,
      restSessions: updatedSessions,
      restTimeTotal: Math.round(totalMins),
    };

    await saveRecordApi(updatedRecord);
    setManualBreakStart('');
    setManualBreakEnd('');
    setShowManualBreakModal(false);
  };

  // Manual Start Tracker Handler - creates a present record with a custom in-time
  const handleManualStart = async () => {
    triggerPopunder();
    if (!manualInPunch) {
      alert('Please specify an In-Punch time!');
      return;
    }
    const todayStrLocal = getTodayDateString();
    const inDate = new Date(`${todayStrLocal}T${manualInPunch}:00`);

    if (inDate.getTime() > new Date().getTime()) {
      alert('In-Punch time cannot be in the future!');
      return;
    }

    // Enforce minimum In time: 8:00 AM
    if (inDate.getHours() < 8) {
      alert('In-Punch time cannot be before 8:00 AM!');
      return;
    }

    const newRecord: DayRecord = {
      date: todayStrLocal,
      status: 'present',
      inTime: inDate.toISOString(),
      outTime: null,
      restSessions: [],
      restTimeTotal: 0,
      activeRestStart: null,
      workedHours: 0,
      pendingHours: 8,
      allowedRestLimit: defaultDailyRestLimit,
    };

    await saveRecordApi(newRecord);
    setManualInPunch('');
    setShowManualStartModal(false);
  };

  const handleMarkAbsentToday = async () => {
    triggerPopunder();
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
      logAnalyticsEvent('login', { method: 'Google' });
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
        defaultDailyRestLimit: existingProfile.defaultDailyRestLimit || defaultDailyRestLimit || 20,
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
    const recordToCalculate: DayRecord = {
      ...record,
      allowedRestLimit: record.allowedRestLimit !== undefined ? record.allowedRestLimit : defaultDailyRestLimit,
    };
    const updatedRecord = calculateRecordHours(recordToCalculate, undefined, defaultDailyRestLimit);
    if (user) {
      try {
        const recordRef = ref(db, `records/${user.uid}/${updatedRecord.date}`);
        const sanitized = sanitizeForFirebase(updatedRecord);
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
          body: JSON.stringify(updatedRecord),
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
      const isHoliday = holidays.some((h) => h.date === dateStr);
      setModalStatus(isHoliday ? 'holiday' : (new Date(dateStr).getDay() === 0 ? 'weekly-off' : 'present'));
      setModalInTime('09:00');
      setModalOutTime('17:20');
      setModalRestTime(20);
      setModalRestSessions([]);
      setModalNotes('');
    }
    
    setShowModal(true);
  };

  const handleAddModalBreak = () => {
    triggerPopunder();
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
    if (Math.round(durationMins) <= 0) {
      alert("Break duration must be at least 1 minute!");
      return;
    }

    // Validate: break must be within In-Time and Out-Time
    if (modalInTime) {
      const inBound = new Date(`${modalDate}T${modalInTime}:00`).getTime();
      if (startDate.getTime() < inBound) {
        alert('Break start time cannot be before the In-Time!');
        return;
      }
    }
    if (modalOutTime) {
      const outBound = new Date(`${modalDate}T${modalOutTime}:00`).getTime();
      if (endDate.getTime() > outBound) {
        alert('Break end time cannot be after the Out-Time!');
        return;
      }
    }

    // Validate: no overlapping breaks
    const hasOverlap = modalRestSessions.some((s) => {
      if (!s.end) return false;
      return isOverlapping(
        startDate.getTime(), endDate.getTime(),
        new Date(s.start).getTime(), new Date(s.end).getTime()
      );
    });
    if (hasOverlap) {
      alert('This break overlaps with an existing break! Please choose a different time range.');
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
    triggerPopunder();

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

      // Enforce minimum In time: 8:00 AM
      if (inDate.getHours() < 8) {
        alert('In-Time cannot be before 8:00 AM!');
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

        // Enforce maximum Out time: 8:00 PM (20:00)
        if (outDate.getHours() >= 20 && outDate.getMinutes() > 0 || outDate.getHours() > 20) {
          alert('Out-Time cannot be after 8:00 PM!');
          return;
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
      record.allowedRestLimit = existingRecord?.allowedRestLimit !== undefined ? existingRecord.allowedRestLimit : defaultDailyRestLimit;

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
      const isHoliday = holidays.some((h) => h.date === record.date);
      
      let worked = record.workedHours;
      if (isToday && record.status === 'present' && !record.outTime) {
        worked = liveWorkedHoursDecimal;
      }

      if (record.status === 'present') {
        presentDays++;
        if (!isHoliday) {
          totalWorkDays++;
        }
        hoursWorkedTotal += worked;
      } else if (record.status === 'absent') {
        absentDays++;
        if (!isHoliday) {
          totalWorkDays++;
        }
      } else if (record.status === 'weekly-off') {
        weeklyOffDays++;
        if (worked > 0) {
          hoursWorkedTotal += worked;
        }
      } else if (record.status === 'holiday') {
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
            /* Original Single Column Layout for Today */
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
                  <div className={styles.restLimitControls}>
                    <span>Limit: <strong>{allowedRestLimit}m</strong></span>
                    <button
                      type="button"
                      className={styles.limitAdjustBtn}
                      onClick={() => handleAdjustRestLimit(-5)}
                      title="Decrease limit by 5 min"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className={styles.limitAdjustBtn}
                      onClick={() => handleAdjustRestLimit(5)}
                      title="Increase limit by 5 min"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className={styles.restBarWrapper}>
                  <div
                    className={`${styles.restBarFill} ${liveRestMins > allowedRestLimit ? styles.restLimitExceeded : styles.restLimitOk}`}
                    style={{ width: `${Math.min(100, (liveRestMins / allowedRestLimit) * 100)}%` }}
                  />
                </div>
                {liveRestMins > allowedRestLimit && (
                  <span className={styles.restText} style={{ color: 'var(--color-absent)', fontWeight: 'bold' }}>
                    ⚠️ Excess Rest (+{Math.round(liveRestMins - allowedRestLimit)}m) is deducted from work hours!
                  </span>
                )}
              </div>
            )}

            {/* When not clocked in, show configurable daily break limit */}
            {(!todayRecord || todayRecord.status !== 'present') && (
              <div className={styles.restLimitControls} style={{ justifyContent: 'center', marginBottom: '1.25rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Daily Break Limit: <strong style={{ color: 'var(--text-primary)' }}>{defaultDailyRestLimit}m</strong></span>
                <button
                  type="button"
                  className={styles.limitAdjustBtn}
                  onClick={() => handleAdjustRestLimit(-5)}
                  title="Decrease daily break limit by 5 min"
                >
                  -
                </button>
                <button
                  type="button"
                  className={styles.limitAdjustBtn}
                  onClick={() => handleAdjustRestLimit(5)}
                  title="Increase daily break limit by 5 min"
                >
                  +
                </button>
              </div>
            )}

            <div className={styles.clockButtons}>
              {/* Not clocked in yet */}
              {(!todayRecord || (todayRecord.status !== 'present' && todayRecord.status !== 'absent' && todayRecord.status !== 'weekly-off')) && (
                <>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleClockIn} data-popunder-action="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                    Clock In
                  </button>
                  <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleMarkAbsentToday} data-popunder-action="true">
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
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleEndRest} data-popunder-action="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6z"/></svg>
                      Resume Work (Shortcut: R)
                    </button>
                  )}
                  
                  <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleClockOut} data-popunder-action="true">
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
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleResumeShift} style={{ width: '100%' }} data-popunder-action="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                      Resume Work
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Quick Action Buttons */}
            <div className={styles.clockButtons} style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem' }}>
              {todayRecord && todayRecord.status === 'present' && !todayRecord.outTime && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowManualBreakModal(true)}
                  style={{ fontSize: '0.85rem' }}
                >
                  ☕ Add Manual Break
                </button>
              )}
              {(!todayRecord || todayRecord.status !== 'present') && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setShowManualStartModal(true)}
                  style={{ fontSize: '0.85rem' }}
                >
                  ▶️ Start Tracker Manually
                </button>
              )}
            </div>


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
              <div className={styles.statSubtext}>Actual time (rest exceeding {allowedRestLimit}m deducted)</div>
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
                {formatExtraHoursSign(displayStats.hoursWorkedTotal - displayStats.requiredHoursTotal)}
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
                    const holiday = holidays.find((h) => h.date === dateStr);
                    const isSunday = day.getDay() === 0;
                    const isOutOfRange = (filterStartDate && dateStr < filterStartDate) || (filterEndDate && dateStr > filterEndDate);
                    const isFuture = dateStr > todayStr;

                    let statusClass = '';
                    let label = '';
                    let restLabel = '';
                    let holidayLabel = '';

                    if (holiday) {
                      holidayLabel = `🎉 ${holiday.name}`;
                    }

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
                      } else if (record.status === 'holiday') {
                        statusClass = styles.dayWeeklyOff;
                        label = 'Holiday';
                      }
                    } else if (holiday) {
                      statusClass = styles.dayWeeklyOff;
                      label = 'Holiday';
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
                                : record?.status === 'holiday' || (!record && holiday)
                                ? styles.dayStatusPill + ' ' + styles.dayPillHoliday
                                : styles.dayStatusPill + ' ' + styles.dayPillWeeklyOff
                            }
                          >
                            {label}
                          </div>
                        )}
                        {restLabel && <div className={styles.dayRestLabel}>{restLabel}</div>}
                        {holidayLabel && <div className={styles.dayHolidayLabel}>{holidayLabel}</div>}
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
                          {record.status === 'present'
                            ? formatHoursToText(
                                record.date === todayStr && !record.outTime
                                  ? liveWorkedHoursDecimal
                                  : record.workedHours
                              )
                            : '--'}
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
                  <option value="holiday">Public Holiday</option>
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
                        data-popunder-action="true"
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
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} data-popunder-action="true">
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

      {/* Still Working Modal */}
      {showStillWorkingModal && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.glass} ${styles.modalContent}`} style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>⏰ Are you still working?</h3>
            <p style={{ margin: '1.25rem 0', fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              It is past 6:15 PM. Click <strong>Yes</strong> if you are still working late. Otherwise, click <strong>No</strong> to clock out now.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
              <button 
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`} 
                onClick={() => {
                  const todayStrLocal = getTodayDateString();
                  localStorage.setItem('lastWorkingLatePromptDate', todayStrLocal);
                  setShowStillWorkingModal(false);
                }}
              >
                Yes, still working
              </button>
              <button 
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`} 
                onClick={async () => {
                  setShowStillWorkingModal(false);
                  await handleClockOut();
                }}
              >
                No, clock out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forgotten Clock-Out Confirmation Modal */}
      {forgottenRecord && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.glass} ${styles.modalContent}`} style={{ maxWidth: '450px' }}>
            <div className={styles.modalHeader}>
              <h3>⚠️ Forgotten Clock-Out</h3>
            </div>
            <div style={{ padding: '1.25rem 0 0 0' }}>
              <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                You forgot to clock out on <strong>{forgottenRecord.date}</strong>.<br />
                We have set your clock-out time to <strong>6:15 PM</strong> by default. Is this correct?
              </p>
              
              <div className={styles.formGroup} style={{ marginBottom: '1.5rem' }}>
                <label className={styles.formLabel}>Clock-Out Time</label>
                <input 
                  type="time" 
                  className={styles.formInput} 
                  value={confirmTimeInput}
                  onChange={(e) => setConfirmTimeInput(e.target.value)}
                  style={{ 
                    width: '100%', 
                    padding: '0.50rem', 
                    background: 'rgba(255,255,255,0.05)', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    color: '#fff', 
                    borderRadius: '6px' 
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button 
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={async () => {
                    // Save custom time
                    const [hh, mm] = confirmTimeInput.split(':');
                    const customOutDate = new Date(`${forgottenRecord.date}T${hh}:${mm}:00`);
                    const updated: DayRecord = {
                      ...forgottenRecord,
                      outTime: customOutDate.toISOString(),
                      isAutoClockedOut: false
                    };
                    await saveRecordApi(updated);
                    setForgottenRecord(null);
                  }}
                >
                  Save Custom Time
                </button>
                <button 
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={async () => {
                    // Confirm default 6:15 PM
                    const defaultOutDate = new Date(`${forgottenRecord.date}T18:15:00`);
                    const updated: DayRecord = {
                      ...forgottenRecord,
                      outTime: defaultOutDate.toISOString(),
                      isAutoClockedOut: false
                    };
                    await saveRecordApi(updated);
                    setForgottenRecord(null);
                  }}
                >
                  Yes, 6:15 PM is correct
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Break Modal */}
      {showManualBreakModal && (
        <div className={styles.modalOverlay} onClick={() => setShowManualBreakModal(false)}>
          <div className={`${styles.glass} ${styles.modalContent}`} style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>☕ Add Manual Break</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowManualBreakModal(false)}>✕</button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.9rem', lineHeight: '1.4' }}>
                Add a break session to today&apos;s record. Specify the start and end times of your break.
              </p>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Break Start Time</label>
                <input
                  type="time"
                  className={styles.formInput}
                  value={manualBreakStart}
                  onChange={(e) => setManualBreakStart(e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Break End Time</label>
                <input
                  type="time"
                  className={styles.formInput}
                  value={manualBreakEnd}
                  onChange={(e) => setManualBreakEnd(e.target.value)}
                />
              </div>
              {manualBreakStart && manualBreakEnd && (() => {
                const s = new Date(`2000-01-01T${manualBreakStart}:00`);
                const e = new Date(`2000-01-01T${manualBreakEnd}:00`);
                const diff = Math.round((e.getTime() - s.getTime()) / 60000);
                if (diff > 0) return (
                  <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.1)', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.95rem' }}>Duration: {diff} minutes</span>
                  </div>
                );
                return null;
              })()}
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => { setManualBreakStart(''); setManualBreakEnd(''); setShowManualBreakModal(false); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleSaveManualBreak}
                  data-popunder-action="true"
                >
                  Save Break
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Start Tracker Modal */}
      {showManualStartModal && (
        <div className={styles.modalOverlay} onClick={() => setShowManualStartModal(false)}>
          <div className={`${styles.glass} ${styles.modalContent}`} style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>▶️ Start Tracker Manually</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowManualStartModal(false)}>✕</button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.9rem', lineHeight: '1.4' }}>
                Enter your actual In-Punch time to start tracking. This is useful if you forgot to clock in on time.
              </p>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>In-Punch Time</label>
                <input
                  type="time"
                  className={styles.formInput}
                  value={manualInPunch}
                  onChange={(e) => setManualInPunch(e.target.value)}
                />
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => { setManualInPunch(''); setShowManualStartModal(false); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleManualStart}
                  data-popunder-action="true"
                >
                  Start Tracking
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dialer Simulation Modal */}
      {activeAppModal === 'dialer' && (
        <div className={styles.modalOverlay} onClick={() => setActiveAppModal(null)}>
          <div className={`${styles.glass} ${styles.modalContent} ${styles.simModalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>📞 Dialer</h3>
              <button className={styles.modalCloseBtn} onClick={() => setActiveAppModal(null)}>✕</button>
            </div>
            
            {isCalling ? (
              <div className={styles.callingOverlay}>
                <div className={styles.callingAvatar}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className={styles.callingName}>{dialNumber || 'Unknown Number'}</div>
                <div className={styles.callingStatus}>Calling... ({formatCallTime(callDuration)})</div>
                <button type="button" className={styles.btnEndCall} onClick={() => setIsCalling(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                    <line x1="23" y1="1" x2="1" y2="23" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className={styles.dialerContainer}>
                <div className={styles.dialerScreen}>{dialNumber || 'Enter Number'}</div>
                <div className={styles.dialpad}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((char) => (
                    <button
                      key={char}
                      type="button"
                      className={styles.dialBtn}
                      onClick={() => setDialNumber((prev) => prev + char)}
                    >
                      {char}
                    </button>
                  ))}
                </div>
                <div className={styles.dialActions}>
                  <button
                    type="button"
                    className={styles.btnDialDelete}
                    onClick={() => setDialNumber((prev) => prev.slice(0, -1))}
                    style={{ visibility: dialNumber ? 'visible' : 'hidden' }}
                  >
                    ⌫
                  </button>
                  <button
                    type="button"
                    className={styles.btnCall}
                    onClick={() => {
                      if (dialNumber) {
                        setIsCalling(true);
                      }
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </button>
                  <div style={{ width: 28 }}></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Message App Simulation Modal */}
      {activeAppModal === 'message' && (
        <div className={styles.modalOverlay} onClick={() => setActiveAppModal(null)}>
          <div className={`${styles.glass} ${styles.modalContent} ${styles.simModalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>💬 Message App</h3>
              <button className={styles.modalCloseBtn} onClick={() => setActiveAppModal(null)}>✕</button>
            </div>
            
            <div className={styles.chatContainer}>
              <div className={styles.chatMessages}>
                {chatMessages.map((msg, index) => (
                  <div
                    key={index}
                    className={`${styles.chatBubble} ${msg.sender === 'user' ? styles.chatBubbleUser : styles.chatBubbleBot}`}
                  >
                    {msg.text}
                  </div>
                ))}
              </div>
              
              <div className={styles.chatInputArea}>
                <input
                  type="text"
                  className={styles.chatInput}
                  placeholder="Ask bot about 'stats' or 'break'..."
                  value={chatInputText}
                  onChange={(e) => setChatInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button type="button" className={styles.btnChatSend} onClick={handleSendMessage}>
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Browser App Simulation Modal */}
      {activeAppModal === 'browser' && (
        <div className={styles.modalOverlay} onClick={() => setActiveAppModal(null)}>
          <div className={`${styles.glass} ${styles.modalContent} ${styles.simModalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>🌐 Web Browser</h3>
              <button className={styles.modalCloseBtn} onClick={() => setActiveAppModal(null)}>✕</button>
            </div>
            
            <div className={styles.miniBrowser}>
              <form onSubmit={(e) => { e.preventDefault(); if (browserSearchQuery.trim()) setCurrentBrowserPage('search'); }} className={styles.browserNav}>
                <input
                  type="text"
                  className={styles.browserUrlBar}
                  placeholder="Search web or enter URL..."
                  value={browserSearchQuery}
                  onChange={(e) => setBrowserSearchQuery(e.target.value)}
                />
                <button type="submit" className={styles.btnBrowserGo}>Go</button>
              </form>

              {currentBrowserPage === 'google' ? (
                <div className={styles.browserFrame} style={{ justifyContent: 'center' }}>
                  <h2 style={{ fontSize: '2rem', background: 'linear-gradient(to right, #4285F4, #EA4335, #FBBC05, #34A853)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800, marginBottom: '1.5rem' }}>
                    Google
                  </h2>
                  <p style={{ fontSize: '0.85rem' }}>Type above to search the web anonymously</p>
                </div>
              ) : (
                <div className={styles.browserFrame} style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'stretch', justifyContent: 'flex-start', textAlign: 'left' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Search results for: <strong>{browserSearchQuery}</strong></div>

                  {/* Organic Search Result 1 */}
                  <div>
                    <a href="https://en.wikipedia.org/wiki/Special:Search" target="_blank" rel="noreferrer" style={{ fontSize: '0.9rem', color: '#60a5fa', fontWeight: 600, textDecoration: 'underline' }}>
                      {browserSearchQuery} - Wikipedia
                    </a>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Read the free encyclopedia entry for &quot;{browserSearchQuery}&quot;. History, definitions, references, and related topics.</div>
                  </div>

                  {/* Organic Search Result 2 */}
                  <div>
                    <a href="https://github.com" target="_blank" rel="noreferrer" style={{ fontSize: '0.9rem', color: '#60a5fa', fontWeight: 600, textDecoration: 'underline' }}>
                      Open-Source Projects related to {browserSearchQuery}
                    </a>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Explore developer repositories, tools, codebases, and scripts for &quot;{browserSearchQuery}&quot; on GitHub.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Camera App Simulation Modal */}
      {activeAppModal === 'camera' && (
        <div className={styles.modalOverlay} onClick={handleCloseCamera}>
          <div className={`${styles.glass} ${styles.modalContent} ${styles.simModalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>📷 Live Camera</h3>
              <button className={styles.modalCloseBtn} onClick={handleCloseCamera}>✕</button>
            </div>
            
            <div className={styles.cameraApp}>
              <div className={styles.cameraViewWrapper}>
                {cameraStream ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={styles.cameraVideo}
                    style={{ filter: cameraFilter }}
                  />
                ) : (
                  <div className={styles.cameraPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <p>Camera feed starting or blocked.<br />Ensure webcam permissions are enabled.</p>
                  </div>
                )}
                {showShutterFlash && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'white', opacity: 0.9 }}></div>
                )}
              </div>

              <div className={styles.filterBarContainer}>
                <div className={styles.filterRow}>
                  {[
                    { id: 'none', name: 'Normal' },
                    { id: 'sepia(0.8) contrast(1.2)', name: 'Retro Sepia' },
                    { id: 'hue-rotate(90deg) saturate(2)', name: 'Neon Glow' },
                    { id: 'grayscale(1) contrast(1.5)', name: 'Obsidian' },
                    { id: 'hue-rotate(120deg) brightness(1.2) contrast(1.5)', name: 'Matrix' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={`${styles.btnFilter} ${cameraFilter === filter.id ? styles.btnFilterActive : ''}`}
                      onClick={() => setCameraFilter(filter.id)}
                    >
                      {filter.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.cameraShutterBtn}
                  onClick={() => {
                    if (cameraStream) {
                      setShowShutterFlash(true);
                      setTimeout(() => setShowShutterFlash(false), 300);
                      alert("📸 Snapshot simulation captured successfully!");
                    }
                  }}
                  title="Take Photo"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Break Float Popup (Bottom Right) - Hidden when native desktop PiP is open */}
      {todayRecord && todayRecord.status === 'present' && todayRecord.activeRestStart && !isPipOpen && (
        <div className={styles.activeBreakPopup}>
          <div className={styles.activeBreakPopupHeader}>
            <span className={styles.activeBreakPopupPulse}></span>
            <strong>☕ Break in Progress</strong>
          </div>
          <div className={styles.activeBreakPopupTimer}>
            ⏱️ {formatMsToHMS(liveActiveBreakMs)}
          </div>
          <p className={styles.activeBreakPopupText}>Don&apos;t forget to resume work when finished!</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
            <button
              type="button"
              className={styles.activeBreakPopupBtn}
              onClick={handleEndRest}
              data-popunder-action="true"
            >
              ⏸️ Resume Work
            </button>
            {typeof window !== 'undefined' && 'documentPictureInPicture' in window && (
              <button
                type="button"
                className={styles.activeBreakPopupSecondaryBtn}
                onClick={openDesktopPipWidget}
                title="Pop out this timer into an always-on-top desktop window visible even when browser is minimized"
              >
                📌 Pop Out to Desktop (Always on Top)
              </button>
            )}
          </div>
        </div>
      )}

      {/* AdBlocker Forceful Overlay Modal */}
      {isAdBlockActive && (
        <div className={styles.adBlockOverlay}>
          <div className={`${styles.glass} ${styles.adBlockContent}`}>
            <div className={styles.adBlockIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 className={styles.adBlockTitle}>Adblocker Detected</h2>
            <p className={styles.adBlockDesc}>
              We detected that you are using an adblocker. Please disable your adblocker to continue using Office Time Tracker.
            </p>
            <button
              type="button"
              className={styles.adBlockBtn}
              onClick={() => window.location.reload()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Check Again & Refresh</span>
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
