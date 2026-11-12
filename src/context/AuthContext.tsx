import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, getStoredToken, setStoredToken } from "../lib/api";
import type {
  AiCapabilities,
  NotificationItem,
  OcrCapabilities,
  RegisterPayload,
  User,
} from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  ocr: OcrCapabilities | null;
  ai: AiCapabilities | null;
  notifications: NotificationItem[];
  unreadCount: number;
  refreshSession: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  loginWithCredentials: (email: string, password: string) => Promise<User>;
  registerAccount: (payload: RegisterPayload) => Promise<User>;
  loginDemo: (role: "teacher" | "student") => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [ocr, setOcr] = useState<OcrCapabilities | null>(null);
  const [ai, setAi] = useState<AiCapabilities | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{ notifications: NotificationItem[] }>("/api/notifications");
      setNotifications(data.notifications);
    } catch {
      // ignore if logged out
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      try {
        const res = await apiRequest<{ user: User; ocr: OcrCapabilities; ai: AiCapabilities }>(
          "/api/auth/me"
        );
        setUser(res.user);
        setOcr(res.ocr);
        setAi(res.ai);
        await refreshNotifications();
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await apiRequest<{ user: User; ocr: OcrCapabilities; ai: AiCapabilities }>(
        "/api/auth/me"
      );
      setUser(res.user);
      setOcr(res.ocr);
      setAi(res.ai);
      await refreshNotifications();
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const loginWithCredentials = async (email: string, password: string): Promise<User> => {
    const data = await apiRequest<{
      token: string;
      user: User;
      ocr: OcrCapabilities;
      ai: AiCapabilities;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setOcr(data.ocr);
    setAi(data.ai);
    await refreshNotifications();
    return data.user;
  };

  const registerAccount = async (payload: RegisterPayload): Promise<User> => {
    const data = await apiRequest<{
      token: string;
      user: User;
      ocr: OcrCapabilities;
      ai: AiCapabilities;
    }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setOcr(data.ocr);
    setAi(data.ai);
    await refreshNotifications();
    return data.user;
  };

  const loginDemo = async (demoRole: "teacher" | "student"): Promise<User> => {
    const data = await apiRequest<{
      token: string;
      user: User;
      ocr: OcrCapabilities;
      ai: AiCapabilities;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ demoRole }),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setOcr(data.ocr);
    setAi(data.ai);
    await refreshNotifications();
    return data.user;
  };

  const logout = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setNotifications([]);
  };

  const markNotificationRead = async (id: number) => {
    await apiRequest(`/api/notifications/${id}/read`, { method: "POST" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
  };

  const markAllNotificationsRead = async () => {
    await apiRequest("/api/notifications/read-all", { method: "POST" });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        ocr,
        ai,
        notifications,
        unreadCount,
        refreshSession,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        loginWithCredentials,
        registerAccount,
        loginDemo,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

