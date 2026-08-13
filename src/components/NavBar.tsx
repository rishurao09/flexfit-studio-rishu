"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function NavBar() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
  });

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      router.push("/login");
    },
  });

  return (
    <header className="border-b sticky top-0 z-40 backdrop-blur-md bg-opacity-80" style={{ borderColor: "var(--border)", backgroundColor: "rgba(6, 6, 7, 0.85)" }}>
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-5">
        <Link href="/" className="font-black tracking-tighter text-xl uppercase">
          FlexFit<span style={{ color: "var(--accent)" }}>.</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link href="/schedule" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
            Schedule
          </Link>

          {user && (
            <>
              <Link href="/dashboard" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
                My bookings
              </Link>
              <Link href="/waitlist" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
                Waitlist
              </Link>
            </>
          )}

          {user?.role === "trainer" && (
            <Link href="/trainer/schedule" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
              My schedule
            </Link>
          )}

          {user?.role === "admin" && (
            <>
              <Link href="/admin" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
                Admin
              </Link>
              <Link href="/admin/attendance" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
                Attendance
              </Link>
            </>
          )}

          {(user?.role === "admin" || user?.role === "trainer") && (
            <Link href="/kiosk" className="text-xs font-bold tracking-widest uppercase muted hover:text-white transition-colors">
              Kiosk
            </Link>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {user && (
            <Link href="/notifications" className="relative p-1 hover:opacity-85 transition-opacity">
              <span className="text-lg">🔔</span>
              {unreadCount && unreadCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-black text-black"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          )}
          {user ? (
            <>
              <span className="text-xs font-bold tracking-wider uppercase muted hidden sm:inline">{user.name}</span>
              <button
                className="btn btn-sm text-xs py-1.5 px-3.5 border-neutral-800"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn py-1.5 px-4 text-xs btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
