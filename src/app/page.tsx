import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-16 py-12 animate-slide-in">
      <section className="space-y-6">
        <div className="inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-neutral-900 border border-neutral-800 text-neutral-400">
          Welcome to the future of fitness
        </div>
        <h1 className="text-5xl sm:text-7xl font-black tracking-tighter uppercase leading-none">
          FlexFit<br className="sm:hidden" /> Studio<span style={{ color: "var(--accent)" }}>.</span>
        </h1>
        <p className="muted text-base max-w-xl leading-relaxed">
          Book classes, manage your membership, and track your attendance.
          Twelve premium classes a week across yoga, strength, spin and boxing.
        </p>
        <div className="flex flex-wrap gap-4 pt-4">
          <Link href="/schedule" className="btn btn-primary px-8 py-3.5 text-xs font-black">
            View schedule
          </Link>
          <Link href="/plans" className="btn px-8 py-3.5 text-xs font-black border-neutral-800">
            Membership plans
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          ["Studio A", "Yoga, vinyasa and mobility"],
          ["Studio B", "HIIT, boxing and circuits"],
          ["Spin Room", "20 bikes, two spin formats"],
        ].map(([room, blurb]) => (
          <div key={room} className="panel p-6 border-neutral-900 hover:border-neutral-800 transition-colors">
            <h2 className="font-bold uppercase tracking-wider text-sm text-neutral-100">{room}</h2>
            <p className="muted mt-2 text-xs leading-relaxed">{blurb}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
