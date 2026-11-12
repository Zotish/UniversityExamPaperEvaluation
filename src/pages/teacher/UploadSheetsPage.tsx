import { useEffect, useRef, useState } from "react";
import { DocumentViewer } from "../../components/DocumentViewer";
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
  ProgressSteps,
  statusTone,
} from "../../components/ui";
import { apiRequest, uploadWithProgress } from "../../lib/api";
import type { Examination, NavState, Screen, Submission, User } from "../../types";

interface UploadOutcome {
  fileName: string;
  status: "Uploaded" | "Duplicate" | "Failed";
  message: string;
}

export function UploadSheetsPage({
  examId,
  go,
  notify,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [exams, setExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | undefined>(examId);
  const [exam, setExam] = useState<Examination | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"name" | "id" | "pages">("id");
  const [previewSub, setPreviewSub] = useState<Submission | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceSubId, setReplaceSubId] = useState<number | null>(null);

  const load = async (targetId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const exList = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(exList.exams);

      const idToUse =
        targetId ||
        exList.exams.find((e) => e.status === "Ready for Upload")?.id ||
        exList.exams[0]?.id;

      if (!idToUse) {
        setExam(null);
        setLoading(false);
        return;
      }

      setSelectedExamId(idToUse);
      const detail = await apiRequest<{ exam: Examination }>(`/api/exams/${idToUse}`);
      setExam(detail.exam);

      const [subsRes, stuRes] = await Promise.all([
        apiRequest<{ submissions: Submission[] }>(`/api/exams/${idToUse}/submissions`),
        apiRequest<{ students: User[] }>(`/api/students?courseId=${detail.exam.course_id}`),
      ]);
      setSubmissions(subsRes.submissions);
      setStudents(stuRes.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load answer sheet uploader.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(examId);
  }, [examId]);

  const handleUploadFiles = async (fileList: File[]) => {
    if (!exam || fileList.length === 0) return;
    setUploading(true);
    setUploadPct(0);
    setOutcomes([]);

    const fd = new FormData();
    fileList.forEach((f) => fd.append("sheets", f));

    try {
      const res = await uploadWithProgress<{ results: UploadOutcome[] }>(
        `/api/exams/${exam.id}/sheets`,
        fd,
        setUploadPct
      );
      setOutcomes(res.results);
      const uploadedCount = res.results.filter((r) => r.status === "Uploaded").length;
      const failedNames = new Set(
        res.results.filter((r) => r.status === "Failed").map((r) => r.fileName)
      );
      setFailedFiles(fileList.filter((f) => failedNames.has(f.name)));

      if (uploadedCount > 0) {
        notify(`${uploadedCount} student answer sheet(s) uploaded`);
      } else {
        notify("No new sheets uploaded — check validation details", "error");
      }
      await load(exam.id);
    } catch (err) {
      setFailedFiles(fileList);
      notify(err instanceof Error ? err.message : "Batch upload failed.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleAssignStudent = async (subId: number, studentId: string) => {
    try {
      const res = await apiRequest<{ submission: Submission }>(`/api/submissions/${subId}/assign`, {
        method: "PUT",
        body: JSON.stringify({ studentId: studentId ? Number(studentId) : null }),
      });
      setSubmissions((prev) =>
        prev.map((s) => (s.id === subId ? { ...s, ...res.submission } : s))
      );
      notify("Student identity mapping updated");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not assign student.", "error");
    }
  };

  const handleDelete = async (subId: number) => {
    try {
      await apiRequest(`/api/submissions/${subId}`, { method: "DELETE" });
      setSubmissions((prev) => prev.filter((s) => s.id !== subId));
      notify("Script removed from batch");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove script.", "error");
    }
  };

  const handleReplace = async (file: File) => {
    if (!replaceSubId) return;
    await handleDelete(replaceSubId);
    setReplaceSubId(null);
    await handleUploadFiles([file]);
  };

  const unmappedCount = submissions.filter((s) => !s.student_id).length;

  const visibleSubmissions = submissions
    .filter((s) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (s.file_name || "").toLowerCase().includes(q) ||
        (s.student_name || s.detected_student_name || "").toLowerCase().includes(q) ||
        (s.student_id_number || s.detected_student_id || "").toLowerCase().includes(q);
      const matchesFilter =
        statusFilter === "All"
          ? true
          : statusFilter === "Unassigned"
            ? !s.student_id
            : s.processing_status === statusFilter;
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      if (sortBy === "pages") return (b.page_count || 0) - (a.page_count || 0);
      if (sortBy === "name") {
        return (a.student_name || a.file_name || "").localeCompare(
          b.student_name || b.file_name || ""
        );
      }
      return (a.student_id_number || "ZZZ").localeCompare(b.student_id_number || "ZZZ");
    });

  return (
    <Shell
      screen="sheets"
      go={go}
      title="Student Answer Sheets"
      breadcrumb={exam ? `${exam.course_code} / ${exam.title}` : "Bulk Upload"}
    >
      <PageHead
        title="Upload Student Answer Sheets"
        subtitle={exam ? `${exam.course_code} · ${exam.title}` : undefined}
        action={
          exams.length > 0 && (
            <select
              value={selectedExamId || ""}
              onChange={(e) => load(Number(e.target.value))}
              aria-label="Select examination"
              style={{ minWidth: 260 }}
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.course_code} — {ex.title}
                </option>
              ))}
            </select>
          )
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(selectedExamId)} />
      ) : !exam ? (
        <EmptyState
          icon="file"
          title="No examinations available"
          description="Create an examination and verify its answer key first."
          action={
            <Button icon="plus" onClick={() => go("create")}>
              Create Examination
            </Button>
          }
        />
      ) : (
        <>
          <div className="card wizard">
            <ProgressSteps current={3} />
            <div className="upload-area">
              {!exam.answer_key_verified && (
                <div className="verify-banner" style={{ marginTop: 0 }}>
                  <Icon name="alert" />
                  <div>
                    <strong>Answer key not verified yet</strong>
                    <p>
                      You can upload student scripts now, but you must verify the official answer
                      key and rubric before starting evaluation.
                    </p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) handleUploadFiles(files);
                  e.target.value = "";
                }}
              />

              <input
                ref={replaceInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleReplace(f);
                  e.target.value = "";
                }}
              />

              <div
                className={`dropzone ${submissions.length > 0 ? "uploaded" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length) handleUploadFiles(files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                {uploading ? (
                  <>
                    <span className="upload-icon">
                      <Icon name="upload" size={24} />
                    </span>
                    <strong>Uploading batch scripts… {uploadPct}%</strong>
                    <div className="progress" style={{ width: 260, marginTop: 12 }}>
                      <i style={{ width: `${uploadPct}%` }} />
                    </div>
                  </>
                ) : (
                  <>
                    <span className={submissions.length > 0 ? "upload-ok" : "upload-icon"}>
                      <Icon name={submissions.length > 0 ? "check" : "upload"} size={24} />
                    </span>
                    <strong>
                      Drop student answer sheets here, or <span>browse multiple files</span>
                    </strong>
                    <p>
                      Supported formats: PDF, JPG, JPEG, PNG · Max 20 MB per file · Duplicate files
                      are detected automatically
                    </p>
                    <span className="browse">Select Answer Sheets</span>
                  </>
                )}
              </div>

              {outcomes.length > 0 && (
                <div className="upload-outcomes">
                  {outcomes.map((o, i) => (
                    <div className={`outcome-row ${o.status.toLowerCase()}`} key={i}>
                      <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                      <strong>{o.fileName}</strong>
                      <span>{o.message}</span>
                    </div>
                  ))}
                  {failedFiles.length > 0 && (
                    <Button
                      kind="secondary"
                      icon="refresh"
                      onClick={() => handleUploadFiles(failedFiles)}
                    >
                      Retry {failedFiles.length} Failed Upload(s)
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <section className="card section-card files-card">
            <div className="section-title">
              <div>
                <h3>Batch Processing Queue ({submissions.length})</h3>
                <p>
                  Verify student identity mappings before processing. Unmatched scripts require
                  manual selection.
                </p>
              </div>
              <Badge tone={unmappedCount > 0 ? "amber" : "green"}>
                {unmappedCount > 0
                  ? `${unmappedCount} needs identity mapping`
                  : `${submissions.length} ready`}
              </Badge>
            </div>

            <div className="table-toolbar">
              <div className="search">
                <Icon name="search" size={16} />
                <input
                  placeholder="Search file name, student name, or ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter scripts"
              >
                <option value="All">All scripts</option>
                <option value="Unassigned">Needs identity mapping</option>
                <option value="Pending">Pending processing</option>
                <option value="Completed">Completed</option>
                <option value="Flagged">Flagged</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "name" | "id" | "pages")}
                aria-label="Sort scripts"
              >
                <option value="id">Sort by Student ID</option>
                <option value="name">Sort by Student Name</option>
                <option value="pages">Sort by Page Count</option>
              </select>
            </div>

            {visibleSubmissions.length === 0 ? (
              <EmptyState
                icon="upload"
                title="No uploaded scripts yet"
                description="Use the dropzone above to upload PDF or image answer scripts for this examination."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Student Assignment</th>
                      <th>Student ID</th>
                      <th>Pages</th>
                      <th>Upload</th>
                      <th>Processing</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSubmissions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="file-cell">
                            <Icon name="file" size={15} />
                            <strong>{s.file_name || "Uploaded Script"}</strong>
                          </div>
                        </td>
                        <td>
                          <select
                            className={`table-select ${!s.student_id ? "unassigned" : ""}`}
                            value={s.student_id || ""}
                            onChange={(e) => handleAssignStudent(s.id, e.target.value)}
                            aria-label={`Select student for ${s.file_name}`}
                          >
                            <option value="">-- Select Student --</option>
                            {students.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.name} ({st.student_id_number})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{s.student_id_number || "Unassigned"}</td>
                        <td>{s.page_count || 1}</td>
                        <td>
                          <Badge tone={statusTone(s.upload_status)}>{s.upload_status}</Badge>
                        </td>
                        <td>
                          <Badge tone={statusTone(s.processing_status)}>{s.processing_status}</Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="link" onClick={() => setPreviewSub(s)}>
                              Preview
                            </button>
                            {exam.status !== "Published" && (
                              <>
                                <button
                                  className="link"
                                  onClick={() => {
                                    setReplaceSubId(s.id);
                                    replaceInputRef.current?.click();
                                  }}
                                >
                                  Replace
                                </button>
                                <button
                                  className="link text-red"
                                  onClick={() => handleDelete(s.id)}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="sticky-actions">
            <Button kind="secondary" onClick={() => go("key", { examId: exam.id })}>
              ← Back to Answer Key
            </Button>
            <Button
              disabled={submissions.length === 0 || unmappedCount > 0 || !exam.answer_key_verified}
              onClick={() => go("processing", { examId: exam.id })}
            >
              Start Evaluation <span>→</span>
            </Button>
          </div>
        </>
      )}

      <Modal
        open={Boolean(previewSub)}
        onClose={() => setPreviewSub(null)}
        title={previewSub ? `Preview: ${previewSub.file_name}` : "Script Preview"}
        maxWidth={760}
      >
        {previewSub && (
          <DocumentViewer
            fileId={previewSub.document_id}
            fileName={previewSub.file_name}
            totalPages={previewSub.page_count || 1}
          />
        )}
      </Modal>
    </Shell>
  );
}

