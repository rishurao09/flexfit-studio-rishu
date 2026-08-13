import { describe, it, expect } from "vitest";

// Local simulation of check-in and attendance marking logic
interface CheckinBookingSim {
  id: number;
  status: "booked" | "cancelled" | "attended" | "no_show" | "waitlisted";
}

function processCheckin(booking: CheckinBookingSim, userRole: string) {
  if (userRole !== "admin" && userRole !== "trainer") {
    return { success: false, reason: "Access denied. Staff only." };
  }
  if (booking.status === "cancelled") {
    return { success: false, reason: "Cancelled bookings cannot be checked in." };
  }
  if (booking.status === "waitlisted") {
    return { success: false, reason: "Waitlisted bookings cannot be checked in." };
  }
  if (booking.status === "attended") {
    return { success: false, reason: "Booking is already marked attended." };
  }
  return { success: true, updatedStatus: "attended" };
}

describe("Attendance check-in rules validation", () => {
  it("prohibits members from checking themselves in", () => {
    const booking: CheckinBookingSim = { id: 1, status: "booked" };
    const res = processCheckin(booking, "member");
    expect(res.success).toBe(false);
    expect(res.reason).toContain("Staff only");
  });

  it("permits staff/admin to mark standard booking attended", () => {
    const booking: CheckinBookingSim = { id: 2, status: "booked" };
    const res = processCheckin(booking, "admin");
    expect(res.success).toBe(true);
    expect(res.updatedStatus).toBe("attended");
  });

  it("prevents double check-ins", () => {
    const booking: CheckinBookingSim = { id: 3, status: "attended" };
    const res = processCheckin(booking, "trainer");
    expect(res.success).toBe(false);
    expect(res.reason).toContain("already marked attended");
  });

  it("prohibits checking in cancelled or waitlisted members", () => {
    const cancelSim: CheckinBookingSim = { id: 4, status: "cancelled" };
    const waitSim: CheckinBookingSim = { id: 5, status: "waitlisted" };

    expect(processCheckin(cancelSim, "admin").success).toBe(false);
    expect(processCheckin(waitSim, "trainer").success).toBe(false);
  });
});
