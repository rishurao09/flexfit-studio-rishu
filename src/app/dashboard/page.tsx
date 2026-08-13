"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate, formatDateTime } from "@/lib/format";
import { RescheduleModal } from "@/components/reschedule-modal";
import { useToast } from "@/components/ToastProvider";

export default function DashboardPage() {
  const [rescheduleModal, setRescheduleModal] = useState<{
    isOpen: boolean;
    bookingId: number;
    className: string;
    classTime: string;
  }>({
    isOpen: false,
    bookingId: 0,
    className: "",
    classTime: "",
  });

  const utils = trpc.useUtils();
  const { data: profile, isLoading } = trpc.members.profile.useQuery(undefined, {
    retry: false,
  });
  const { data: bookings } = trpc.bookings.mine.useQuery({ includePast: true });
  const { data: rescheduleHistory } = trpc.reschedules.history.useQuery();

  const { success, error } = useToast();

  const cancel = trpc.bookings.cancel.useMutation({
    onSuccess: async () => {
      await utils.bookings.mine.invalidate();
      await utils.members.profile.invalidate();
      await utils.classes.list.invalidate();
      success("Booking cancelled successfully.");
    },
    onError: (err) => {
      error(err.message);
    },
  });

  if (isLoading) return <p className="muted">Loading...</p>;
  if (!profile) return <p className="muted">Please sign in to view your bookings.</p>;

  const ms = profile.membership;
  const now = new Date();

  // DATA INTEGRITY RULE: Classification logic to split member bookings into four mutually exclusive groups.
  // This is required on the client because SQLite stores date/times as ISO strings, and splitting bookings
  // dynamically based on status and the current time ensures that historical, upcoming, cancelled,
  // and waitlist items are distinct, preventing confusion and ensuring accurate display of active bookings.

  // 1. Upcoming: Confirmed bookings where class start time is in the future or present.
  const upcomingBookings = bookings?.filter(
    (b) => b.status === "booked" && new Date(b.startsAt) >= now
  ) || [];

  // 2. Waitlisted: active waitlisted registrations where class start time is in the future or present.
  const waitlistedBookings = bookings?.filter(
    (b) => b.status === "waitlisted" && new Date(b.startsAt) >= now
  ) || [];

  // 3. Past: any class that has already started (startsAt < now) or has been checked into ('attended' / 'no_show'),
  // explicitly excluding cancelled bookings.
  const pastBookings = bookings?.filter(
    (b) => b.status !== "cancelled" && (new Date(b.startsAt) < now || b.status === "attended" || b.status === "no_show")
  ) || [];

  // 4. Cancelled: bookings that have been explicitly cancelled.
  const cancelledBookings = bookings?.filter(
    (b) => b.status === "cancelled"
  ) || [];

  const renderBookingList = (list: typeof bookings, showActions = false) => {
    if (!list || list.length === 0) {
      return (
        <div className="panel p-6 text-center border-neutral-900 bg-neutral-950/20">
          <p className="muted text-xs font-bold uppercase tracking-widest">No sessions found in this section.</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {list.map((b) => (
          <div key={b.id} className="panel flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border-neutral-900 hover:border-neutral-800 transition-colors">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-black uppercase tracking-tight text-neutral-200">{b.className}</h3>
                <span className="rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                  style={{
                    backgroundColor: b.status === "booked" ? "#052e16" : b.status === "waitlisted" ? "#2e1a05" : "#17181c",
                    color: b.status === "booked" ? "#4ade80" : b.status === "waitlisted" ? "#fbbf24" : "#9ca3af"
                  }}
                >
                  {b.status}
                </span>
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                {formatDateTime(b.startsAt)} &middot; <span className="text-neutral-300">{b.room}</span>
              </p>
            </div>

            {showActions && (b.status === "booked" || b.status === "waitlisted") && (
              <div className="flex gap-2 w-full sm:w-auto">
                {b.status === "booked" && (
                  <button
                    className="btn btn-sm text-[10px] tracking-wider font-bold py-1.5 px-3 border-neutral-800"
                    disabled={cancel.isPending}
                    onClick={() => {
                      setRescheduleModal({
                        isOpen: true,
                        bookingId: b.id,
                        className: b.className,
                        classTime: b.startsAt,
                      });
                    }}
                  >
                    Reschedule
                  </button>
                )}
                <button
                  className="btn btn-sm text-[10px] tracking-wider font-bold py-1.5 px-3 border-neutral-850 hover:border-red-900/50 hover:text-red-400"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ bookingId: b.id })}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-12 py-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 border-b border-neutral-900 pb-6">
        <div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase">
            Hello, {profile.name.split(" ")[0]}<span style={{ color: "var(--accent)" }}>.</span>
          </h1>
          <p className="muted text-xs font-bold uppercase tracking-widest mt-1.5">
            {profile.classesAttended} sessions completed &middot; Keep going!
          </p>
        </div>
      </div>

      <section className="panel p-6 border-neutral-900">
        <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400 border-b border-neutral-900 pb-4 mb-4">Membership Details</h2>
        {ms ? (
          <div className="grid gap-6 sm:grid-cols-4">
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest muted">Plan Option</span>
              <p className="text-sm font-bold uppercase text-neutral-100">{ms.planName}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest muted">Status</span>
              <p className="text-sm font-bold uppercase text-neutral-100">{ms.status}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest muted">Valid Until</span>
              <p className="text-sm font-bold uppercase text-neutral-100">{formatDate(ms.endDate)}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest muted">Class Credits</span>
              <p className="text-sm font-bold uppercase text-neutral-100" style={{ color: "var(--accent)" }}>
                {ms.creditsRemaining >= 999 ? "Unlimited" : ms.creditsRemaining}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="muted text-xs font-bold uppercase tracking-widest">
              No active membership. Pick a plan to start booking classes.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400">Upcoming bookings</h2>
        {renderBookingList(upcomingBookings, true)}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400">Waitlisted bookings</h2>
        {renderBookingList(waitlistedBookings, true)}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400">Past bookings</h2>
        {renderBookingList(pastBookings, false)}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400">Cancelled bookings</h2>
        {renderBookingList(cancelledBookings, false)}
      </section>

      {rescheduleHistory && rescheduleHistory.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-widest text-neutral-400">Reschedule history</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {rescheduleHistory.map((r) => (
              <div key={r.id} className="panel p-5 border-neutral-900 hover:border-neutral-850 transition-colors">
                <div className="text-xs space-y-1">
                  <p className="font-black uppercase tracking-tight text-neutral-200">
                    {r.fromClassName}
                  </p>
                  <p className="muted text-[10px] font-semibold uppercase tracking-wider">
                    From: {formatDateTime(r.fromClassTime ?? "")} &middot; {r.fromClassRoom}
                  </p>
                  <p className="muted text-[10px] font-semibold uppercase tracking-wider">
                    To: {formatDateTime(r.toClassTime ?? "")} &middot; {r.toClassRoom}
                  </p>
                  <p className="muted text-[9px] font-medium mt-2 pt-2 border-t border-neutral-900 block">
                    Rescheduled {formatDate(r.rescheduledAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      </div>
      <RescheduleModal
        isOpen={rescheduleModal.isOpen}
        onClose={() =>
          setRescheduleModal({ ...rescheduleModal, isOpen: false })
        }
        fromBookingId={rescheduleModal.bookingId}
        fromClassName={rescheduleModal.className}
        fromClassTime={rescheduleModal.classTime}
        onSuccess={() => {
          success("Class rescheduled successfully!");
        }}
      />
    </>
  );
}
