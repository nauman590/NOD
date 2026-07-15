import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useModal } from "@/components/ui/Modal";

export default function RateJob() {
  const { jobId } = useParams() as { jobId: string };
  const navigate = useNavigate();
  const modal = useModal();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Rate your pro — Tasker";
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/jobs/${jobId}/rate`, { method: "POST", body: { stars, comment } });
      await modal.alert("Thanks!", "Your rating helps keep NOD high-quality.");
      navigate("/");
    } catch (e: any) {
      setBusy(false);
      await modal.alert("Couldn't submit", e?.message);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to={`/job/${jobId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Rate your pro</h1>
        <p className="mt-1 text-sm text-muted-foreground">How did it go?</p>

        <div className="mt-8 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setStars(n)} aria-label={`${n} stars`}>
              <Star className={`h-10 w-10 transition ${n <= stars ? "fill-primary text-primary" : "text-muted-foreground"}`} />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="Add a review (optional)…"
          className="mt-8 w-full resize-none rounded-2xl border border-border bg-card p-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
        />

        <button
          disabled={busy}
          onClick={submit}
          className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 disabled:opacity-60"
        >
          {busy ? "Submitting…" : "Submit rating"}
        </button>
      </div>
    </main>
  );
}
