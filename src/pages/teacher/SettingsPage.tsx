import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "../../components/Shell";
import { Badge, Button, LoadingState, PageHead } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest } from "../../lib/api";
import type { AuditEntry, NavState, Screen } from "../../types";

interface FacultyIdEntry {
  id: number;
  teacher_id_number: string;
  full_name: string | null;
  expected_email: string | null;
  department: string;
  designation: string;
  claimed_by_user_id: number | null;
  claimed_email: string | null;
  claimed_name: string | null;
}

export function SettingsPage({
  go,
}: {
  go: (s: Screen, state?: NavState) => void;
}) {
  const { user, ocr, ai } = useAuth();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [facultyIds, setFacultyIds] = useState<FacultyIdEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [newTid, setNewTid] = useState("");
  const [newExpectedEmail, setNewExpectedEmail] = useState("");
  const [newDesignation, setNewDesignation] = useState("Lecturer");
  const [regError, setRegError] = useState("");
  const [regSuccess, setRegSuccess] = useState("");
  const [issuing, setIssuing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [auditRes, facRes] = await Promise.all([
        apiRequest<{ logs: AuditEntry[] }>("/api/audit"),
        apiRequest<{ facultyIds: FacultyIdEntry[] }>("/api/teacher/faculty-registry"),
      ]);
      setLogs(auditRes.logs);
      setFacultyIds(facRes.facultyIds);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleIssueTeacherId = async (e: FormEvent) => {
    e.preventDefault();
    setRegError("");
    setRegSuccess("");
    if (!newTid.trim()) {
      setRegError("Enter a Teacher ID such as FAC-CSE-105.");
      return;
    }
    setIssuing(true);
    try {
      await apiRequest("/api/teacher/faculty-registry", {
        method: "POST",
        body: JSON.stringify({
          teacherIdNumber: newTid.trim(),
          expectedEmail: newExpectedEmail.trim() || undefined,
          designation: newDesignation,
        }),
      });
      setRegSuccess(`Issued Teacher ID ${newTid.trim().toUpperCase()}.`);
      setNewTid("");
      setNewExpectedEmail("");
      await loadData();
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Could not issue Teacher ID.");
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Shell
      screen="settings"
      go={go}
      title="Settings & Diagnostics"
      breadcrumb="Faculty Workspace / Settings"
    >
      <PageHead title="Settings &amp; Diagnostics" />

      <div className="analytics-grid">
        <section className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Faculty Profile</h3>
          <div className="profile-kv">
            <div>
              <span>Full Name</span>
              <strong>{user?.name}</strong>
            </div>
            <div>
              <span>Teacher ID</span>
              <strong>{user?.teacher_id_number || "FAC-CSE-101"}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong>{user?.email}</strong>
            </div>
            <div>
              <span>Designation</span>
              <strong>{user?.designation || "Faculty"}</strong>
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

        <section className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>OCR &amp; AI Provider Capabilities</h3>
          <div className="diag-list">
            <div className="diag-row">
              <div>
                <strong>Selectable PDF Text Extraction</strong>
                <small>{ocr?.providerName}</small>
              </div>
              <Badge tone={ocr?.selectablePdfText ? "green" : "amber"}>
                {ocr?.selectablePdfText ? "Operational" : "Disabled"}
              </Badge>
            </div>
            <div className="diag-row">
              <div>
                <strong>Scanned Image / Handwriting OCR</strong>
                <small>Requires GEMINI_API_KEY or OCR_API_KEY in server env</small>
              </div>
              <Badge tone={ocr?.scannedImageOcr ? "green" : "amber"}>
                {ocr?.scannedImageOcr ? "Configured" : "Manual Transcription Fallback"}
              </Badge>
            </div>
            <div className="diag-row">
              <div>
                <strong>Deterministic Grading (MCQ / T-F / Numerical)</strong>
                <small>Rule-based exact &amp; tolerance matching</small>
              </div>
              <Badge tone={ai?.deterministicGrading ? "green" : "amber"}>
                {ai?.deterministicGrading ? "Operational" : "Disabled"}
              </Badge>
            </div>
            <div className="diag-row">
              <div>
                <strong>AI Semantic Descriptive Evaluation</strong>
                <small>Requires GEMINI_API_KEY or OPENAI_API_KEY in server env</small>
              </div>
              <Badge tone={ai?.aiSemanticGrading ? "green" : "amber"}>
                {ai?.aiSemanticGrading ? "Active (Teacher Verified)" : "Disabled (Manual Grading)"}
              </Badge>
            </div>
          </div>
        </section>
      </div>

      <section className="card section-card" style={{ marginTop: 18 }}>
        <div className="section-title">
          <div>
            <h3>Institutional Teacher ID Registry</h3>
          </div>
        </div>
        <form onSubmit={handleIssueTeacherId} className="registry-form">
          <input
            placeholder="Teacher ID (e.g. FAC-CSE-105)"
            value={newTid}
            onChange={(e) => setNewTid(e.target.value)}
          />
          <input
            placeholder="Bind email (optional)"
            type="email"
            value={newExpectedEmail}
            onChange={(e) => setNewExpectedEmail(e.target.value)}
          />
          <select value={newDesignation} onChange={(e) => setNewDesignation(e.target.value)}>
            <option value="Lecturer">Lecturer</option>
            <option value="Assistant Professor">Assistant Professor</option>
            <option value="Associate Professor">Associate Professor</option>
            <option value="Professor">Professor</option>
          </select>
          <Button type="submit" disabled={issuing}>
            {issuing ? "Issuing…" : "Issue Teacher ID"}
          </Button>
        </form>
        {regError && (
          <p style={{ color: "#dc2626", fontSize: 12, padding: "0 20px 12px" }}>{regError}</p>
        )}
        {regSuccess && (
          <p style={{ color: "#16a34a", fontSize: 12, padding: "0 20px 12px" }}>{regSuccess}</p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Teacher ID</th>
                <th>Designation</th>
                <th>Assigned Email</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {facultyIds.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.teacher_id_number}</strong>
                  </td>
                  <td>{item.designation}</td>
                  <td>{item.claimed_email || item.expected_email || "Any university email"}</td>
                  <td>
                    <Badge tone={item.claimed_by_user_id ? "green" : "blue"}>
                      {item.claimed_by_user_id
                        ? `Claimed · ${item.claimed_name || "Faculty"}`
                        : "Available"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card section-card" style={{ marginTop: 18 }}>
        <div className="section-title">
          <div>
            <h3>System Audit History</h3>
          </div>
        </div>
        {loading ? (
          <LoadingState message="Loading audit log…" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.action}</strong>
                      <small>{l.details_json}</small>
                    </td>
                    <td>
                      {l.entity_type} #{l.entity_id}
                    </td>
                    <td>{l.actor_name}</td>
                    <td>{new Date(l.created_at + "Z").toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
