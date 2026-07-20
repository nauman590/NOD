import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useModal } from "@/components/ui/Modal";

interface Party {
  id: string;
  fullName: string | null;
  email: string | null;
  role: string;
  suspendedUntil?: string | null;
  provider?: { status: string } | null;
}
interface ReportRow {
  id: string;
  status: "PENDING" | "VERIFIED" | "DISMISSED";
  description: string;
  evidenceUrl: string | null;
  banApplied: boolean;
  createdAt: string;
  reporter: Party;
  reportedUser: Party;
  job: { id: string; category: { name: string } | null } | null;
}

const STATUS_CLS: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-600",
  VERIFIED: "bg-destructive/10 text-destructive",
  DISMISSED: "bg-muted text-muted-foreground",
};

const label = (p: Party) => p.fullName || p.email || "—";

export default function AdminOffPlatform() {
  useEffect(() => { document.title = "Off-platform reports — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const { data: reports = [] } = useQuery({
    queryKey: ["admin", "off-platform"],
    queryFn: () => api<ReportRow[]>("/admin/off-platform-reports"),
    refetchInterval: 15000,
  });

  const verify = useMutation({
    mutationFn: (id: string) => api(`/admin/off-platform-reports/${id}/verify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e: any) => modal.alert("Couldn't verify", e?.message || "Please try again."),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/admin/off-platform-reports/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e: any) => modal.alert("Couldn't dismiss", e?.message || "Please try again."),
  });

  const onVerify = async (r: ReportRow) => {
    if (
      await modal.confirm({
        title: `Verify & ban ${label(r.reportedUser)}?`,
        body: `This immediately bans the ${r.reportedUser.role.toLowerCase()} for soliciting off-platform payment. This can't be undone from here.`,
        confirmLabel: "Verify & ban",
        cancelLabel: "Cancel",
        destructive: true,
      })
    )
      verify.mutate(r.id);
  };

  const pending = reports.filter((r) => r.status === "PENDING").length;

  return (
    <div>
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-6 w-6 text-destructive" />
        <h1 className="text-2xl font-bold tracking-tight">Off-platform payment reports</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Report → verify → immediate ban. {pending > 0 ? `${pending} awaiting review.` : "All caught up."}
      </p>

      <div className="mt-6 space-y-3">
        {reports.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">No reports.</div>
        )}
        {reports.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[r.status] ?? "bg-muted"}`}>
                    {r.status}
                  </span>
                  {r.banApplied && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">Banned</span>}
                  <span className="text-sm font-semibold">{r.job?.category?.name ?? "Off-platform report"}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  Reported: <span className="font-medium text-foreground">{label(r.reportedUser)}</span> ({r.reportedUser.role.toLowerCase()})
                  {" · "}by {label(r.reporter)} ({r.reporter.role.toLowerCase()})
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{r.description}</p>
                {r.evidenceUrl && (
                  <a href={r.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-2">
                    View evidence
                  </a>
                )}
              </div>
              {r.status === "PENDING" && (
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    disabled={verify.isPending}
                    onClick={() => onVerify(r)}
                    className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    Verify &amp; ban
                  </button>
                  <button
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(r.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
