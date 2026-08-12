import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { bookings, classes, memberships, checkins, users, corporateBookings, notifications, companies } from "@/db/schema";
import { router, protectedProcedure, staffProcedure } from "../trpc";

import { getLocalDateString, hoursBetween } from "@/lib/dates";

/**
 * Members may cancel free of charge up to this many hours before the class
 * starts. Cancelling later still frees the spot but forfeits the credit.
 */
export const FREE_CANCELLATION_HOURS = 12;

/** Plans with this many credits are treated as unlimited and never decrement. */
export const UNLIMITED_CREDITS = 999;

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

export const bookingsRouter = router({
  mine: protectedProcedure
    .input(z.object({ includePast: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: bookings.id,
          status: bookings.status,
          creditsUsed: bookings.creditsUsed,
          bookedAt: bookings.bookedAt,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          cancelled: classes.cancelled,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.userId, ctx.user.id))
        .orderBy(asc(classes.startsAt));

      const now = new Date();
      return rows.filter((r) =>
        input.includePast ? true : new Date(r.startsAt) >= now,
      );
    }),

  book: protectedProcedure
    .input(z.object({ classId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY & BUSINESS RULE: Ensure the caller's account is active.
      // Deactivated members are prohibited from scheduling new class bookings.
      if (!ctx.user.active) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account has been deactivated.",
        });
      }

      const cls = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.classId))
        .get();

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }
      if (cls.cancelled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This class has been cancelled.",
        });
      }
      if (hoursUntil(cls.startsAt) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This class has already started.",
        });
      }

      const existing = await ctx.db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.classId, cls.id),
            eq(bookings.userId, ctx.user.id),
            inArray(bookings.status, ["booked", "waitlisted"]),
          ),
        )
        .get();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already on the list for this class.",
        });
      }

      // BUSINESS RULE: Require a membership that is active, non-expired, and non-frozen.
      const membership = await activeMembershipFor(ctx.db, ctx.user.id);
      if (!membership || membership.status !== "active") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "An active membership is required to book classes.",
        });
      }

      const unlimited = membership.creditsRemaining >= UNLIMITED_CREDITS;
      if (!unlimited && membership.creditsRemaining < cls.creditCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not enough class credits remaining.",
        });
      }

      // DATA INTEGRITY / UNIFIED CAPACITY RULE: Count both standard and corporate confirmed bookings 
      // combined to determine actual physical occupancy, preventing classrooms from exceeding room limits.
      const [{ stdCount }] = await ctx.db
        .select({ stdCount: sql<number>`count(*)` })
        .from(bookings)
        .where(
          and(eq(bookings.classId, cls.id), eq(bookings.status, "booked")),
        );

      const [{ corpCount }] = await ctx.db
        .select({ corpCount: sql<number>`count(*)` })
        .from(corporateBookings)
        .where(
          and(eq(corporateBookings.classId, cls.id), eq(corporateBookings.status, "booked")),
        );

      const totalBooked = Number(stdCount || 0) + Number(corpCount || 0);
      const isFull = totalBooked >= cls.capacity;

      const created = await ctx.db
        .insert(bookings)
        .values({
          classId: cls.id,
          userId: ctx.user.id,
          membershipId: membership.id,
          status: isFull ? "waitlisted" : "booked",
          creditsUsed: isFull ? 0 : cls.creditCost,
        })
        .returning()
        .get();

      if (!isFull && !unlimited) {
        await ctx.db
          .update(memberships)
          .set({ creditsRemaining: membership.creditsRemaining - cls.creditCost })
          .where(eq(memberships.id, membership.id));
      }

      return created;
    }),

  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ booking: bookings, cls: classes })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.id, input.bookingId))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }

      const isOwner = row.booking.userId === ctx.user.id;
      const isStaff = ctx.user.role === "admin" || ctx.user.role === "trainer";
      if (!isOwner && !isStaff) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot cancel this booking.",
        });
      }

      if (row.booking.status !== "booked" && row.booking.status !== "waitlisted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This booking is no longer active.",
        });
      }

      const refundable =
        hoursUntil(row.cls.startsAt) >= FREE_CANCELLATION_HOURS &&
        row.booking.creditsUsed > 0;

      await ctx.db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
        .where(eq(bookings.id, row.booking.id));

      if (refundable && row.booking.membershipId) {
        const ms = await ctx.db
          .select()
          .from(memberships)
          .where(eq(memberships.id, row.booking.membershipId))
          .get();

        if (ms && ms.creditsRemaining < UNLIMITED_CREDITS) {
          await ctx.db
            .update(memberships)
            .set({ creditsRemaining: ms.creditsRemaining + row.booking.creditsUsed })
            .where(eq(memberships.id, ms.id));
        }
      }

      // Freeing a confirmed spot promotes the oldest valid waitlisted member (unified across standard and corporate bookings).
      if (row.booking.status === "booked") {
        const normalWaitlist = await ctx.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.classId, row.cls.id), eq(bookings.status, "waitlisted")));

        const corpWaitlist = await ctx.db
          .select()
          .from(corporateBookings)
          .where(and(eq(corporateBookings.classId, row.cls.id), eq(corporateBookings.status, "waitlisted")));

        // Merge standard and corporate waitlist entries, sorting by registration time to honor queue priority.
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

            // WAITLIST ELIGIBILITY RULE: Verify standard membership is active, not expired, not frozen,
            // and contains sufficient class credits before promoting the candidate.
            const isEligible = ms &&
              ms.status === "active" &&
              ms.endDate >= today &&
              (ms.creditsRemaining >= UNLIMITED_CREDITS || ms.creditsRemaining >= row.cls.creditCost);

            if (isEligible) {
              await ctx.db
                .update(bookings)
                .set({ status: "booked", creditsUsed: row.cls.creditCost })
                .where(eq(bookings.id, candidate.id));

              if (ms.creditsRemaining < UNLIMITED_CREDITS) {
                await ctx.db
                  .update(memberships)
                  .set({ creditsRemaining: ms.creditsRemaining - row.cls.creditCost })
                  .where(eq(memberships.id, ms.id));
              }

              // Create waitlist promotion notification
              await ctx.db.insert(notifications).values({
                userId: candidate.userId,
                type: "waitlist_promotion",
                title: "Waitlist Promotion",
                message: `Good news! You have been promoted from the waitlist to a confirmed spot in ${row.cls.name}.`,
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

            // WAITLIST ELIGIBILITY RULE: Verify corporate account is active and has enough credits in the shared pool.
            const isEligible = company && company.active && company.creditPoolBalance >= row.cls.creditCost;

            if (isEligible) {
              await ctx.db
                .update(corporateBookings)
                .set({ status: "booked", creditsUsed: row.cls.creditCost })
                .where(eq(corporateBookings.id, candidate.id));

              await ctx.db
                .update(companies)
                .set({ creditPoolBalance: company.creditPoolBalance - row.cls.creditCost })
                .where(eq(companies.id, company.id));

              // Create waitlist promotion notification
              await ctx.db.insert(notifications).values({
                userId: candidate.userId,
                type: "waitlist_promotion",
                title: "Waitlist Promotion",
                message: `Good news! You have been promoted to a confirmed spot in ${row.cls.name} using your company credits.`,
                read: false,
              });

              break;
            }
          }
        }
      }

      return { ok: true, refunded: refundable };
    }),

  markAttended: staffProcedure
    .input(
      z.object({
        bookingId: z.number(),
        source: z.enum(["front_desk", "kiosk", "app"]).default("front_desk"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .get();

      if (!booking) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }
      if (booking.status !== "booked") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only confirmed bookings can be checked in.",
        });
      }

      await ctx.db
        .update(bookings)
        .set({ status: "attended" })
        .where(eq(bookings.id, booking.id));

      await ctx.db.insert(checkins).values({
        userId: booking.userId,
        bookingId: booking.id,
        source: input.source,
      });

      return { ok: true };
    }),

  markNoShow: staffProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .get();

      if (!booking) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }
      if (booking.status !== "booked") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only confirmed bookings can be marked as no-show.",
        });
      }

      await ctx.db
        .update(bookings)
        .set({ status: "no_show" })
        .where(eq(bookings.id, booking.id));

      return { ok: true };
    }),

  rosterFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      const standard = await ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: bookings.bookedAt,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, input.classId));

      const corporate = await ctx.db
        .select({
          bookingId: corporateBookings.id,
          status: corporateBookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: corporateBookings.bookedAt,
        })
        .from(corporateBookings)
        .innerJoin(users, eq(corporateBookings.userId, users.id))
        .where(eq(corporateBookings.classId, input.classId));

      return [
        ...standard.map((s) => ({ ...s, isCorporate: false })),
        ...corporate.map((c) => ({ ...c, isCorporate: true })),
      ].sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime());
    }),

  upcomingForMember: staffProcedure
    .input(z.object({ userId: z.number(), hoursAhead: z.number().default(2) }))
    .query(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const futureTime = new Date(Date.now() + input.hoursAhead * 60 * 60 * 1000).toISOString();

      return ctx.db
        .select({
          bookingId: bookings.id,
          bookingStatus: bookings.status,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          capacity: classes.capacity,
          trainerId: classes.trainerId,
          trainerName: users.name,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(
          and(
            eq(bookings.userId, input.userId),
            eq(bookings.status, "booked"),
            sql`${classes.startsAt} >= ${now}`,
            sql`${classes.startsAt} <= ${futureTime}`,
            eq(classes.cancelled, false),
          ),
        )
        .orderBy(classes.startsAt);
    }),

  checkinCountFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(checkins)
        .innerJoin(bookings, eq(checkins.bookingId, bookings.id))
        .where(eq(bookings.classId, input.classId));

      return { count: Number(result?.count ?? 0) };
    }),

  waitlisted: protectedProcedure.query(async ({ ctx }) => {
    const waitlistedBookings = await ctx.db
      .select({
        bookingId: bookings.id,
        classId: classes.id,
        className: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        capacity: classes.capacity,
        bookedAt: bookings.bookedAt,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          eq(bookings.userId, ctx.user.id),
          eq(bookings.status, "waitlisted"),
        ),
      )
      .orderBy(asc(classes.startsAt));

    // For each waitlisted booking, calculate position in queue
    const result = await Promise.all(
      waitlistedBookings.map(async (wb) => {
        const [{ position }] = await ctx.db
          .select({ position: sql<number>`count(*)` })
          .from(bookings)
          .where(
            and(
              eq(bookings.classId, wb.classId),
              eq(bookings.status, "waitlisted"),
              sql`${bookings.bookedAt} < ${wb.bookedAt}`,
            ),
          );

        return {
          ...wb,
          position: Number(position) + 1, // +1 because we're counting those before us
        };
      }),
    );

    return result;
  }),
});

