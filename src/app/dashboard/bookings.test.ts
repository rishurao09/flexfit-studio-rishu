import { describe, it, expect } from "vitest";

// Local simulation of booking classification logic
interface BookingSim {
  id: number;
  status: string;
  startsAt: string;
}

function classifyBookings(bookings: BookingSim[], now: Date) {
  const upcoming = bookings.filter(
    (b) => b.status === "booked" && new Date(b.startsAt) >= now
  );
  const waitlisted = bookings.filter(
    (b) => b.status === "waitlisted" && new Date(b.startsAt) >= now
  );
  const past = bookings.filter(
    (b) => b.status !== "cancelled" && (new Date(b.startsAt) < now || b.status === "attended" || b.status === "no_show")
  );
  const cancelled = bookings.filter(
    (b) => b.status === "cancelled"
  );
  return { upcoming, waitlisted, past, cancelled };
}

describe("My Bookings classification rules", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("classifies future active booking as upcoming", () => {
    const list = [{ id: 1, status: "booked", startsAt: "2026-08-13T14:00:00Z" }];
    const res = classifyBookings(list, now);
    expect(res.upcoming).toHaveLength(1);
    expect(res.past).toHaveLength(0);
  });

  it("classifies past booking as past", () => {
    const list = [{ id: 2, status: "booked", startsAt: "2026-08-13T10:00:00Z" }];
    const res = classifyBookings(list, now);
    expect(res.past).toHaveLength(1);
    expect(res.upcoming).toHaveLength(0);
  });

  it("classifies booking marked attended as past", () => {
    const list = [{ id: 3, status: "attended", startsAt: "2026-08-13T14:00:00Z" }];
    const res = classifyBookings(list, now);
    expect(res.past).toHaveLength(1);
    expect(res.upcoming).toHaveLength(0);
  });

  it("classifies waitlisted bookings separately", () => {
    const list = [{ id: 4, status: "waitlisted", startsAt: "2026-08-13T15:00:00Z" }];
    const res = classifyBookings(list, now);
    expect(res.waitlisted).toHaveLength(1);
    expect(res.upcoming).toHaveLength(0);
  });

  it("classifies cancelled bookings separately", () => {
    const list = [{ id: 5, status: "cancelled", startsAt: "2026-08-13T15:00:00Z" }];
    const res = classifyBookings(list, now);
    expect(res.cancelled).toHaveLength(1);
    expect(res.upcoming).toHaveLength(0);
  });
});
