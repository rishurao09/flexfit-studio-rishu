"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ToastProvider";

type FilterType = "today" | "tomorrow" | "upcoming";

export default function SchedulePage() {
  const [filter, setFilter] = useState<FilterType>("upcoming");
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();

  // Get dates relative to client local time
  const getFilterDates = () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (filter === "today") {
      const start = now.toISOString(); // From current time
      const end = todayStr + "T23:59:59.999Z";
      return { from: start, to: end };
    } else if (filter === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(now.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      return {
        from: tomorrowStr + "T00:00:00.000Z",
        to: tomorrowStr + "T23:59:59.999Z",
      };
    } else {
      // Upcoming: from now onwards
      return { from: now.toISOString() };
    }
  };

  const queryInput = useState(() => {
    // We only compute this once per render cycle when filter changes.
    // However, to keep it updated without changing references on every render, we can track it:
    return { filter };
  })[0];

  // Stabilize the date filter parameters to prevent infinite query loops from new Date() instances
  const dates = useState(() => getFilterDates())[0];
  const [prevFilter, setPrevFilter] = useState(filter);

  let fromVal = dates.from;
  let toVal = dates.to;

  if (prevFilter !== filter) {
    const updated = getFilterDates();
    fromVal = updated.from;
    toVal = updated.to;
    setPrevFilter(filter);
    dates.from = updated.from;
    dates.to = updated.to;
  }

  const { data: classes, isLoading } = trpc.classes.list.useQuery({
    from: fromVal,
    to: toVal,
  });

  const { success, error } = useToast();

  const book = trpc.bookings.book.useMutation({
    onSuccess: async (data) => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
      if (data.status === "waitlisted") {
        success("Added to waitlist successfully.");
      } else {
        success("Booking confirmed successfully.");
      }
    },
    onError: (err) => {
      error(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 py-6 animate-pulse">
        <div className="h-10 w-48 bg-neutral-900 rounded-lg"></div>
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 bg-neutral-900 border border-neutral-800 rounded-2xl"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 py-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase">Class schedule</h1>
          <p className="muted mt-1.5 text-xs font-bold uppercase tracking-widest">
            {classes?.length ?? 0} active sessions found
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "tomorrow", "upcoming"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`btn btn-sm text-[10px] tracking-widest font-black uppercase py-2 px-4 border-neutral-950 ${filter === type ? "btn-primary" : "border-neutral-800 text-neutral-400"}`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {classes?.map((c) => (
          <div
            key={c.id}
            className="panel flex flex-col md:flex-row md:items-center gap-6 p-6 border-neutral-900 hover:border-neutral-800 transition-all duration-200"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-black uppercase tracking-tight text-neutral-100">{c.name}</h2>
                {c.full ? (
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest" style={{ background: "#2e1a05", color: "#fbbf24" }}>
                    Full
                  </span>
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest" style={{ background: "#052e16", color: "#4ade80" }}>
                    Open
                  </span>
                )}
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                {formatDateTime(c.startsAt)} &middot; {c.room} &middot;{" "}
                <span className="text-neutral-300">{c.trainerName ?? "Unassigned"}</span> &middot; {c.durationMin} min
              </p>
            </div>

            <div className="flex items-center justify-between md:justify-end gap-8 border-t md:border-t-0 border-neutral-900 pt-4 md:pt-0">
              <div className="text-left md:text-right text-xs uppercase tracking-wider font-semibold text-neutral-400">
                <div className="font-bold text-neutral-200">
                  {c.spotsLeft} / {c.capacity} spots left
                </div>
                <div className="text-[10px] muted">
                  {c.creditCost} credit{c.creditCost === 1 ? "" : "s"} required
                </div>
              </div>

              <button
                className={`btn text-xs font-black tracking-widest uppercase ${c.full ? "btn-primary" : "btn-primary bg-[#b7f000] text-black"}`}
                disabled={!user || book.isPending}
                onClick={() => book.mutate({ classId: c.id })}
              >
                {c.full ? "Waitlist" : "Book Class"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!user && (
        <div className="panel p-6 text-center border-dashed border-neutral-800">
          <p className="muted text-xs font-bold uppercase tracking-widest">Sign in to book a session.</p>
        </div>
      )}
    </div>
  );
}
