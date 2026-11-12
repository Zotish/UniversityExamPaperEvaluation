import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  Modal,
  PageHead,
  statusTone,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest } from "../../lib/api";
import type { NavState, RecheckRequest, Screen } from "../../types";

export function TeacherRechecksPage({
  go,
  notify,
}: {
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { refreshNotifications } = useAuth();
  const [rechecks, setRechecks] = useState<RecheckRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("All");

  const [active, setActive] = useState<RecheckRequest | null>(null);
  const [adjustedMarks, setAdjustedMarks] = useState("");
  const [teacherResponse, setTeacherResponse] = useState("");
  const [decision, setDecision] = useState<"Under Review" | "Resolved" | "Rejected">("Resolved");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ rechecks: RecheckRequest[] }>("/api/rechecks");
      setRechecks(res.rechecks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recheck requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openModal = (r: RecheckRequest) => {
    setActive(r);
    setAdjustedMarks(String(r.adjusted_marks ?? r.current_question_marks ?? r.original_marks));
    setTeacherResponse(r.teacher_response || "");
    setDecision(r.status === "Rejected" ? "Rejected" : "Resolved");
  };

  const handleResolve = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await apiRequest(`/api/rechecks/${active.id}`, {
        method: "PUT",
        body: JSON.stringify({
          status: decision,
          adjustedMarks: decision === "Resolved" ? Number(adjustedMarks) : undefined,
          teacherResponse,
        }),
      });
      notify(`Recheck request marked ${decision}`);
      setActive(null);
      await refreshNotifications();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to update recheck request.", "error");
    } finally {
      setSaving(false);
    }
  };

  const filtered = rechecks.filter((r) =>
    statusFilter === "All" ? true : r.status === statusFilter
  );

  return (
    <Shell
      screen="teacherRechecks"
      go={go}
      title="Recheck Requests"
      breadcrumb="Faculty Workspace / Rechecks"
    >
      <PageHead
        title="Student Recheck Requests"
        action={
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter recheck status"
          >
            <option value="All">All Statuses</option>
            <option value="Submitted">Submitted</option>
            <option value="Under Review">Under Review</option>
            <option value="Resolved">Resolved</option>
            <option value="Rejected">Rejected</option>
          </select>
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="flag"
          title="No recheck requests"
          description="Student recheck submissions for your published examinations will appear here."
        />
      ) : (
        <section className="card section-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Examination / Question</th>
                  <th>Reason &amp; Comment</th>
                  <th>Original → Final</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.student_name}</strong>
                      <small>{r.student_id_number}</small>
                    </td>
                    <td>
                      <strong>
                        {r.course_code} · Q{r.question_number}
                      </strong>
                      <small>{r.exam_title}</small>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <strong>{r.reason}</strong>
                      <small>{r.student_comment || "No supporting comment."}</small>
                    </td>
                    <td>
                      <strong>
                        {r.original_marks} / {r.question_max_marks}
                      </strong>
                      {r.adjusted_marks !== null && (
                        <small className="text-green">
                          Adjusted: {r.adjusted_marks} / {r.question_max_marks}
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button kind="secondary" onClick={() => openModal(r)}>
                          Review Request
                        </Button>
                        <button
                          className="link"
                          onClick={() =>
                            go("review", {
                              examId: r.exam_id,
                              submissionId: r.submission_id,
                              questionNumber: r.question_number,
                            })
                          }
                        >
                          Open Script
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={
          active
            ? `Recheck: ${active.student_name} (${active.student_id_number}) · Q${active.question_number}`
            : "Review Recheck"
        }
        maxWidth={640}
      >
        {active && (
          <div className="modal-form">
            <div className="recheck-compare">
              <div>
                <small>QUESTION PROMPT</small>
                <p>{active.question_text}</p>
              </div>
              <div>
                <small>STUDENT EXTRACTED ANSWER</small>
                <p>{active.extracted_answer || "No extracted answer."}</p>
              </div>
              <div>
                <small>OFFICIAL REFERENCE ANSWER</small>
                <p>{active.reference_answer}</p>
              </div>
              <div>
                <small>STUDENT REASON &amp; COMMENT</small>
                <p>
                  <strong>{active.reason}:</strong> {active.student_comment || "None"}
                </p>
              </div>
            </div>

            <div className="form-grid">
              <label>
                Decision Status
                <select
                  value={decision}
                  onChange={(e) =>
                    setDecision(e.target.value as "Under Review" | "Resolved" | "Rejected")
                  }
                >
                  <option value="Under Review">Mark Under Review</option>
                  <option value="Resolved">Resolve &amp; Confirm Marks</option>
                  <option value="Rejected">Reject Request (No Change)</option>
                </select>
              </label>

              <label>
                Adjusted Marks (Max {active.question_max_marks})
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max={active.question_max_marks}
                  disabled={decision !== "Resolved"}
                  value={adjustedMarks}
                  onChange={(e) => setAdjustedMarks(e.target.value)}
                />
              </label>
            </div>

            <label>
              Teacher Response to Student
              <textarea
                value={teacherResponse}
                onChange={(e) => setTeacherResponse(e.target.value)}
                placeholder="Explain your grading decision clearly…"
              />
            </label>

            <div className="modal-footer">
              <Button
                kind="ghost"
                onClick={() => {
                  const target = active;
                  setActive(null);
                  go("review", {
                    examId: target.exam_id,
                    submissionId: target.submission_id,
                    questionNumber: target.question_number,
                  });
                }}
              >
                <Icon name="eye" size={14} /> Open Original Sheet
              </Button>
              <Button kind="secondary" onClick={() => setActive(null)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={handleResolve}>
                {saving ? "Saving…" : "Save Decision"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

