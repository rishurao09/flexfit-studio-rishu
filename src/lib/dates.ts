/**
 * Centralized date/time utility layer for FlexFit Studio.
 * Handles server and client side comparisons consistently to prevent timezone drift.
 */

/**
 * Returns the current date in YYYY-MM-DD local format.
 */
export function getLocalDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Compares two dates/times.
 * Returns difference in hours.
 */
export function hoursBetween(futureIso: string, pastIso: string = new Date().toISOString()): number {
  return (new Date(futureIso).getTime() - new Date(pastIso).getTime()) / 36e5;
}

/**
 * Checks if a class is in the past.
 */
export function isPastClass(startsAtIso: string): boolean {
  return new Date(startsAtIso).getTime() < Date.now();
}
