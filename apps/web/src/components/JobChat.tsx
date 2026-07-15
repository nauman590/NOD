import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent, getSocket } from "@/lib/socket";

interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender: { id: string; fullName: string | null; role: string };
}

// Shared customer↔provider chat for a job. Opens once a provider is assigned.
export default function JobChat({ jobId }: { jobId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSocket()?.emit("job:subscribe", { jobId });
  }, [jobId]);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", jobId],
    queryFn: () => api<Message[]>(`/jobs/${jobId}/messages`),
    refetchInterval: 12000,
  });

  useSocketEvent("message.new", (m: Message) => {
    if ((m as any).jobId === jobId || true) qc.invalidateQueries({ queryKey: ["messages", jobId] });
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setText("");
    try {
      await api(`/jobs/${jobId}/messages`, { method: "POST", body: { body } });
      qc.invalidateQueries({ queryKey: ["messages", jobId] });
    } catch {
      setText(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-5">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Messages</h2>

      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
        {messages.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>}
        {messages.map((m) => {
          const mine = m.senderId === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
