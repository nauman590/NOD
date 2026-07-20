import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dollars2 } from "@/lib/types";

interface Metrics {
  totalJobs: number;
  completedJobs: number;
  totalProviders: number;
  pendingProviders: number;
  totalCustomers: number;
  totalPayoutCents: number;
  platformRevenueCents: number;
  jobsByStatus: Record<string, number>;
}

export default function AdminDashboard() {
  useEffect(() => { document.title = "Dashboard — NOD Admin"; }, []);
  const { data } = useQuery({ queryKey: ["admin", "metrics"], queryFn: () => api<Metrics>("/admin/metrics"), refetchInterval: 10000 });

  const cards = [
    { label: "Platform revenue", value: data ? dollars2(data.platformRevenueCents) : "—", accent: true },
    { label: "Provider payouts", value: data ? dollars2(data.totalPayoutCents) : "—" },
    { label: "Total jobs", value: data?.totalJobs ?? "—" },
    { label: "Completed jobs", value: data?.completedJobs ?? "—" },
    { label: "Providers", value: data?.totalProviders ?? "—" },
    { label: "Pending approval", value: data?.pendingProviders ?? "—" },
    { label: "Customers", value: data?.totalCustomers ?? "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Live platform metrics.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl border border-border p-5 ${c.accent ? "bg-primary/5" : "bg-card"}`}>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{c.label}</div>
            <div className={`mt-2 text-3xl font-bold tracking-tight ${c.accent ? "text-primary" : "text-foreground"}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Jobs by status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data && Object.entries(data.jobsByStatus).map(([k, v]) => (
            <span key={k} className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium">{k}: {v}</span>
          ))}
          {data && Object.keys(data.jobsByStatus).length === 0 && <span className="text-sm text-muted-foreground">No jobs yet.</span>}
        </div>
      </div>

      <Analytics />
    </div>
  );
}

interface AnalyticsData {
  jobsByDay: { day: string; count: number }[];
  topCategories: { name: string; count: number }[];
  providerPerformance: { name: string | null; jobs: number; ratingAvg: number; ratingCount: number; status: string }[];
  repeatCustomers: number;
  customers: number;
}

function Analytics() {
  const { data } = useQuery({ queryKey: ["admin", "analytics"], queryFn: () => api<AnalyticsData>("/admin/analytics"), refetchInterval: 15000 });
  if (!data) return null;
  const maxDay = Math.max(1, ...data.jobsByDay.map((d) => d.count));
  const retention = data.customers ? Math.round((data.repeatCustomers / data.customers) * 100) : 0;

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Jobs / day (14d)</h2>
        <div className="mt-3 flex h-24 items-end gap-1">
          {data.jobsByDay.map((d) => (
            <div key={d.day} className="flex-1 rounded-t bg-primary/70" style={{ height: `${(d.count / maxDay) * 100}%` }} title={`${d.day}: ${d.count}`} />
          ))}
          {data.jobsByDay.length === 0 && <span className="text-sm text-muted-foreground">No data yet.</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top categories</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {data.topCategories.map((c) => (
            <li key={c.name} className="flex justify-between"><span>{c.name}</span><span className="font-semibold">{c.count}</span></li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
          Customer retention: <span className="font-semibold text-foreground">{retention}%</span> ({data.repeatCustomers}/{data.customers} repeat)
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Provider performance</h2>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1">Provider</th><th className="py-1">Jobs</th><th className="py-1">Rating</th><th className="py-1">Status</th></tr>
            </thead>
            <tbody>
              {data.providerPerformance.map((p, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5">{p.name ?? "—"}</td>
                  <td className="py-1.5">{p.jobs}</td>
                  <td className="py-1.5">{p.ratingCount ? `${p.ratingAvg.toFixed(1)}★ (${p.ratingCount})` : "—"}</td>
                  <td className="py-1.5">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
