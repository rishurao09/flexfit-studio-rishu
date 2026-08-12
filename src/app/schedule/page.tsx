"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

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

  const book = trpc.bookings.book.useMutation({
    onSuccess: async () => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
    },
  });

  if (isLoading) return <p className="muted">Loading schedule...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class schedule</h1>
          <p className="muted mt-1 text-sm">
            {classes?.length ?? 0} classes found
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "tomorrow", "upcoming"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`btn btn-sm capitalize ${filter === type ? "btn-primary" : ""}`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {book.error && (
        <p className="panel p-3 text-sm" style={{ color: "#f87171" }}>
          {book.error.message}
        </p>
      )}

      <div className="space-y-2">
        {classes?.map((c) => (
          <div
            key={c.id}
            className="panel flex items-center gap-4 p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{c.name}</h2>
                {c.full && (
                  <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: "#3a2a1a", color: "#fbbf24" }}>
                    Full
                  </span>
                )}
              </div>
              <p className="muted mt-0.5 text-sm">
                {formatDateTime(c.startsAt)} &middot; {c.room} &middot;{" "}
                {c.trainerName ?? "Unassigned"} &middot; {c.durationMin} min
              </p>
            </div>

            <div className="text-right text-sm muted">
              <div>
                {c.spotsLeft} / {c.capacity} left
              </div>
              <div>
                {c.creditCost} credit{c.creditCost === 1 ? "" : "s"}
              </div>
            </div>

            <button
              className="btn btn-primary"
              disabled={!user || book.isPending}
              onClick={() => book.mutate({ classId: c.id })}
            >
              {c.full ? "Join waitlist" : "Book"}
            </button>
          </div>
        ))}
      </div>

      {!user && (
        <p className="muted text-sm">Sign in to book a class.</p>
      )}
    </div>
  );
}
