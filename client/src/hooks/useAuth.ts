import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged , type User as FBUser } from "firebase/auth";
import { clearToken, setToken } from "../services/authService";

export type AppUser = {
    uid: string;
    email: string | null;
} | null;

export function useAuth() {
    const [user, setUser] = useState<AppUser>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(getAuth(), async (fbUser: FBUser | null) => {
            if (!fbUser) {
                clearToken();
                setUser(null);
                setLoading(false);
                return;
            }
            const idToken = await fbUser.getIdToken(true);
            setToken(idToken);
            setUser({ uid: fbUser.uid, email: fbUser.email ?? null });
            setLoading(false);
        });
        return () => unsub();
    }, []);

    return { user, loading };
}
