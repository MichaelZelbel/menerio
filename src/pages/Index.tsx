import { useEffect, useMemo, useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Brain, CheckCircle2, FileText, Github, Globe, Linkedin, Loader2, Mail, Plug, Search, Shield, Twitter } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Meni } from "@/components/Meni";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const features = [
  { icon: Brain, title: "AI-Powered Memory", description: "Every note is automatically embedded and classified. Your AI understands your thoughts by meaning, not just keywords." },
  { icon: Search, title: "Semantic Search", description: "Find anything by what it means, not just what it says. Ask questions and get relevant results from your entire knowledge base." },
  { icon: FileText, title: "Rich Note-Taking", description: "Capture thoughts, ideas, meeting notes, and references. Tag, pin, and organize everything your way." },
  { icon: Plug, title: "MCP-Ready", description: "Connect any AI tool — Claude, ChatGPT, Cursor — to your brain via the Model Context Protocol. One brain, every AI." },
  { icon: Globe, title: "Open & Portable", description: "Your knowledge lives in your database. No vendor lock-in, no SaaS middlemen. Export anytime." },
  { icon: Shield, title: "Private & Secure", description: "Row-level security ensures only you can access your thoughts. Your brain belongs to you." },
];

const thoughts = [
  { text: "Ben recommended Atomic Habits for improving my morning routine.", people: ["Ben"], categories: ["Recommendation", "Book", "Habits"] },
  { text: "Jordan said the signup page feels confusing on mobile.", people: ["Jordan"], categories: ["Feedback", "Signup Page", "Mobile"] },
  { text: "We should test the checkout flow before launching the sale.", people: [], categories: ["Task", "Checkout", "Launch"] },
  { text: "Maya wants to move the team offsite to Lisbon in September.", people: ["Maya"], categories: ["Plan", "Travel", "Team"] },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } }),
};

function ParticleField() {
  const seeds = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    x: (i * 97) % 100,
    y: (i * 53) % 100,
    s: 0.5 + ((i * 31) % 30) / 30,
    d: (i * 17) % 18,
    dur: 14 + ((i * 11) % 16),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {seeds.map((p, i) => (
        <span
          key={i}
          className="landing-particle absolute rounded-full bg-[hsl(var(--landing-sky-highlight))] shadow-[0_0_12px_hsl(var(--landing-sky-highlight)/.55)]"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.s * 3}px`, height: `${p.s * 3}px`, animationDelay: `-${p.d}s`, animationDuration: `${p.dur}s`, opacity: 0.3 + (p.s - 0.5) * 0.6 }}
        />
      ))}
    </div>
  );
}

function CaptureShowcase() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "analysing" | "tagged">("typing");

  useEffect(() => {
    const timers: number[] = [];
    const current = thoughts[idx];
    let charIndex = 0;
    setTyped("");
    setPhase("typing");

    const tick = () => {
      if (charIndex <= current.text.length) {
        setTyped(current.text.slice(0, charIndex));
        charIndex += 1;
        timers.push(window.setTimeout(tick, 28 + ((charIndex * 7) % 22)));
      } else {
        timers.push(window.setTimeout(() => setPhase("analysing"), 500));
        timers.push(window.setTimeout(() => setPhase("tagged"), 1200));
        timers.push(window.setTimeout(() => setIdx((value) => (value + 1) % thoughts.length), 4400));
      }
    };

    timers.push(window.setTimeout(tick, 400));
    return () => timers.forEach(window.clearTimeout);
  }, [idx]);

  const current = thoughts[idx];

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <div className="relative h-[340px] overflow-hidden rounded-[18px] border border-[hsl(var(--landing-sky-mid)/.24)] bg-[linear-gradient(180deg,hsl(var(--landing-panel)/.92),hsl(var(--landing-page)/.88))] shadow-[0_20px_60px_hsl(var(--landing-ink)/.5),0_0_40px_hsl(var(--landing-sky-primary)/.18)] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-[hsl(var(--landing-sky-mid)/.14)] p-3">
          <span className="rounded-full border border-[hsl(var(--landing-sky-mid)/.3)] bg-[hsl(var(--landing-sky-mid)/.12)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--landing-sky-light))]">NEW NOTE</span>
          <span className="font-mono text-[11px] text-[hsl(var(--landing-faint))]">just now</span>
        </div>

        <div className="flex h-[70px] items-center px-5 text-left text-lg leading-relaxed text-[hsl(var(--landing-text))] sm:px-7">
          <span>{typed}</span>
          {phase === "typing" && <span className="capture-caret text-[hsl(var(--landing-sky-highlight))]">▍</span>}
        </div>

        <div className={cn("relative mx-5 h-10 transition-opacity duration-300 sm:mx-7", phase === "typing" ? "opacity-0" : "opacity-100")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-[hsl(var(--landing-sky-mid)/.16)]" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[hsl(var(--landing-page))] px-3 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--landing-faint))]">menerio is reading…</span>
        </div>

        <div className={cn("min-h-[130px] space-y-4 px-5 pt-2 text-left transition-opacity duration-300 sm:px-7", phase === "tagged" ? "opacity-100" : "opacity-0")}>
          {current.people.length > 0 && (
            <PillGroup label="people">
              {current.people.map((person, i) => <PeoplePill key={person} name={person} delay={i * 0.15} />)}
            </PillGroup>
          )}
          <PillGroup label="categories">
            {current.categories.map((category, i) => <CategoryPill key={category} label={category} delay={(current.people.length + i) * 0.15} />)}
          </PillGroup>
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
        {thoughts.map((_, i) => <span key={i} className={cn("h-2 w-7 rounded-full bg-[hsl(var(--landing-sky-mid)/.18)] transition-all", i === idx && "bg-[hsl(var(--landing-sky-highlight))] shadow-[0_0_16px_hsl(var(--landing-sky-highlight)/.65)]")} />)}
      </div>
    </div>
  );
}

function PillGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--landing-faint))]">{label}</div><div className="flex flex-wrap gap-2">{children}</div></div>;
}

function PeoplePill({ name, delay }: { name: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-2 rounded-full border border-[hsl(var(--landing-pink)/.4)] bg-[linear-gradient(180deg,hsl(var(--landing-pink)/.18),hsl(var(--landing-pink)/.08))] py-1 pl-1 pr-3 text-sm font-medium text-[hsl(var(--landing-pink-text))] opacity-0" style={{ animationDelay: `${delay}s` }}><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[linear-gradient(135deg,hsl(var(--landing-pink)),hsl(var(--landing-pink-deep)))] text-xs font-bold text-[hsl(var(--landing-plain-white))]">{name[0]}</span>{name}</span>;
}

function CategoryPill({ label, delay }: { label: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-2 rounded-full border border-[hsl(var(--landing-sky-mid)/.4)] bg-[linear-gradient(180deg,hsl(var(--landing-sky-mid)/.18),hsl(var(--landing-sky-mid)/.08))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--landing-sky-white))] opacity-0" style={{ animationDelay: `${delay}s` }}><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--landing-sky-mid))] shadow-[0_0_10px_hsl(var(--landing-sky-mid))]" />{label}</span>;
}

function LandingFooter() {
  const links = [{ icon: Twitter, label: "Twitter" }, { icon: Github, label: "GitHub" }, { icon: Linkedin, label: "LinkedIn" }, { icon: Mail, label: "Email" }];
  return (
    <footer className="border-t border-[hsl(var(--landing-sky-mid)/.14)] bg-[hsl(var(--landing-page))]">
      <div className="container grid gap-10 py-14 md:grid-cols-3">
        <div>
          <Link to="/" className="mb-4 flex items-center gap-3"><Meni size={48} /><span className="font-display text-xl font-bold text-[hsl(var(--landing-text))]">Menerio</span></Link>
          <p className="max-w-xs text-sm leading-relaxed text-[hsl(var(--landing-muted))]">One brain. Every AI. Capture, search, and connect your thoughts.</p>
        </div>
        <FooterColumn title="Product" links={[{ label: "Docs", to: "/docs" }, { label: "Source Code", to: "https://github.com/MichaelZelbel/menerio", external: true }]} />
        <FooterColumn title="Legal" links={[{ label: "Privacy Policy", to: "/privacy" }, { label: "Terms of Service", to: "/terms" }, { label: "Cookie Policy", to: "/cookies" }]} />
      </div>
      <div className="border-t border-[hsl(var(--landing-sky-mid)/.14)]"><div className="container flex flex-col items-center justify-between gap-4 py-6 sm:flex-row"><p className="text-xs text-[hsl(var(--landing-muted))]">© 2026 Menerio. All rights reserved.</p><div className="flex gap-3">{links.map(({ icon: Icon, label }) => <a key={label} href="#" aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-md text-[hsl(var(--landing-muted))] transition hover:bg-[hsl(var(--landing-sky-mid)/.12)] hover:text-[hsl(var(--landing-sky-highlight))]"><Icon className="h-4 w-4" /></a>)}</div></div></div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; to: string; external?: boolean }[] }) {
  return <div><h3 className="mb-4 text-sm font-semibold text-[hsl(var(--landing-text))]">{title}</h3><ul className="space-y-3">{links.map((link) => <li key={link.to}>{link.external ? <a href={link.to} target="_blank" rel="noopener noreferrer" className="text-sm text-[hsl(var(--landing-muted))] transition hover:text-[hsl(var(--landing-sky-highlight))]">{link.label}</a> : <Link to={link.to} className="text-sm text-[hsl(var(--landing-muted))] transition hover:text-[hsl(var(--landing-sky-highlight))]">{link.label}</Link>}</li>)}</ul></div>;
}

const Index = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="bg-[hsl(var(--landing-page))] text-[hsl(var(--landing-text))]">
      <SEOHead title="Menerio — One Brain. Every AI." description="Capture every thought, organize it by meaning, and make it available to any AI through Menerio." jsonLd={{ "@context": "https://schema.org", "@type": "WebApplication", name: "Menerio", applicationCategory: "ProductivityApplication" }} />
      <section className="relative overflow-hidden px-4 py-[60px] sm:px-9">
        <div className="absolute inset-0"><div className="landing-aurora-drift absolute -left-40 -top-52 h-[720px] w-[720px] rounded-full bg-[radial-gradient(circle,hsl(var(--landing-sky-primary)/.24),transparent_62%)] blur-3xl" /><div className="landing-aurora-drift absolute -right-52 top-20 h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,hsl(var(--landing-sky-highlight)/.16),transparent_64%)] blur-3xl [animation-duration:30s]" /><div className="landing-aurora-drift absolute bottom-0 left-1/3 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,hsl(var(--landing-sky-deep)/.18),transparent_62%)] blur-3xl [animation-duration:26s]" /><div className="absolute inset-0 opacity-[.06] mix-blend-overlay [background-image:radial-gradient(hsl(var(--landing-plain-white))_1px,transparent_1px)] [background-size:18px_18px]" /></div>
        <ParticleField />
        <div className="relative mx-auto flex max-w-[1280px] flex-col items-center">
          <Badge variant="info" className="mb-8 rounded-full border border-[hsl(var(--landing-sky-mid)/.24)] bg-[hsl(var(--landing-sky-mid)/.1)] px-4 py-1.5 text-sm text-[hsl(var(--landing-sky-light))]">A personal AI brain · MCP-native · Open source</Badge>
          <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:gap-14">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-col items-center"><div className="absolute inset-8 rounded-full bg-[hsl(var(--landing-sky-highlight)/.24)] blur-3xl" /><Meni size={220} className="relative" /><span className="-mt-3 rounded-full border border-[hsl(var(--landing-sky-mid)/.24)] bg-[hsl(var(--landing-page)/.72)] px-3 py-1 font-mono text-[10px] lowercase tracking-[.14em] text-[hsl(var(--landing-muted))]">meni</span></motion.div>
            <motion.div initial="hidden" animate="visible" className="text-center lg:text-left"><motion.h1 variants={fadeUp} custom={0} className="font-display text-[clamp(54px,6vw,88px)] font-extrabold leading-[.92] tracking-tight text-[hsl(var(--landing-text))]">One Brain.<br /><span className="bg-[linear-gradient(90deg,hsl(var(--landing-sky-light)),hsl(var(--landing-sky-primary)))] bg-clip-text text-transparent">Every AI.</span></motion.h1><motion.p variants={fadeUp} custom={1} className="mt-6 max-w-[600px] text-lg leading-relaxed text-[hsl(var(--landing-body))]">Capture every thought — Menerio organizes it by meaning and makes it available to any AI you talk to.</motion.p></motion.div>
          </div>
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25, duration: .6 }} className="mt-10 w-full"><CaptureShowcase /></motion.div>
          <div className="mt-8 flex flex-col items-center gap-5"><Button size="xl" onClick={() => navigate("/auth?tab=signup")} className="group gap-2 rounded-xl px-7 text-base shadow-lg shadow-primary/25">Get Started — Free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Button><div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-[hsl(var(--landing-body))]"><span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" />Capture from web, mobile, voice</span><span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" />Available in Claude, ChatGPT, Gemini</span><span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" />Open source · AGPL-3.0</span></div></div>
        </div>
      </section>
      <section className="border-t border-[hsl(var(--landing-sky-mid)/.14)] bg-[hsl(var(--landing-page))]"><div className="container py-24"><div className="mb-14 text-center"><Badge variant="secondary" className="mb-4">Features</Badge><h2 className="font-display text-[clamp(34px,4.2vw,52px)] font-extrabold text-[hsl(var(--landing-text))]">Your thoughts, supercharged by AI</h2><p className="mx-auto mt-4 max-w-2xl text-base text-[hsl(var(--landing-muted))]">Not just another notes app. A database-backed knowledge system built for the age of AI agents.</p></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{features.map((feature, i) => <motion.div key={feature.title} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} custom={i}><Card className="group h-full rounded-2xl border-[hsl(var(--landing-sky-mid)/.18)] bg-[linear-gradient(180deg,hsl(var(--landing-panel)/.6),hsl(var(--landing-page)/.6))] p-6 shadow-none transition duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--landing-sky-mid)/.32)]"><div className="mb-4 flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-[hsl(var(--landing-sky-primary)/.14)] text-[hsl(var(--landing-sky-mid))]"><feature.icon className="h-5 w-5" /></div><h3 className="font-display text-[17px] font-bold text-[hsl(var(--landing-text))]">{feature.title}</h3><p className="mt-2 text-[13.5px] leading-relaxed text-[hsl(var(--landing-muted))]">{feature.description}</p></Card></motion.div>)}</div></div></section>
      <section className="px-4 pb-20 pt-10 text-center"><div className="mx-auto max-w-[800px]"><h2 className="font-display text-[clamp(36px,5vw,52px)] font-extrabold text-[hsl(var(--landing-text))]">Ready to build your brain?</h2><p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[hsl(var(--landing-muted))]">Stop losing context every time you switch tools. Start building persistent, AI-accessible knowledge today.</p><Button size="xl" onClick={() => navigate("/auth?tab=signup")} className="group mt-8 gap-2 rounded-xl px-8 text-base">Start Your Brain <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Button></div></section>
      <LandingFooter />
    </div>
  );
};

export default Index;