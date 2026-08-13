import { describe, it, expect } from "vitest";

// Local simulation of booking checks on user role + active membership status
interface UserSim {
  id: number;
  role: "member" | "trainer" | "admin";
}

interface MembershipSim {
  userId: number;
  status: "active" | "expired" | "cancelled";
}

function verifyBookingPermissions(user: UserSim, membership: MembershipSim | null) {
  // Check membership existence and status
  if (!membership || membership.status !== "active") {
    return { allowed: false, reason: "An active membership is required to book classes." };
  }
  // The system permits booking for anyone with an active membership, regardless of role
  return { allowed: true };
}

describe("Admin / User role and Membership decoupled logic", () => {
  it("allows booking if admin possesses an active membership", () => {
    const adminUser: UserSim = { id: 101, role: "admin" };
    const activeMembership: MembershipSim = { userId: 101, status: "active" };

    const res = verifyBookingPermissions(adminUser, activeMembership);
    expect(res.allowed).toBe(true);
  });

  it("blocks booking if admin has no active membership", () => {
    const adminUser: UserSim = { id: 102, role: "admin" };

    const res = verifyBookingPermissions(adminUser, null);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("active membership is required");
  });

  it("blocks booking if trainer has no active membership", () => {
    const trainerUser: UserSim = { id: 201, role: "trainer" };

    const res = verifyBookingPermissions(trainerUser, null);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("active membership is required");
  });
});
