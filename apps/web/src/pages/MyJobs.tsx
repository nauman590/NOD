import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell, ChevronRight, MapPin, UserCircle } from "lucide-react";
import { api, getAccessToken } from "@/lib/api";
import NotificationsBell from "@/components/NotificationsBell";
import type { Job } from "@/lib/types";
import { dollars } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Finding a pro",
  CLAIMED: "Pro assigned",
  PENDING_APPROVAL: "Quote to review",
  APPROVED: "Approved",
  DECLINED: "Add-ons declined",
  EN_ROUTE: "On the way",
  ARRIVED: "Arrived",
  IN_PROGRESS: "In progress",
  COMPLETE: "Completed",
  CANCELLED: "Cancelled",
};

export default function MyJobs() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "My jobs — Tasker";
  }, []);

  const signedIn = !!getAccessToken();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", "mine"],
    queryFn: () => api<Job[]>("/jobs/mine"),
    enabled: signedIn,
    refetchInterval: 10000,
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-16">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          {signedIn && (
            <div className="flex items-center gap-2">
              <NotificationsBell />
              <Link to="/account" aria-label="Account" className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background transition hover:bg-muted">
                <UserCircle className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>

        <h1 className="mt-5 text-3xl font-bold tracking-tight">My jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track your tasks and review quotes from your pro.</p>

        {!signedIn ? (
          <div className="mt-6 rounded-3xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Log in to see your jobs and review quotes from your pro.</p>
            <Link to="/login?redirect=/my-jobs" className="mt-4 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30">
              Log in
            </Link>
            <div className="mt-3">
              <Link to="/" className="text-xs font-medium text-muted-foreground underline underline-offset-4">Book a new job</Link>
            </div>
          </div>
        ) : isLoading ? (
          <Empty text="Loading…" />
        ) : jobs.length === 0 ? (
          <Empty text="No jobs yet. Book one from the home screen." />
        ) : (
          <div className="mt-6 space-y-3">
            {jobs.map((j) => {
              const needsReview = j.status === "PENDING_APPROVAL" && j.pendingAddOnsCents > 0;
              return (
                <button
                  key={j.id}
                  onClick={() => navigate(`/job/${j.id}`)}
                  className={`flex w-full items-center gap-3 rounded-3xl border bg-card p-4 text-left transition hover:bg-muted/40 ${
                    needsReview ? "border-primary/40 ring-2 ring-primary/15" : "border-border"
                  }`}
                >
                  {j.photoUrl ? (
                    <img src={j.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-xl bg-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold">{j.category}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{j.description}</p>
                    {j.serviceAddress && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3" /> <span className="truncate">{j.serviceAddress}</span>
                      </div>
                    )}
                    <div className="mt-1.5">
                      {needsReview ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          <Bell className="h-3 w-3" /> Quote to review · +{dollars(j.pendingAddOnsCents)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {STATUS_LABEL[j.status] ?? j.status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold">{dollars(j.customerTotalCents)}</div>
                    <ChevronRight className="ml-auto mt-1 h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mt-6 rounded-3xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">{text}</div>;
}
