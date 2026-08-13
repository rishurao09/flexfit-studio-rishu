import { describe, it, expect } from "vitest";

// Local simulation of corporate credit pools and bookings
interface CompanySim {
  id: number;
  active: boolean;
  creditPoolBalance: number;
}

interface EmployeeSim {
  userId: number;
  companyId: number;
}

function bookCorporateClass(
  employee: EmployeeSim,
  company: CompanySim | null,
  classCost: number,
  classCapacity: number,
  currentBookingsCount: number
) {
  if (!company || !company.active) {
    return { success: false, reason: "You are not linked to an active company." };
  }
  if (company.creditPoolBalance < classCost) {
    return { success: false, reason: "Your company does not have enough credits." };
  }

  const isFull = currentBookingsCount >= classCapacity;
  const status = isFull ? "waitlisted" : "booked";
  const creditsUsed = isFull ? 0 : classCost;

  const newBalance = company.creditPoolBalance - creditsUsed;

  return { success: true, status, creditsUsed, newBalance };
}

describe("Corporate credit pools and bookings rules", () => {
  const company: CompanySim = { id: 501, active: true, creditPoolBalance: 100 };
  const employee: EmployeeSim = { userId: 601, companyId: 501 };

  it("permits booking if corporate pool has enough credits", () => {
    const res = bookCorporateClass(employee, company, 10, 15, 5);
    expect(res.success).toBe(true);
    expect(res.status).toBe("booked");
    expect(res.creditsUsed).toBe(10);
    expect(res.newBalance).toBe(90);
  });

  it("blocks booking if corporate pool balance is insufficient", () => {
    const poorCompany = { ...company, creditPoolBalance: 5 };
    const res = bookCorporateClass(employee, poorCompany, 10, 15, 5);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("not have enough credits");
  });

  it("forces waitlist status if class is full and does not deduct credits", () => {
    const res = bookCorporateClass(employee, company, 10, 15, 15);
    expect(res.success).toBe(true);
    expect(res.status).toBe("waitlisted");
    expect(res.creditsUsed).toBe(0);
    expect(res.newBalance).toBe(100); // Remains unchanged
  });

  it("rejects booking if company account is deactivated", () => {
    const inactiveCompany = { ...company, active: false };
    const res = bookCorporateClass(employee, inactiveCompany, 10, 15, 5);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("not linked to an active company");
  });
});
