import { describe, it, expect } from "vitest";

// Local simulation of class creation & update authorization checks
interface UserContextSim {
  id: number;
  role: "member" | "trainer" | "admin";
}

interface ClassSim {
  id: number;
  trainerId: number | null;
  capacity: number;
}

function authorizeClassMutation(
  action: "create" | "update",
  user: UserContextSim,
  inputTrainerId: number | null,
  targetClass: ClassSim | null = null
) {
  if (user.role === "member") {
    return { authorized: false, reason: "Members cannot create or modify classes." };
  }

  if (action === "create") {
    const finalTrainerId = user.role === "trainer" ? user.id : inputTrainerId;
    return { authorized: true, finalTrainerId };
  } else {
    // Update action
    if (!targetClass) {
      return { authorized: false, reason: "Class not found." };
    }
    if (user.role === "trainer" && targetClass.trainerId !== user.id) {
      return { authorized: false, reason: "Trainers may only modify classes assigned to themselves." };
    }
    const finalTrainerId = user.role === "trainer" ? targetClass.trainerId : inputTrainerId;
    return { authorized: true, finalTrainerId };
  }
}

describe("Trainer schedule management authorization rules", () => {
  const trainerA: UserContextSim = { id: 201, role: "trainer" };
  const trainerB: UserContextSim = { id: 202, role: "trainer" };
  const admin: UserContextSim = { id: 101, role: "admin" };
  const member: UserContextSim = { id: 301, role: "member" };

  it("prohibits members from performing class operations", () => {
    const res = authorizeClassMutation("create", member, 201);
    expect(res.authorized).toBe(false);
  });

  it("forces trainers to create classes under their own ID", () => {
    // Trainer A tries to create class for Trainer B
    const res = authorizeClassMutation("create", trainerA, trainerB.id);
    expect(res.authorized).toBe(true);
    expect(res.finalTrainerId).toBe(trainerA.id); // Forced to Trainer A
  });

  it("allows admin to assign a class to any valid trainer", () => {
    const res = authorizeClassMutation("create", admin, trainerB.id);
    expect(res.authorized).toBe(true);
    expect(res.finalTrainerId).toBe(trainerB.id);
  });

  it("prohibits trainers from modifying another trainer's class", () => {
    const targetClass: ClassSim = { id: 401, trainerId: trainerB.id, capacity: 15 };
    const res = authorizeClassMutation("update", trainerA, null, targetClass);
    expect(res.authorized).toBe(false);
  });

  it("allows trainers to update their own classes", () => {
    const targetClass: ClassSim = { id: 402, trainerId: trainerA.id, capacity: 15 };
    const res = authorizeClassMutation("update", trainerA, null, targetClass);
    expect(res.authorized).toBe(true);
  });
});
