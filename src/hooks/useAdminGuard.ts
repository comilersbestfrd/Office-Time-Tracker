import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth, isAdmin } from '@/lib/firebase';

/**
 * Hook that checks if the current user is an admin.
 * - Returns `isAdminUser` (boolean) and `loading` (boolean).
 * - If the user is not an admin, redirects to the home page.
 */
export const useAdminGuard = () => {
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/');
        setLoading(false);
        return;
      }
      const admin = await isAdmin(user.uid, user.email);
      if (!admin) {
        router.replace('/');
      }
      setIsAdminUser(admin);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  return { isAdminUser, loading };
};
