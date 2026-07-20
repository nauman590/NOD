import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsBell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notes = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationRow[]>("/notifications"),
    enabled: !!user,
    refetchInterval: 20000,
  });

  // Real-time push: the server emits `notification.new` to the user's room the moment
  // a notification is created. `job.updated` is kept as a secondary trigger.
  useSocketEvent("notification.new", () => qc.invalidateQueries({ queryKey: ["notifications"] }));
  useSocketEvent("job.updated", () => qc.invalidateQueries({ queryKey: ["notifications"] }));

  const markAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (!user) return null;
  const unread = notes.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open && unread) markAll.mutate(); }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</div>
            <div className="max-h-96 overflow-auto">
              {notes.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet.</div>}
              {notes.map((n) => (
                <div key={n.id} className={`border-b border-border px-4 py-3 last:border-0 ${!n.readAt ? "bg-primary/5" : ""}`}>
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="text-xs text-muted-foreground">{n.body}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
