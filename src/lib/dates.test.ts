import { describe, it, expect, vi } from "vitest";
import { isPastClass } from "./dates";

describe("isPastClass validation helper", () => {
  it("should return true if class start datetime has already passed", () => {
    // 2 hours ago
    const pastTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(isPastClass(pastTime)).toBe(true);
  });

  it("should return false if class starts later today (future-day / future-time)", () => {
    // 2 hours in the future
    const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(isPastClass(futureTime)).toBe(false);
  });

  it("should return false if class starts on a future day", () => {
    // tomorrow
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isPastClass(tomorrow)).toBe(false);
  });
});
