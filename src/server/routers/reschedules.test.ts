import { describe, it, expect } from "vitest";

// Local simulation of rescheduling verification logic
interface RescheduleSim {
  originalClassStartsAt: string;
  targetClassStartsAt: string;
  originalBookingStatus: "booked" | "waitlisted" | "cancelled";
  targetClassCapacity: number;
  targetClassBookedCount: number;
}

function validateReschedule(sim: RescheduleSim, now: Date) {
  const hoursBeforeOriginal = (new Date(sim.originalClassStartsAt).getTime() - now.getTime()) / 36e5;
  const hoursBeforeTarget = (new Date(sim.targetClassStartsAt).getTime() - now.getTime()) / 36e5;

  if (hoursBeforeOriginal <= 0) {
    return { valid: false, reason: "Cannot reschedule a class that has already started." };
  }
  if (hoursBeforeOriginal < 4) {
    return { valid: false, reason: "Rescheduling cutoff passed." };
  }
  if (sim.originalBookingStatus !== "booked" && sim.originalBookingStatus !== "waitlisted") {
    return { valid: false, reason: "Booking is not active." };
  }
  if (hoursBeforeTarget <= 0) {
    return { valid: false, reason: "Target class has already started." };
  }

  const targetIsFull = sim.targetClassBookedCount >= sim.targetClassCapacity;
  const targetStatus = sim.originalBookingStatus === "waitlisted"
    ? "waitlisted"
    : (targetIsFull ? "waitlisted" : "booked");

  return { valid: true, targetStatus };
}

describe("Rescheduling system rules validation", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("blocks rescheduling past classes", () => {
    const sim: RescheduleSim = {
      originalClassStartsAt: "2026-08-13T10:00:00Z",
      targetClassStartsAt: "2026-08-13T18:00:00Z",
      originalBookingStatus: "booked",
      targetClassCapacity: 10,
      targetClassBookedCount: 5,
    };
    const res = validateReschedule(sim, now);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("already started");
  });

  it("blocks rescheduling within cutoff window (4 hours)", () => {
    const sim: RescheduleSim = {
      originalClassStartsAt: "2026-08-13T15:00:00Z", // 3 hours from now
      targetClassStartsAt: "2026-08-13T18:00:00Z",
      originalBookingStatus: "booked",
      targetClassCapacity: 10,
      targetClassBookedCount: 5,
    };
    const res = validateReschedule(sim, now);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("cutoff");
  });

  it("allows rescheduling into a full class but forces waitlisted status", () => {
    const sim: RescheduleSim = {
      originalClassStartsAt: "2026-08-13T18:00:00Z", // 6 hours from now
      targetClassStartsAt: "2026-08-13T20:00:00Z",
      originalBookingStatus: "booked",
      targetClassCapacity: 10,
      targetClassBookedCount: 10, // Full
    };
    const res = validateReschedule(sim, now);
    expect(res.valid).toBe(true);
    expect(res.targetStatus).toBe("waitlisted");
  });

  it("blocks rescheduling past target classes", () => {
    const sim: RescheduleSim = {
      originalClassStartsAt: "2026-08-13T18:00:00Z",
      targetClassStartsAt: "2026-08-13T11:00:00Z", // Past target
      originalBookingStatus: "booked",
      targetClassCapacity: 10,
      targetClassBookedCount: 5,
    };
    const res = validateReschedule(sim, now);
    expect(res.valid).toBe(false);
    expect(res.reason?.toLowerCase()).toContain("target class has already started");
  });
});
