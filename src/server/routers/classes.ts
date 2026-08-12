import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { classes, bookings, users } from "@/db/schema";
import { router, publicProcedure, staffProcedure, adminProcedure } from "../trpc";

export const classesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
          includeCancelled: z.boolean().default(false),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.from) filters.push(gte(classes.startsAt, input.from));
      if (input.to) filters.push(lte(classes.startsAt, input.to));
      if (!input.includeCancelled) filters.push(eq(classes.cancelled, false));

      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          description: classes.description,
          room: classes.room,
          capacity: classes.capacity,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          creditCost: classes.creditCost,
          cancelled: classes.cancelled,
          trainerName: users.name,
          booked: sql<number>`(
            select count(*) from ${bookings}
            where ${bookings.classId} = ${classes.id}
              and ${bookings.status} = 'booked'
          )`.as("booked"),
        })
        .from(classes)
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(classes.startsAt));

      return rows.map((r) => ({
        ...r,
        spotsLeft: Math.max(0, r.capacity - Number(r.booked)),
        full: Number(r.booked) >= r.capacity,
      }));
    }),

  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const cls = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.id))
        .get();

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      const roster = await ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberName: users.name,
          memberEmail: users.email,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, cls.id));

      return { ...cls, roster };
    }),

  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        trainerId: z.number().optional(),
        room: z.string().min(1),
        capacity: z.number().int().positive(),
        startsAt: z.string(),
        durationMin: z.number().int().positive().default(60),
        creditCost: z.number().int().min(0).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let finalTrainerId: number | null = null;

      if (ctx.user.role === "trainer") {
        // SECURITY RULE: Force trainers to only schedule classes for themselves
        // to prevent scheduling classes under another trainer's name.
        finalTrainerId = ctx.user.id;
      } else if (ctx.user.role === "admin") {
        if (input.trainerId !== undefined && input.trainerId !== null) {
          // SECURITY RULE: Validate that the client-supplied trainer exists 
          // and actually holds the trainer role in the database to prevent
          // assigning class instruction duties to invalid or unauthorized users.
          const targetTrainer = await ctx.db
            .select()
            .from(users)
            .where(eq(users.id, input.trainerId))
            .get();

          if (!targetTrainer || targetTrainer.role !== "trainer") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The specified trainer does not exist or is not a trainer.",
            });
          }
          finalTrainerId = input.trainerId;
        }
      }

      return ctx.db
        .insert(classes)
        .values({
          ...input,
          description: input.description ?? null,
          trainerId: finalTrainerId,
        })
        .returning()
        .get();
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        room: z.string().min(1).optional(),
        capacity: z.number().int().positive().optional(),
        startsAt: z.string().optional(),
        trainerId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;

      const existingClass = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, id))
        .get();

      if (!existingClass) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      if (ctx.user.role === "trainer") {
        // SECURITY RULE: Restrict update capability to own classes to prevent
        // trainers from modifying another trainer's class.
        if (existingClass.trainerId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Trainers may only modify classes assigned to themselves.",
          });
        }
        // SECURITY RULE: Prevent trainers from reassigning the class trainer
        // to block unauthorized schedule modifications or bypassing limits.
        delete patch.trainerId;
      } else if (ctx.user.role === "admin") {
        if (patch.trainerId !== undefined && patch.trainerId !== null) {
          // SECURITY RULE: Ensure new trainer is registered and authorized.
          const targetTrainer = await ctx.db
            .select()
            .from(users)
            .where(eq(users.id, patch.trainerId))
            .get();

          if (!targetTrainer || targetTrainer.role !== "trainer") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The specified trainer does not exist or is not a trainer.",
            });
          }
        }
      }

      const updated = await ctx.db
        .update(classes)
        .set(patch)
        .where(eq(classes.id, id))
        .returning()
        .get();

      return updated;
    }),

  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const cls = await ctx.db
        .update(classes)
        .set({ cancelled: true })
        .where(eq(classes.id, input.id))
        .returning()
        .get();

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      await ctx.db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
        .where(
          and(eq(bookings.classId, input.id), eq(bookings.status, "booked")),
        );

      return cls;
    }),
});
