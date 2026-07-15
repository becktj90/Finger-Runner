import { ArrowUpRight, ArrowLeft, Gamepad2, Sparkles } from "lucide-react";
import { FadeIn } from "@/components/FadeIn";

const BECKIFY_HOME = "https://beckify.com";

interface GameEntry {
  title: string;
  blurb: string;
  emoji: string;
  href?: string; // present = playable
  accent: string;
}

// Booty Butt Scooter is live (built from the finger-runner engine and served
// at /scooter/). The rest are on the way — shown as "Coming Soon" until ready.
const GAMES: GameEntry[] = [
  {
    title: "Booty Butt Scooter",
    blurb: "Endless lane-dodging runner. Switch lanes, slice obstacles with your saber, and hit the fart-turbo boost.",
    emoji: "🛴",
    href: "/scooter/",
    accent: "#8b7bff",
  },
  { title: "New Glenn Runner", blurb: "Odyssey-inspired rocket arcade dash.", emoji: "🚀", accent: "#4f8bff" },
  { title: "Bin Block Blaster", blurb: "Blast the bin blocks before they stack up.", emoji: "🧱", accent: "#ff7b9c" },
  { title: "Trying To Be Normal", blurb: "A social-awkwardness comedy game.", emoji: "🫥", accent: "#6ee7b7" },
  { title: "Starforge Frontier", blurb: "Idle space-frontier strategy.", emoji: "🌌", accent: "#f5c451" },
];

const GameCard = ({ g, delay }: { g: GameEntry; delay: number }) => {
  const ready = Boolean(g.href);
  const inner = (
    <div
      className="group relative h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 backdrop-blur-sm transition-all duration-300 hover:border-[color:var(--accent)]/50"
      style={ready ? { boxShadow: `0 0 0 1px ${g.accent}22` } : undefined}
    >
      <div
        className="absolute inset-x-0 -top-px h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${g.accent}, transparent)` }}
      />
      <div className="flex items-start justify-between">
        <span className="text-4xl leading-none">{g.emoji}</span>
        {ready ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ color: g.accent, background: `${g.accent}1f` }}
          >
            <Sparkles className="h-3.5 w-3.5" /> Playable
          </span>
        ) : (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
            Coming soon
          </span>
        )}
      </div>
      <h3 className="mt-4 font-display text-xl font-bold text-[var(--foreground)]">{g.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{g.blurb}</p>
      {ready && (
        <span
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ color: g.accent }}
        >
          Play now <ArrowUpRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );

  return (
    <FadeIn delay={delay} className="h-full">
      {ready ? (
        <a href={g.href} className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]">
          {inner}
        </a>
      ) : (
        <div className="h-full cursor-default opacity-80">{inner}</div>
      )}
    </FadeIn>
  );
};

export const App = () => {
  return (
    <div className="min-h-dvh">
      {/* ── Top bar: wordmark + link back to the main site ── */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <a href={BECKIFY_HOME} className="flex items-center gap-2.5 group">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-[#0d0b16]">
            <Gamepad2 className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-[var(--foreground)]">
            Beckify <span className="text-[var(--muted)] font-medium">Arcade</span>
          </span>
        </a>
        <a
          href={BECKIFY_HOME}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--muted)] transition-colors duration-200 hover:border-[color:var(--accent)]/40 hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" /> beckify.com
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20 pt-6 sm:px-8 sm:pt-10">
        {/* ── Hero ── */}
        <FadeIn>
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
            <Gamepad2 className="h-4 w-4" /> Arcade
          </div>
          <h1 className="mt-5 font-display text-5xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-6xl">
            Play. Tinker.
            <span className="block text-[var(--accent)]">Repeat.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
            The games corner of Beckify. Start with Booty Butt Scooter — more are dropping soon.
          </p>
          <div className="mt-8">
            <a
              href="/scooter/"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-[#0d0b16] transition-transform duration-200 hover:-translate-y-0.5"
            >
              <Gamepad2 className="h-5 w-5" /> Play Booty Butt Scooter
            </a>
          </div>
        </FadeIn>

        {/* ── Games grid ── */}
        <section id="games" className="mt-16">
          <FadeIn>
            <h2 className="font-display text-2xl font-bold text-[var(--foreground)]">All games</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Tap a playable card to launch it.</p>
          </FadeIn>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {GAMES.map((g, i) => (
              <GameCard key={g.title} g={g} delay={0.04 * i} />
            ))}
          </div>
        </section>

        <footer className="mt-20 flex flex-col items-start justify-between gap-4 border-t border-[var(--border)] pt-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Beckify. Built for fun.</p>
          <a href={BECKIFY_HOME} className="inline-flex items-center gap-1.5 font-medium transition-colors duration-200 hover:text-[var(--foreground)]">
            <ArrowLeft className="h-4 w-4" /> Back to beckify.com
          </a>
        </footer>
      </main>
    </div>
  );
};
