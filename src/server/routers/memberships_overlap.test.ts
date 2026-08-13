import { describe, it, expect } from "vitest";

// Local simulation of membership bounds checking
interface ActiveMembershipCheck {
  userId: number;
  status: "active" | "expired" | "cancelled";
  endDate: string;
}

function purchaseMembership(
  userId: number,
  existingActive: ActiveMembershipCheck | null,
  today: string
) {
  if (existingActive && existingActive.status === "active" && existingActive.endDate >= today) {
    return { success: false, reason: "You already have an active membership." };
  }
  return { success: true };
}

describe("Membership overlapping constraint rules", () => {
  const today = "2026-08-13";

  it("prohibits purchasing a membership when a current membership is active", () => {
    const currentActive: ActiveMembershipCheck = {
      userId: 401,
      status: "active",
      endDate: "2026-08-30",
    };
    const res = purchaseMembership(401, currentActive, today);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("already have an active membership");
  });

  it("permits purchasing a membership if previous membership has expired", () => {
    const expiredMembership: ActiveMembershipCheck = {
      userId: 402,
      status: "active",
      endDate: "2026-08-10", // Expired
    };
    const res = purchaseMembership(402, expiredMembership, today);
    expect(res.success).toBe(true);
  });

  it("permits purchasing a membership if user has no prior membership history", () => {
    const res = purchaseMembership(403, null, today);
    expect(res.success).toBe(true);
  });
});
