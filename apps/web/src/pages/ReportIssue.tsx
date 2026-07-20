import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Plus, X } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useModal } from "@/components/ui/Modal";

const REASONS = ["Quality of work", "Provider didn't show", "Asked for off-platform payment", "Overcharged", "Damage", "Safety concern", "Other"];
const OFF_PLATFORM_REASON = "Asked for off-platform payment";
const MAX_PHOTOS = 6;

interface DisputeThreadItem {
  id: string;
  status: string;
  reason: string;
  description: string | null;
  resolution: string | null;
  createdAt: string;
  raisedBy: { id: string; fullName: string | null; role: string } | null;
  photos: { id: string; url: string }[];
}

const DISPUTE_STATUS_CLS: Record<string, string> = {
  OPEN: "bg-amber-500/15 text-amber-600",
  UNDER_REVIEW: "bg-primary/10 text-primary",
  RESOLVED: "bg-primary/10 text-primary",
  REJECTED: "bg-destructive/10 text-destructive",
};
const isOpenDispute = (s: string) => s === "OPEN" || s === "UNDER_REVIEW";

export default function ReportIssue() {
  const { jobId } = useParams() as { jobId: string };
  const navigate = useNavigate();
  const { user } = useAuth();
  const modal = useModal();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which existing dispute we're attaching an evidence photo to (if any).
  const [addingTo, setAddingTo] = useState<string | null>(null);

  useEffect(() => { document.title = "Report an issue — Tasker"; }, []);

  // Existing disputes on this job — visible to and participable by BOTH parties.
  const { data: disputes = [] } = useQuery({
    queryKey: ["job-disputes", jobId],
    queryFn: () => api<DisputeThreadItem[]>(`/jobs/${jobId}/disputes`),
  });

  // Attach a photo to an already-open dispute (evidence added after filing).
  const addEvidence = async (file: File, disputeId: string) => {
    setAddingTo(disputeId);
    try {
      const { url } = await uploadFile(file);
      await api(`/disputes/${disputeId}/photos`, { method: "POST", body: { url } });
      await qc.invalidateQueries({ queryKey: ["job-disputes", jobId] });
    } catch (e: any) {
      await modal.alert("Couldn't add photo", e?.message || "Please try again.");
    } finally {
      setAddingTo(null);
    }
  };

  // Where "Back" and post-submit navigation should land, per role.
  const backTo = user?.role === "PROVIDER" ? "/provider" : `/job/${jobId}`;

  const addPhoto = async (file: File) => {
    if (photos.length >= MAX_PHOTOS) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setPhotos((p) => [...p, url]);
    } catch (e: any) {
      await modal.alert("Couldn't upload", e?.message || "Please try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      // Off-platform payment attempts go through the report → verify → ban path, not
      // the standard dispute queue (Sprint 4, item 4).
      if (reason === OFF_PLATFORM_REASON) {
        await api(`/jobs/${jobId}/report-off-platform`, {
          method: "POST",
          body: { description: description?.trim() || "Requested off-platform payment.", evidenceUrl: photos[0] },
        });
        await modal.alert(
          "Report submitted",
          "Our team verifies every off-platform report. If confirmed, the account involved is immediately banned.",
        );
      } else {
        await api(`/jobs/${jobId}/disputes`, { method: "POST", body: { reason, description, photoUrls: photos } });
        await modal.alert("Report submitted", "Our team reviews disputes within 24 hours. Captured funds are held in escrow until resolved.");
      }
      navigate(backTo);
    } catch (e: any) {
      setBusy(false);
      await modal.alert("Couldn't submit", e?.message);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">Report an issue</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tell us what went wrong. Captured funds are held until we resolve it.</p>

        {/* Existing disputes on this job — both parties can follow along and add evidence. */}
        {disputes.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Your reports on this job</h2>
            <div className="space-y-3">
              {disputes.map((d) => (
                <div key={d.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${DISPUTE_STATUS_CLS[d.status] ?? "bg-muted"}`}>
                      {d.status.replace("_", " ")}
                    </span>
                    <span className="text-sm font-semibold">{d.reason}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    by {d.raisedBy?.id === user?.id ? "you" : d.raisedBy?.fullName ?? "the other party"} ({d.raisedBy?.role?.toLowerCase()}) · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                  {d.description && <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>}
                  {d.resolution && <p className="mt-2 text-xs text-primary">Resolution: {d.resolution}</p>}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.photos.map((ph) => (
                      <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer">
                        <img src={ph.url} alt="evidence" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
                      </a>
                    ))}
                    {isOpenDispute(d.status) && (
                      <label
                        className={`flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-[10px] font-medium text-muted-foreground hover:border-primary hover:text-primary ${addingTo === d.id ? "opacity-60" : ""}`}
                        title="Add an evidence photo"
                      >
                        {addingTo === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Add
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={!!addingTo}
                          onChange={(e) => e.target.files?.[0] && addEvidence(e.target.files[0], d.id)}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Reason</label>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                  reason === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Details</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe what happened…"
            className="w-full resize-none rounded-2xl border border-border bg-card p-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </div>

        {/* Evidence photos — either party can attach them (Sprint 5, item 1). */}
        <div className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Photos (optional)</label>
          <div className="flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={url} className="relative">
                <img src={url} alt={`evidence ${i + 1}`} className="h-20 w-20 rounded-xl object-cover" />
                <button
                  onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                  aria-label="Remove photo"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-card text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Add
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
        </div>

        <button
          disabled={!reason || busy}
          onClick={submit}
          className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        >
          {busy ? "Submitting…" : "Submit report"}
        </button>
      </div>
    </main>
  );
}
