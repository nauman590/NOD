import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useModal } from "@/components/ui/Modal";

const REASONS = ["Quality of work", "Provider didn't show", "Asked for off-platform payment", "Overcharged", "Damage", "Safety concern", "Other"];

export default function ReportIssue() {
  const { jobId } = useParams() as { jobId: string };
  const navigate = useNavigate();
  const modal = useModal();
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Report an issue — Tasker"; }, []);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/jobs/${jobId}/disputes`, { method: "POST", body: { reason, description } });
      await modal.alert("Report submitted", "Our team reviews disputes within 24 hours. Funds are held in escrow until resolved.");
      navigate(`/job/${jobId}`);
    } catch (e: any) {
      setBusy(false);
      await modal.alert("Couldn't submit", e?.message);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
        <Link to={`/job/${jobId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">Report an issue</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tell us what went wrong. Captured funds are held until we resolve it.</p>

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
