import { Shell } from "../../components/Shell";
import { Badge, PageHead } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import type { NavState, Screen } from "../../types";

export function StudentProfilePage({
  go,
}: {
  go: (s: Screen, state?: NavState) => void;
}) {
  const { user } = useAuth();

  return (
    <Shell
      screen="profile"
      go={go}
      title="My Profile"
      breadcrumb="Student Portal / Profile"
    >
      <PageHead
        title={user?.name || "Student Profile"}
        subtitle="Stamford University Bangladesh"
      />

      <section className="card" style={{ padding: 24, maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div className="avatar" style={{ width: 52, height: 52, fontSize: 16 }}>
            {user?.avatar_initials}
          </div>
          <div>
            <h3 style={{ fontSize: 17 }}>{user?.name}</h3>
            <Badge tone="green">Active Student Account</Badge>
          </div>
        </div>

        <div className="profile-kv">
          <div>
            <span>Student ID</span>
            <strong>{user?.student_id_number}</strong>
          </div>
          <div>
            <span>University Email</span>
            <strong>{user?.email}</strong>
          </div>
          <div>
            <span>Department</span>
            <strong>{user?.department}</strong>
          </div>
          <div>
            <span>Institution</span>
            <strong>Stamford University Bangladesh</strong>
          </div>
        </div>
      </section>
    </Shell>
  );
}

