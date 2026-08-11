import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getRemoteConfig } from "firebase/remote-config";

const firebaseConfig = {
  apiKey: "AIzaSyDvH-PXfYjuUFk1HH91tgruIfHFsL6cmSA",
  authDomain: "office-time-tracker-85539.firebaseapp.com",
  databaseURL: "https://office-time-tracker-85539-default-rtdb.firebaseio.com",
  projectId: "office-time-tracker-85539",
  storageBucket: "office-time-tracker-85539.firebasestorage.app",
  messagingSenderId: "960022811188",
  appId: "1:960022811188:web:352cf5f1cec31c724db061",
  measurementId: "G-0VB6QV46V2"
};

// Initialize Firebase App (singleton)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const adminEmails = ['woxxinsolution12@gmail.com'];

/**
 * Checks if the current authenticated user is an admin.
 * Simply checks the hardcoded email list — no database calls needed.
 */
export const isAdmin = async (_uid: string, email: string | null): Promise<boolean> => {
  if (email && adminEmails.includes(email)) {
    return true;
  }
  return false;
};

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Remote Config
export const remoteConfig = getRemoteConfig(app);

// Default values — used as fallback when offline or on first load before fetch
remoteConfig.defaultConfig = {
  appConfig: 1, // 1 = show ads, 0 = hide ads
};

// Minimum interval between Remote Config fetches (1 hour in production)
remoteConfig.settings.minimumFetchIntervalMillis = 3600000;

// Apply custom parameters for Google Provider
googleProvider.setCustomParameters({
  prompt: 'select_account',
  client_id: "960022811188-vdpsvb3d8dlol59rvq35f9298cicgaib.apps.googleusercontent.com"
});
