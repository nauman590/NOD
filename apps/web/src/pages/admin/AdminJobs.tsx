import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dollars2 } from "@/lib/types";

interface JobRow {
  id: string;
  status: string;
  basePriceCents: number;
  createdAt: string;
  serviceAddress: string | null;
  category: { name: string } | null;
  customer: { fullName: string | null; email: string | null } | null;
  provider: { user: { fullName: string | null } } | null;
}

const STATUS_CLS: Record<string, string> = {
  AVAILABLE: "bg-amber-500/15 text-amber-600",
  COMPLETE: "bg-primary/10 text-primary",
  CANCELLED: "bg-destructive/10 text-destructive",
};

export default function AdminJobs() {
  useEffect(() => { document.title = "Jobs — NOD Admin"; }, []);
  const { data: jobs = [] } = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => api<JobRow[]>("/admin/jobs"), refetchInterval: 10000 });

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
      <p className="mt-1 text-sm text-muted-foreground">All jobs across the platform.</p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Base</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-3 font-medium">{j.category?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[j.status] ?? "bg-muted text-muted-foreground"}`}>
                    {j.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{j.customer?.fullName ?? j.customer?.email ?? "guest"}</td>
                <td className="px-4 py-3 text-muted-foreground">{j.provider?.user.fullName ?? "—"}</td>
                <td className="px-4 py-3 max-w-[220px] truncate text-xs text-muted-foreground">{j.serviceAddress ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold">{dollars2(j.basePriceCents)}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
