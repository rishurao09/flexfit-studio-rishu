import { describe, it, expect } from "vitest";

// Simulation of waitlist behavior
interface WaitlistCandidate {
  id: number;
  userId: number;
  bookedAt: string;
  type: "normal" | "corporate";
  membershipActive: boolean;
  membershipCredits: number;
  membershipEndDate: string;
}

function promoteCandidate(candidates: WaitlistCandidate[], today: string, cost = 1) {
  // Sort by registration time to honor queue priority
  const sorted = [...candidates].sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime());

  for (const candidate of sorted) {
    const isEligible = candidate.membershipActive && 
                       candidate.membershipEndDate >= today && 
                       candidate.membershipCredits >= cost;
    if (isEligible) {
      return { promoted: candidate, status: "booked", creditsDeducted: cost };
    }
  }
  return null;
}

describe("Waitlist Promotion Logic", () => {
  const today = "2026-08-13";

  it("promotes the oldest registered eligible waitlisted user", () => {
    const list: WaitlistCandidate[] = [
      {
        id: 1,
        userId: 101,
        bookedAt: "2026-08-13T10:00:00Z",
        type: "normal",
        membershipActive: true,
        membershipCredits: 0, // Ineligible
        membershipEndDate: "2026-08-15",
      },
      {
        id: 2,
        userId: 102,
        bookedAt: "2026-08-13T10:15:00Z",
        type: "normal",
        membershipActive: true,
        membershipCredits: 5, // Eligible
        membershipEndDate: "2026-08-15",
      },
      {
        id: 3,
        userId: 103,
        bookedAt: "2026-08-13T09:00:00Z",
        type: "normal",
        membershipActive: false, // Ineligible
        membershipCredits: 10,
        membershipEndDate: "2026-08-15",
      },
    ];

    const result = promoteCandidate(list, today, 1);
    expect(result).not.toBeNull();
    expect(result!.promoted.userId).toBe(102); // Oldest eligible candidate
    expect(result!.status).toBe("booked");
    expect(result!.creditsDeducted).toBe(1);
  });

  it("skips candidates with expired memberships", () => {
    const list: WaitlistCandidate[] = [
      {
        id: 4,
        userId: 104,
        bookedAt: "2026-08-13T08:00:00Z",
        type: "normal",
        membershipActive: true,
        membershipCredits: 10,
        membershipEndDate: "2026-08-12", // Expired yesterday
      },
    ];
    const result = promoteCandidate(list, today, 1);
    expect(result).toBeNull();
  });
});
