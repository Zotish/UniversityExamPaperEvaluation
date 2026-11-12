import { useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { NavState, Screen } from "../types";
import { Icon, Logo } from "./ui";

interface NavItem {
  label: string;
  icon: string;
  target: Screen;
  matchScreens?: Screen[];
}

const TEACHER_NAV: NavItem[] = [
  { label: "Dashboard", icon: "grid", target: "teacher" },
  { label: "My Courses", icon: "book", target: "courses" },
  {
    label: "Examinations",
    icon: "file",
    target: "examinations",
    matchScreens: ["examinations", "create", "key", "sheets", "processing"],
  },
  {
    label: "Evaluations",
    icon: "clipboard",
    target: "evaluations",
    matchScreens: ["evaluations", "review"],
  },
  {
    label: "Results",
    icon: "check",
    target: "results",
    matchScreens: ["results", "publish"],
  },
  { label: "Recheck Requests", icon: "flag", target: "teacherRechecks" },
  { label: "Reports", icon: "barChart", target: "reports" },
  { label: "Settings", icon: "settings", target: "settings" },
];

const STUDENT_NAV: NavItem[] = [
  { label: "Dashboard", icon: "grid", target: "student" },
  { label: "My Courses", icon: "book", target: "studentCourses" },
  {
    label: "My Results",
    icon: "chart",
    target: "studentResult",
    matchScreens: ["studentResult", "mistakes"],
  },
  { label: "Answer Reviews", icon: "eye", target: "studentReview" },
  { label: "Recheck Requests", icon: "flag", target: "recheck" },
  { label: "Profile", icon: "users", target: "profile" },
];

export function Shell({
  screen,
  go,
  title,
  breadcrumb,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  children,
}: {
  screen: Screen;
  go: (s: Screen, state?: NavState) => void;
  title: string;
  breadcrumb?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  children: ReactNode;
}) {
  const {
    user,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    logout,
  } = useAuth();

  const [mobileMenu, setMobileMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  if (!user) return null;

  const navItems = user.role === "teacher" ? TEACHER_NAV : STUDENT_NAV;

  const handleLogout = async () => {
    await logout();
    go("login");
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileMenu && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileMenu(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${mobileMenu ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
        <div className="side-logo">
          <Logo light compact={collapsed} />
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name="panelLeft" size={16} />
          </button>
        </div>

        <nav aria-label="Main navigation">
          {navItems.map((item) => {
            const isActive =
              screen === item.target || (item.matchScreens?.includes(screen) ?? false);
            return (
              <button
                key={item.label}
                className={isActive ? "active" : ""}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  go(item.target);
                  setMobileMenu(false);
                }}
              >
                <Icon name={item.icon} size={18} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <button className="side-logout" onClick={handleLogout} title="Sign out">
          <Icon name="logout" size={18} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-btn"
              onClick={() => setMobileMenu(!mobileMenu)}
              aria-label="Toggle navigation menu"
            >
              <Icon name="menu" />
            </button>
            <div>
              {breadcrumb && <div className="topbar-crumb">{breadcrumb}</div>}
              <h2>{title}</h2>
            </div>
          </div>

          <div className="top-actions">
            {onSearchChange && (
              <div className="topbar-search">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={searchValue || ""}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder || "Search…"}
                  aria-label={searchPlaceholder || "Search"}
                />
              </div>
            )}

            <div className="popover-anchor">
              <button
                className="icon-btn"
                aria-label="Notifications"
                onClick={() => {
                  setNotifOpen(!notifOpen);
                  setProfileOpen(false);
                }}
              >
                <Icon name="bell" size={18} />
                {unreadCount > 0 && <span className="notif-dot">{unreadCount}</span>}
              </button>

              {notifOpen && (
                <div className="popover card" role="region" aria-label="Notifications">
                  <div className="popover-head">
                    <strong>Notifications</strong>
                    {unreadCount > 0 && (
                      <button
                        className="link"
                        onClick={async () => {
                          await markAllNotificationsRead();
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="popover-list">
                    {notifications.length === 0 ? (
                      <p className="popover-empty">No notifications yet.</p>
                    ) : (
                      notifications.slice(0, 8).map((n) => (
                        <button
                          key={n.id}
                          className={`notif-item ${n.is_read ? "" : "unread"}`}
                          onClick={async () => {
                            if (!n.is_read) await markNotificationRead(n.id);
                            setNotifOpen(false);
                            if (n.link_screen) {
                              go(n.link_screen, {
                                examId: n.link_entity_id ?? undefined,
                              });
                            }
                          }}
                        >
                          <div className="notif-title-row">
                            <strong>{n.title}</strong>
                            {!n.is_read && <span className="unread-pill" />}
                          </div>
                          <p>{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="popover-anchor">
              <button
                className="profile-trigger"
                onClick={() => {
                  setProfileOpen(!profileOpen);
                  setNotifOpen(false);
                }}
                aria-label="Account menu"
              >
                <div className="avatar">{user.avatar_initials}</div>
                <div className="profile">
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === "teacher"
                      ? user.designation || "Faculty"
                      : user.student_id_number}
                  </small>
                </div>
                <span className="chevron">⌄</span>
              </button>

              {profileOpen && (
                <div className="popover profile-menu card" role="menu">
                  <div className="profile-menu-head">
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                    <span className="role-pill">
                      {user.role === "teacher" ? "Faculty Account" : "Student Account"}
                    </span>
                  </div>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setProfileOpen(false);
                      go(user.role === "teacher" ? "settings" : "profile");
                    }}
                  >
                    <Icon name="settings" size={15} />
                    {user.role === "teacher" ? "Settings & OCR Diagnostics" : "My Profile"}
                  </button>
                  <button className="menu-item danger" onClick={handleLogout}>
                    <Icon name="logout" size={15} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main>{children}</main>
      </div>
    </div>
  );
}

