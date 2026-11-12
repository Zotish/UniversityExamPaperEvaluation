import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  PageHead,
  statusTone,
} from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { ExamStatus, Examination, NavState, Screen } from "../../types";

export function ExaminationsPage({
  go,
  notify,
}: {
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [exams, setExams] = useState<Examination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Active");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(res.exams);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load examinations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleArchiveToggle = async (exam: Examination) => {
    const nextStatus: ExamStatus = exam.status === "Archived" ? "Draft" : "Archived";
    try {
      await apiRequest(`/api/exams/${exam.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      notify(
        nextStatus === "Archived"
          ? `"${exam.title}" archived`
          : `"${exam.title}" restored to Draft`
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Status update failed.", "error");
    }
  };

  const filtered = exams.filter((ex) => {
    const matchesStatus =
      statusFilter === "All"
        ? true
        : statusFilter === "Active"
          ? ex.status !== "Archived"
          : ex.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      ex.title.toLowerCase().includes(q) ||
      (ex.course_code || "").toLowerCase().includes(q) ||
      (ex.course_title || "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <Shell
      screen="examinations"
      go={go}
      title="Examinations"
      breadcrumb="Faculty Workspace / Examinations"
      searchPlaceholder="Search examinations…"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <PageHead
        title="Examinations"
        action={
          <Button icon="plus" onClick={() => go("create")}>
            Create Examination
          </Button>
        }
      />

      <div className="filter-bar card">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            placeholder="Search examination or course…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by examination status"
        >
          <option value="Active">Active (Non-Archived)</option>
          <option value="All">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Awaiting Answer Key">Awaiting Answer Key</option>
          <option value="Ready for Upload">Ready for Upload</option>
          <option value="Needs Review">Needs Review</option>
          <option value="Ready to Publish">Ready to Publish</option>
          <option value="Published">Published</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="file"
          title="No examinations found"
          description="Create a new examination or adjust your status filter."
          action={
            <Button icon="plus" onClick={() => go("create")}>
              Create Examination
            </Button>
          }
        />
      ) : (
        <section className="card section-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Examination</th>
                  <th>Course</th>
                  <th>Marks / Qs</th>
                  <th>Scripts</th>
                  <th>Status</th>
                  <th>Workflow Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ex) => (
                  <tr key={ex.id}>
                    <td>
                      <strong>{ex.title}</strong>
                      <small>{ex.exam_date}</small>
                    </td>
                    <td>
                      {ex.course_code}
                      <small>{ex.course_title}</small>
                    </td>
                    <td>
                      <strong>{ex.total_marks}</strong> marks
                      <small>
                        {ex.configured_questions ?? ex.total_questions} questions · Key{" "}
                        {ex.answer_key_verified ? "Verified" : "Unverified"}
                      </small>
                    </td>
                    <td>
                      {ex.submission_count || 0} uploaded
                      <small>{ex.approved_count || 0} approved</small>
                    </td>
                    <td>
                      <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {ex.status !== "Published" && ex.status !== "Archived" && (
                          <button
                            className="link"
                            onClick={() => go("create", { examId: ex.id })}
                          >
                            Edit
                          </button>
                        )}
                        <button className="link" onClick={() => go("key", { examId: ex.id })}>
                          Answer Key
                        </button>
                        <button className="link" onClick={() => go("sheets", { examId: ex.id })}>
                          Sheets
                        </button>
                        {(ex.submission_count || 0) > 0 && (
                          <button
                            className="link"
                            onClick={() => go("results", { examId: ex.id })}
                          >
                            Results
                          </button>
                        )}
                        <button
                          className="link muted-link"
                          onClick={() => handleArchiveToggle(ex)}
                        >
                          {ex.status === "Archived" ? "Restore" : "Archive"}
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
    </Shell>
  );
}

