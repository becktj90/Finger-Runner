import { Activity, GraduationCap } from "lucide-react";
import { FadeIn } from "@/components/FadeIn";
import { PROFILE, CONTACT_LINKS } from "@/data/site-content";
import profilePhoto from "@/assets/beck-profile.jpg";

export const About = () => {
  const socialLinks = CONTACT_LINKS.filter((l) => l.external);

  return (
    <header id="about" className="space-y-10 relative scroll-mt-24">
      <FadeIn delay={0.05}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8">
          <div className="relative shrink-0">
            <div
              className="absolute inset-0 rounded-2xl blur-lg opacity-30 pointer-events-none"
              style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)", transform: "scale(1.15)" }}
            />
            <img
              src={profilePhoto}
              alt={PROFILE.name}
              className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-2xl object-cover border border-[var(--border)] shadow-xl"
              style={{ filter: "grayscale(100%) contrast(1.05)" }}
            />
          </div>
          <div className="space-y-3">
            <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight text-[var(--foreground)]">
              {PROFILE.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)]/15 px-3 py-1.5 rounded-full w-fit">
                <Activity className="w-4 h-4" />
                <span>{PROFILE.title}</span>
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 rounded-full w-fit">
                <GraduationCap className="w-4 h-4" />
                <span>{PROFILE.education}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {socialLinks.map(({ href, label, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--accent)] border border-[var(--border)] hover:border-[var(--accent)]/40 bg-[var(--surface)] px-3 py-1.5 rounded-full transition-colors duration-200"
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.15}>
        <p className="text-base md:text-lg leading-relaxed text-[var(--muted)] max-w-2xl">
          {PROFILE.bio}
        </p>
      </FadeIn>
    </header>
  );
};
