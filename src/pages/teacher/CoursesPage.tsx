import { useEffect, useState, type FormEvent } from "react";
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
import { apiRequest } from "../../lib/api";
import type { Course, Examination, NavState, Screen, User } from "../../types";

export function CoursesPage({
  go,
  notify,
}: {
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [semesterFilter, setSemesterFilter] = useState("All");

  // Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("Computer Science and Engineering");
  const [semester, setSemester] = useState("Fall 2026");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Course detail drawer/modal
  const [detailCourse, setDetailCourse] = useState<{
    course: Course;
    students: User[];
    exams: Examination[];
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ courses: Course[] }>("/api/courses");
      setCourses(res.courses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load courses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setCode("");
    setTitle("");
    setDepartment("Computer Science and Engineering");
    setSemester("Fall 2026");
    setDescription("");
    setModalOpen(true);
  };

  const openEdit = (c: Course) => {
    setEditing(c);
    setCode(c.code);
    setTitle(c.title);
    setDepartment(c.department);
    setSemester(c.semester);
    setDescription(c.description || "");
    setModalOpen(true);
  };

  const openDetails = async (courseId: number) => {
    try {
      const res = await apiRequest<{ course: Course; students: User[]; exams: Examination[] }>(
        `/api/courses/${courseId}`
      );
      setDetailCourse(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not load course details.", "error");
    }
  };

  const handleSaveCourse = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !title.trim()) {
      notify("Course code and title are required.", "error");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/courses/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({ code, title, department, semester, description }),
        });
        notify("Course updated successfully");
      } else {
        await apiRequest("/api/courses", {
          method: "POST",
          body: JSON.stringify({ code, title, department, semester, description }),
        });
        notify("Course created successfully");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save course.", "error");
    } finally {
      setSaving(false);
    }
  };

  const semesters = ["All", ...Array.from(new Set(courses.map((c) => c.semester)))];
  const filtered = courses.filter((c) => {
    const matchesSem = semesterFilter === "All" || c.semester === semesterFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.code.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.department.toLowerCase().includes(q);
    return matchesSem && matchesSearch;
  });

  return (
    <Shell
      screen="courses"
      go={go}
      title="My Courses"
      breadcrumb="Faculty Workspace / Courses"
      searchPlaceholder="Search courses…"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <PageHead
        title="My Courses"
        action={
          <Button icon="plus" onClick={openCreate}>
            Create Course
          </Button>
        }
      />

      <div className="filter-bar card">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            placeholder="Search by course code or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={semesterFilter}
          onChange={(e) => setSemesterFilter(e.target.value)}
          aria-label="Filter by semester"
        >
          {semesters.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All Semesters" : s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="book"
          title="No matching courses"
          description="Try clearing your filter or create a new university course."
          action={
            <Button icon="plus" onClick={openCreate}>
              Create Course
            </Button>
          }
        />
      ) : (
        <div className="course-grid">
          {filtered.map((c) => (
            <article className="card course-card" key={c.id}>
              <div className="course-card-top">
                <span className="course-code-pill">{c.code}</span>
                <Badge tone="neutral">{c.semester}</Badge>
              </div>
              <h3>{c.title}</h3>
              <p className="course-dept">{c.department}</p>
              <p className="course-desc">
                {c.description || "University undergraduate course evaluation workspace."}
              </p>
              <div className="course-stats">
                <span>
                  <Icon name="users" size={14} /> {c.enrolled_count ?? 0} Students
                </span>
                <span>
                  <Icon name="file" size={14} /> {c.exam_count ?? 0} Exams
                </span>
              </div>
              <div className="course-actions">
                <Button kind="secondary" onClick={() => openDetails(c.id)}>
                  View Details
                </Button>
                <Button kind="ghost" icon="edit" onClick={() => openEdit(c)}>
                  Edit
                </Button>
                <Button kind="primary" icon="plus" onClick={() => go("create", { courseId: c.id })}>
                  New Exam
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.code}` : "Create New Course"}
      >
        <form className="modal-form" onSubmit={handleSaveCourse}>
          <div className="form-grid">
            <label>
              Course Code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g., CSE 411"
                required
              />
            </label>
            <label>
              Semester
              <input
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                placeholder="e.g., Fall 2026"
                required
              />
            </label>
          </div>
          <label>
            Course Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Compiler Design"
              required
            />
          </label>
          <label>
            Department
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief syllabus or course summary…"
            />
          </label>
          <div className="modal-footer">
            <Button kind="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Course"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(detailCourse)}
        onClose={() => setDetailCourse(null)}
        title={
          detailCourse
            ? `${detailCourse.course.code} — ${detailCourse.course.title}`
            : "Course Details"
        }
        maxWidth={680}
      >
        {detailCourse && (
          <div className="course-detail-body">
            <p className="detail-meta">
              {detailCourse.course.department} · {detailCourse.course.semester} · Instructor:{" "}
              {detailCourse.course.teacher_name}
            </p>

            <h4>Course Examinations ({detailCourse.exams.length})</h4>
            {detailCourse.exams.length === 0 ? (
              <p className="muted-sm">No examinations created for this course yet.</p>
            ) : (
              <div className="detail-list">
                {detailCourse.exams.map((ex) => (
                  <div className="detail-row" key={ex.id}>
                    <div>
                      <strong>{ex.title}</strong>
                      <small>
                        {ex.exam_date} · {ex.total_marks} marks
                      </small>
                    </div>
                    <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
                    <button
                      className="link"
                      onClick={() => {
                        setDetailCourse(null);
                        go(
                          ex.status === "Awaiting Answer Key"
                            ? "key"
                            : ex.status === "Ready for Upload"
                              ? "sheets"
                              : ex.status === "Needs Review"
                                ? "evaluations"
                                : "results",
                          { examId: ex.id }
                        );
                      }}
                    >
                      Open →
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h4 style={{ marginTop: 18 }}>
              Enrolled Students ({detailCourse.students.length})
            </h4>
            <div className="detail-list">
              {detailCourse.students.map((st) => (
                <div className="detail-row" key={st.id}>
                  <span className="initial">{st.avatar_initials}</span>
                  <div>
                    <strong>{st.name}</strong>
                    <small>
                      {st.student_id_number} · {st.email}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

