import { Github, Mail, Gamepad2, type LucideIcon } from "lucide-react";

// ── EDIT ME ────────────────────────────────────────────────────────────────
// Placeholder profile content — swap in your real details any time. Nothing
// here is required for the games to work; it only drives the About section.
export const PROFILE = {
  name: "Trevor Beck",
  title: "Facilities Electrical Engineer",
  education: "Electrical Engineering",
  bio: "I build small tools and games on the side. Beckify is my little hub — a spot to launch the arcade projects I'm tinkering with and keep my facilities-electrical calculators handy. Booty Butt Scooter is the first game up; more are on the way.",
};

export interface ContactLink {
  href: string;
  label: string;
  icon: LucideIcon;
  external: boolean;
}

export const CONTACT_LINKS: ContactLink[] = [
  { href: "https://github.com/becktj90", label: "GitHub", icon: Github, external: true },
  { href: "mailto:trevorjohnbeck@gmail.com", label: "Email", icon: Mail, external: true },
  { href: "/scooter/", label: "Play", icon: Gamepad2, external: false },
];
