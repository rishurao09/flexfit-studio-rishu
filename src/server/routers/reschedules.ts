import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  reschedules,
  bookings,
  classes,
  memberships,
  corporateBookings,
  notifications,
  companies,
} from "@/db/schema";
import { router, protectedProcedure } from "../trpc";

import { getLocalDateString, hoursBetween } from "@/lib/dates";

/**
 * Members may reschedule free of charge up to this many hours before the
 * original class starts. This is more generous than cancellation policy.
 */
export const FREE_RESCHEDULE_HOURS = 4;

function hoursUntil(iso: string, now = new Date()): number {
  return hoursBetween(iso, now.toISOString());
}

async function activeMembershipFor(
  db: typeof import("@/db").db,
  userId: number,
) {
  const today = getLocalDateString();
  return db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        sql`${memberships.endDate} >= ${today}`,
      ),
    )
    .orderBy(desc(memberships.endDate))
    .get();
}

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Get the original booking with its class details
      const originalRow = await ctx.db
        .select({
          booking: bookings,
          cls: classes,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.id, input.fromBookingId))
        .get();

      if (!originalRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found.",
        });
      }

      const originalBooking = originalRow.booking;
      const originalClass = originalRow.cls;

      // Verify ownership
      if (originalBooking.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot reschedule this booking.",
        });
      }

      // Verify booking is still active
      if (originalBooking.status !== "booked" && originalBooking.status !== "waitlisted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This booking is no longer active.",
        });
      }

      // Verify reschedule is allowed (within 4 hours of original class)
      const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
      // DATA INTEGRITY RULE: Reject rescheduling if the original class has already started
      // to prevent members from rescheduling slots they already missed or completed.
      if (hoursBeforeOriginal <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reschedule a class that has already started.",
        });
      }
      if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
        });
      }

      // Get target class
      const targetClass = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.toClassId))
        .get();

      if (!targetClass) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target class not found.",
        });
      }

      // Verify target class has the same name
      if (targetClass.name !== originalClass.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can only reschedule to a class with the same name.",
        });
      }

      // Verify target class is not the same class
      if (targetClass.id === originalClass.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already booked for this class.",
        });
      }

      // Verify target class hasn't started
      if (hoursUntil(targetClass.startsAt) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This class has already started.",
        });
      }

      // Verify target class is not cancelled
      if (targetClass.cancelled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This class has been cancelled.",
        });
      }

      // Check if user already has an active booking for this class
      const existingBooking = await ctx.db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.classId, targetClass.id),
            eq(bookings.userId, ctx.user.id),
            sql`${bookings.status} in ('booked', 'waitlisted')`,
          ),
        )
        .get();

      if (existingBooking) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have an active booking for this class.",
        });
      }

      // DATA INTEGRITY / UNIFIED CAPACITY RULE: Count both standard and corporate confirmed bookings 
      // combined to determine actual physical occupancy, preventing classrooms from exceeding room limits.
      const [{ stdCount }] = await ctx.db
        .select({ stdCount: sql<number>`count(*)` })
        .from(bookings)
        .where(
          and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")),
        );

      const [{ corpCount }] = await ctx.db
        .select({ corpCount: sql<number>`count(*)` })
        .from(corporateBookings)
        .where(
          and(eq(corporateBookings.classId, targetClass.id), eq(corporateBookings.status, "booked")),
        );

      const totalBooked = Number(stdCount || 0) + Number(corpCount || 0);
      const targetIsFull = totalBooked >= targetClass.capacity;

      // Get the membership to check for unlimited credits
      const membership = originalBooking.membershipId
        ? await ctx.db
            .select()
            .from(memberships)
            .where(eq(memberships.id, originalBooking.membershipId))
            .get()
          : null;

      // SECURITY & BUSINESS RULE: Rescheduling a waitlisted booking (creditsUsed = 0) must NOT grant
      // a confirmed spot for free. Force waitlisted reschedules to remain waitlisted.
      const newStatus = originalBooking.status === "waitlisted"
        ? "waitlisted"
        : (targetIsFull ? "waitlisted" : "booked");

      const newCreditsUsed = newStatus === "waitlisted" ? 0 : originalBooking.creditsUsed;

      // DATA INTEGRITY RULE: If a confirmed booking (creditsUsed > 0) is downgraded to waitlisted in the target class,
      // refund the original credits used to the membership so they are not permanently trapped or double charged.
      if (originalBooking.status === "booked" && newStatus === "waitlisted") {
        if (membership && membership.creditsRemaining < 999) {
          await ctx.db
            .update(memberships)
            .set({ creditsRemaining: membership.creditsRemaining + originalBooking.creditsUsed })
            .where(eq(memberships.id, membership.id));
        }
      }

      // Create the new booking
      const newBooking = await ctx.db
        .insert(bookings)
        .values({
          classId: targetClass.id,
          userId: ctx.user.id,
          membershipId: originalBooking.membershipId,
          status: newStatus,
          creditsUsed: newCreditsUsed,
        })
        .returning()
        .get();

      // Cancel the original booking
      await ctx.db
        .update(bookings)
        .set({
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
        })
        .where(eq(bookings.id, originalBooking.id));

      // DATA INTEGRITY & PROMOTION RULE: Rescheduling out of a confirmed class frees a spot,
      // which must trigger unified waitlist promotion on the original class.
      if (originalBooking.status === "booked") {
        const normalWaitlist = await ctx.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.classId, originalClass.id), eq(bookings.status, "waitlisted")));

        const corpWaitlist = await ctx.db
          .select()
          .from(corporateBookings)
          .where(and(eq(corporateBookings.classId, originalClass.id), eq(corporateBookings.status, "waitlisted")));

        const combinedWaitlist = [
          ...normalWaitlist.map((w) => ({ ...w, type: "normal" as const })),
          ...corpWaitlist.map((w) => ({ ...w, type: "corporate" as const })),
        ].sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime());

        const today = new Date().toISOString().slice(0, 10);

        for (const candidate of combinedWaitlist) {
          if (candidate.type === "normal") {
            if (!candidate.membershipId) continue;
            const ms = await ctx.db
              .select()
              .from(memberships)
              .where(eq(memberships.id, candidate.membershipId))
              .get();

            const isEligible = ms &&
              ms.status === "active" &&
              ms.endDate >= today &&
              (ms.creditsRemaining >= 999 || ms.creditsRemaining >= originalClass.creditCost);

            if (isEligible) {
              await ctx.db
                .update(bookings)
                .set({ status: "booked", creditsUsed: originalClass.creditCost })
                .where(eq(bookings.id, candidate.id));

              if (ms.creditsRemaining < 999) {
                await ctx.db
                  .update(memberships)
                  .set({ creditsRemaining: ms.creditsRemaining - originalClass.creditCost })
                  .where(eq(memberships.id, ms.id));
              }

              await ctx.db.insert(notifications).values({
                userId: candidate.userId,
                type: "waitlist_promotion",
                title: "Waitlist Promotion",
                message: `Good news! You have been promoted from the waitlist to a confirmed spot in ${originalClass.name}.`,
                read: false,
              });

              break;
            }
          } else {
            const company = await ctx.db
              .select()
              .from(companies)
              .where(eq(companies.id, candidate.companyId))
              .get();

            const isEligible = company && company.active && company.creditPoolBalance >= originalClass.creditCost;

            if (isEligible) {
              await ctx.db
                .update(corporateBookings)
                .set({ status: "booked", creditsUsed: originalClass.creditCost })
                .where(eq(corporateBookings.id, candidate.id));

              await ctx.db
                .update(companies)
                .set({ creditPoolBalance: company.creditPoolBalance - originalClass.creditCost })
                .where(eq(companies.id, company.id));

              await ctx.db.insert(notifications).values({
                userId: candidate.userId,
                type: "waitlist_promotion",
                title: "Waitlist Promotion",
                message: `Good news! You have been promoted to a confirmed spot in ${originalClass.name} using your company credits.`,
                read: false,
              });

              break;
            }
          }
        }
      }

      // Record the reschedule
      await ctx.db.insert(reschedules).values({
        userId: ctx.user.id,
        fromBookingId: originalBooking.id,
        toBookingId: newBooking.id,
        fromClassId: originalClass.id,
        toClassId: targetClass.id,
      });

      return {
        ok: true,
        newBooking,
        newStatus: targetIsFull ? "waitlisted" : "booked",
      };
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),

  validateReschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get the original booking with its class details
      const originalRow = await ctx.db
        .select({
          booking: bookings,
          cls: classes,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.id, input.fromBookingId))
        .get();

      if (!originalRow) {
        return { valid: false, reason: "Booking not found." };
      }

      const originalBooking = originalRow.booking;
      const originalClass = originalRow.cls;

      // Verify ownership
      if (originalBooking.userId !== ctx.user.id) {
        return { valid: false, reason: "You cannot reschedule this booking." };
      }

      // Verify booking is still active
      if (
        originalBooking.status !== "booked" &&
        originalBooking.status !== "waitlisted"
      ) {
        return {
          valid: false,
          reason: "This booking is no longer active.",
        };
      }

      // Verify reschedule is allowed (within 4 hours of original class)
      const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
      // DATA INTEGRITY RULE: Reject rescheduling if the original class has already started.
      if (hoursBeforeOriginal <= 0) {
        return {
          valid: false,
          reason: "Cannot reschedule a class that has already started.",
        };
      }
      if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
        return {
          valid: false,
          reason: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
        };
      }

      // Get target class
      const targetClass = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.toClassId))
        .get();

      if (!targetClass) {
        return { valid: false, reason: "Target class not found." };
      }

      // Verify target class has the same name
      if (targetClass.name !== originalClass.name) {
        return {
          valid: false,
          reason: "You can only reschedule to a class with the same name.",
        };
      }

      // Verify target class is not the same class
      if (targetClass.id === originalClass.id) {
        return {
          valid: false,
          reason: "You are already booked for this class.",
        };
      }

      // Verify target class hasn't started
      if (hoursUntil(targetClass.startsAt) <= 0) {
        return {
          valid: false,
          reason: "This class has already started.",
        };
      }

      // Verify target class is not cancelled
      if (targetClass.cancelled) {
        return {
          valid: false,
          reason: "This class has been cancelled.",
        };
      }

      // Check if user already has an active booking for this class
      const existingBooking = await ctx.db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.classId, targetClass.id),
            eq(bookings.userId, ctx.user.id),
            sql`${bookings.status} in ('booked', 'waitlisted')`,
          ),
        )
        .get();

      if (existingBooking) {
        return {
          valid: false,
          reason: "You already have an active booking for this class.",
        };
      }

      // Check if target class is full (unified check)
      const [{ stdCount }] = await ctx.db
        .select({ stdCount: sql<number>`count(*)` })
        .from(bookings)
        .where(
          and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")),
        );

      const [{ corpCount }] = await ctx.db
        .select({ corpCount: sql<number>`count(*)` })
        .from(corporateBookings)
        .where(
          and(eq(corporateBookings.classId, targetClass.id), eq(corporateBookings.status, "booked")),
        );

      const targetIsFull = Number(stdCount || 0) + Number(corpCount || 0) >= targetClass.capacity;

      return {
        valid: true,
        targetIsFull,
      };
    }),
});
