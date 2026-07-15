import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Settings, Landmark, UserCog, ExternalLink, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import NotificationsBell from "@/components/NotificationsBell";

// Shared provider header: title + notifications + an account menu that exposes
// payouts/setup (Stripe Connect), account settings, customer view and logout.
export default function ProviderHeader({ title }: { title: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const item = "flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition hover:bg-muted";

  return (
    <header className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <div className="flex items-center gap-2">
          <NotificationsBell />
          <div className="relative" ref={ref}>
            <button
              onClick={() => setOpen((o) => !o)}
              aria-label="Account menu"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background transition hover:bg-muted"
            >
              <Settings className="h-4 w-4" />
            </button>
            {open && (
              <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-xl">
                <Link to="/provider/onboarding" onClick={() => setOpen(false)} className={item}>
                  <Landmark className="h-4 w-4 text-muted-foreground" /> Payouts &amp; setup
                </Link>
                <Link to="/provider/account" onClick={() => setOpen(false)} className={item}>
                  <UserCog className="h-4 w-4 text-muted-foreground" /> Account settings
                </Link>
                <Link to="/" onClick={() => setOpen(false)} className={item}>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" /> Customer view
                </Link>
                <div className="my-1 border-t border-border" />
                <button onClick={() => { logout(); navigate("/"); }} className={`${item} text-destructive`}>
                  <LogOut className="h-4 w-4" /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Find work nearby and manage active tasks.</p>
    </header>
  );
}
