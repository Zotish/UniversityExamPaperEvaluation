import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { Button, ErrorBanner, Icon, LoadingState, PageHead, ProgressSteps } from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { Course, Examination, NavState, Screen } from "../../types";

export function CreateExamPage({
  examId,
  initialCourseId,
  go,
  notify,
}: {
  examId?: number;
  initialCourseId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [courseId, setCourseId] = useState<number>(initialCourseId || 0);
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalMarks, setTotalMarks] = useState("50");
  const [passThreshold, setPassThreshold] = useState("40");
  const [totalQuestions, setTotalQuestions] = useState("5");

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const cRes = await apiRequest<{ courses: Course[] }>("/api/courses");
        if (!active) return;
        setCourses(cRes.courses);

        if (examId) {
          const exRes = await apiRequest<{ exam: Examination }>(`/api/exams/${examId}`);
          if (!active) return;
          const ex = exRes.exam;
          setCourseId(ex.course_id);
          setTitle(ex.title);
          setExamDate(ex.exam_date);
          setTotalMarks(String(ex.total_marks));
          setPassThreshold(String(ex.pass_threshold ?? 40));
          setTotalQuestions(String(ex.total_questions || 5));
        } else {
          setCourseId(initialCourseId || cRes.courses[0]?.id || 0);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load form data.");
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [examId, initialCourseId]);

  const handleSave = async (asDraft: boolean) => {
    if (!courseId || !title.trim() || Number(totalMarks) <= 0 || Number(totalQuestions) <= 0) {
      notify("Please select a course, enter a title, and set positive marks/questions.", "error");
      return;
    }
    setSaving(true);
    try {
      let savedId = examId;
      if (examId) {
        await apiRequest(`/api/exams/${examId}`, {
          method: "PUT",
          body: JSON.stringify({
            courseId,
            title: title.trim(),
            examDate,
            totalMarks: Number(totalMarks),
            passThreshold: Number(passThreshold),
            totalQuestions: Number(totalQuestions),
            status: asDraft ? "Draft" : "Awaiting Answer Key",
          }),
        });
      } else {
        const res = await apiRequest<{ exam: Examination }>("/api/exams", {
          method: "POST",
          body: JSON.stringify({
            courseId,
            title: title.trim(),
            examDate,
            totalMarks: Number(totalMarks),
            passThreshold: Number(passThreshold),
            totalQuestions: Number(totalQuestions),
            status: asDraft ? "Draft" : "Awaiting Answer Key",
          }),
        });
        savedId = res.exam.id;
      }

      if (asDraft) {
        notify("Examination saved as draft");
        go("examinations");
      } else {
        notify("Examination saved — configure official answer key");
        go("key", { examId: savedId });
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save examination.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      screen="create"
      go={go}
      title={examId ? "Edit Examination" : "Create Examination"}
      breadcrumb="Examinations / Setup"
    >
      <PageHead
        title={examId ? "Edit Examination Details" : "Create Examination"}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <div className="card wizard">
          <ProgressSteps current={1} />
          <div className="form-section">
            <h3>Examination details</h3>

            <div className="form-grid">
              <label>
                Course
                <select
                  value={courseId}
                  onChange={(e) => setCourseId(Number(e.target.value))}
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title} ({c.semester})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Examination Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Data Structures Midterm 2026"
                />
              </label>

              <label>
                Examination Date
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                />
              </label>

              <label>
                Total Maximum Marks
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={totalMarks}
                  onChange={(e) => setTotalMarks(e.target.value)}
                />
              </label>

              <label>
                Initial Number of Questions
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={totalQuestions}
                  onChange={(e) => setTotalQuestions(e.target.value)}
                />
              </label>

              <label>
                Pass Percentage Threshold (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="form-actions">
            <Button kind="ghost" onClick={() => go("examinations")}>
              Cancel
            </Button>
            <div style={{ display: "flex", gap: 10 }}>
              <Button kind="secondary" disabled={saving} onClick={() => handleSave(true)}>
                Save Draft
              </Button>
              <Button disabled={saving} onClick={() => handleSave(false)}>
                {saving ? "Saving…" : "Continue to Answer Key"} <span>→</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

