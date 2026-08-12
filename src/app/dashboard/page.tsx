"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate, formatDateTime } from "@/lib/format";
import { RescheduleModal } from "@/components/reschedule-modal";

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

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: profile, isLoading } = trpc.members.profile.useQuery(undefined, {
    retry: false,
  });
  const { data: bookings } = trpc.bookings.mine.useQuery({ includePast: true });
  const { data: rescheduleHistory } = trpc.reschedules.history.useQuery();

  const cancel = trpc.bookings.cancel.useMutation({
    onSuccess: async () => {
      await utils.bookings.mine.invalidate();
      await utils.members.profile.invalidate();
      await utils.classes.list.invalidate();
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
      return <p className="muted text-sm">No bookings in this section.</p>;
    }

    return (
      <div className="space-y-2">
        {list.map((b) => (
          <div key={b.id} className="panel flex items-center gap-2 p-4 flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{b.className}</h3>
                <span className="muted text-xs uppercase tracking-wide">
                  {b.status}
                </span>
              </div>
              <p className="muted mt-0.5 text-sm">
                {formatDateTime(b.startsAt)} &middot; {b.room}
              </p>
            </div>

            {showActions && (b.status === "booked" || b.status === "waitlisted") && (
              <div className="flex gap-2 w-full sm:w-auto">
                {b.status === "booked" && (
                  <button
                    className="btn text-sm flex-1 sm:flex-none"
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
                  className="btn text-sm flex-1 sm:flex-none"
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hello, {profile.name.split(" ")[0]}
        </h1>
        <p className="muted mt-1 text-sm">
          {profile.classesAttended} classes attended
        </p>
      </div>

      <section className="panel p-5">
        <h2 className="font-medium">Membership</h2>
        {ms ? (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="muted">Plan</dt>
              <dd>{ms.planName}</dd>
            </div>
            <div>
              <dt className="muted">Status</dt>
              <dd>{ms.status}</dd>
            </div>
            <div>
              <dt className="muted">Valid until</dt>
              <dd>{formatDate(ms.endDate)}</dd>
            </div>
            <div>
              <dt className="muted">Credits</dt>
              <dd>{ms.creditsRemaining >= 999 ? "Unlimited" : ms.creditsRemaining}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted mt-2 text-sm">
            No active membership. Pick a plan to start booking classes.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Upcoming bookings</h2>

        {successMessage && (
          <p className="panel p-3 text-sm" style={{ color: "#4ade80" }}>
            {successMessage}
          </p>
        )}

        {cancel.error && (
          <p className="panel p-3 text-sm" style={{ color: "#f87171" }}>
            {cancel.error.message}
          </p>
        )}

        {renderBookingList(upcomingBookings, true)}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Waitlisted bookings</h2>
        {renderBookingList(waitlistedBookings, true)}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Past bookings</h2>
        {renderBookingList(pastBookings, false)}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Cancelled bookings</h2>
        {renderBookingList(cancelledBookings, false)}
      </section>

      {rescheduleHistory && rescheduleHistory.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Reschedule history</h2>
          <div className="space-y-2">
            {rescheduleHistory.map((r) => (
              <div key={r.id} className="panel p-4">
                <div className="text-sm">
                  <p className="font-medium">
                    {r.fromClassName}
                  </p>
                  <p className="muted text-xs mt-1">
                    From: {formatDateTime(r.fromClassTime ?? "")} • {r.fromClassRoom}
                  </p>
                  <p className="muted text-xs">
                    To: {formatDateTime(r.toClassTime ?? "")} • {r.toClassRoom}
                  </p>
                  <p className="muted text-xs mt-1">
                    Rescheduled {formatDate(r.rescheduledAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <RescheduleModal
        isOpen={rescheduleModal.isOpen}
        onClose={() =>
          setRescheduleModal({ ...rescheduleModal, isOpen: false })
        }
        fromBookingId={rescheduleModal.bookingId}
        fromClassName={rescheduleModal.className}
        fromClassTime={rescheduleModal.classTime}
        onSuccess={() => {
          setSuccessMessage("Class rescheduled successfully!");
          setTimeout(() => setSuccessMessage(null), 3000);
        }}
      />
    </div>
  );
}
