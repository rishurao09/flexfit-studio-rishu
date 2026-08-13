import { describe, it, expect } from "vitest";

// Local simulation of cancellation logic
interface BookingSim {
  id: number;
  startsAt: string;
  creditsUsed: number;
}

function checkCancellationRefund(booking: BookingSim, now: Date, cutoffHours = 12) {
  const hoursUntilStart = (new Date(booking.startsAt).getTime() - now.getTime()) / 36e5;
  if (hoursUntilStart < 0) {
    return { error: "Cannot cancel a class that has already started." };
  }
  const refundable = hoursUntilStart >= cutoffHours && booking.creditsUsed > 0;
  return { refundable, hoursUntilStart };
}

describe("Class cancellation refund policy rules", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("permits free refunds well before the cancellation cutoff (12 hours)", () => {
    const booking = { id: 1, startsAt: "2026-08-14T02:00:00Z", creditsUsed: 1 }; // 14 hours away
    const res = checkCancellationRefund(booking, now, 12);
    expect(res.error).toBeUndefined();
    expect(res.refundable).toBe(true);
  });

  it("marks late cancellations as non-refundable (forfeits credits) past the cutoff", () => {
    const booking = { id: 2, startsAt: "2026-08-13T18:00:00Z", creditsUsed: 1 }; // 6 hours away
    const res = checkCancellationRefund(booking, now, 12);
    expect(res.error).toBeUndefined();
    expect(res.refundable).toBe(false);
  });

  it("rejects cancellations on already started/past classes", () => {
    const booking = { id: 3, startsAt: "2026-08-13T10:00:00Z", creditsUsed: 1 }; // Past
    const res = checkCancellationRefund(booking, now, 12);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("already started");
  });
});
