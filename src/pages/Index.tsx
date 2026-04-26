import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Github, Linkedin, Loader2, Mail, Twitter } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Meni } from "@/components/Meni";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const thoughts = [
  { text: "Ben recommended Atomic Habits for improving my morning routine.", people: ["Ben"], categories: ["Recommendation", "Book", "Habits"] },
  { text: "Jordan said the signup page feels confusing on mobile.", people: ["Jordan"], categories: ["Feedback", "Signup Page", "Mobile"] },
  { text: "We should test the checkout flow before launching the sale.", people: [], categories: ["Task", "Checkout", "Launch"] },
  { text: "Maya wants to move the team offsite to Lisbon in September.", people: ["Maya"], categories: ["Plan", "Travel", "Team"] },
];

function MenerioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("h-9 w-9", className)}>
      <defs>
        <linearGradient id="menerio-mark-a" x1="5" x2="35" y1="5" y2="35">
          <stop stopColor="hsl(var(--landing-plain-white))" />
          <stop offset=".38" stopColor="hsl(var(--landing-lavender))" />
          <stop offset="1" stopColor="hsl(var(--landing-sky-primary))" />
        </linearGradient>
        <linearGradient id="menerio-mark-b" x1="8" x2="32" y1="34" y2="4">
          <stop stopColor="hsl(var(--landing-violet-deep))" />
          <stop offset="1" stopColor="hsl(var(--landing-sky-light))" />
        </linearGradient>
      </defs>
      <path d="M5 7c0-1.7 1.3-3 3-3h5.1c1.1 0 2.1.6 2.6 1.6L20 14l4.3-8.4c.5-1 1.5-1.6 2.6-1.6H32c1.7 0 3 1.3 3 3v26c0 1.7-1.3 3-3 3h-5.3c-1.7 0-3-1.3-3-3V18.4l-3.7 7.2-3.7-7.2V33c0 1.7-1.3 3-3 3H8c-1.7 0-3-1.3-3-3V7Z" fill="url(#menerio-mark-a)" />
      <path d="M20 14 31.5 4H35v25.2c0 1.8-2.2 2.7-3.5 1.4L20 19.1 8.5 30.6C7.2 31.9 5 31 5 29.2V4h3.5L20 14Z" fill="url(#menerio-mark-b)" opacity=".62" />
    </svg>
  );
}

function ParticleField() {
  const seeds = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    x: (i * 137) % 100,
    y: (i * 61) % 100,
    s: 1 + ((i * 17) % 4),
    d: (i * 19) % 18,
    dur: 18 + ((i * 13) % 20),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {seeds.map((p, i) => (
        <span
          key={i}
          className="landing-particle absolute rounded-full bg-[hsl(var(--landing-sky-highlight))] shadow-[0_0_8px_hsl(var(--landing-sky-highlight)/.8)]"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.s}px`, height: `${p.s}px`, animationDelay: `-${p.d}s`, animationDuration: `${p.dur}s`, opacity: i % 5 === 0 ? 0.8 : 0.45 }}
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
        timers.push(window.setTimeout(tick, 32 + ((charIndex * 7) % 20)));
      } else {
        timers.push(window.setTimeout(() => setPhase("analysing"), 520));
        timers.push(window.setTimeout(() => setPhase("tagged"), 1220));
        timers.push(window.setTimeout(() => setIdx((value) => (value + 1) % thoughts.length), 4500));
      }
    };

    timers.push(window.setTimeout(tick, 360));
    return () => timers.forEach(window.clearTimeout);
  }, [idx]);

  const current = thoughts[idx];

  return (
    <div className="relative mx-auto w-full max-w-[580px]">
      <div className="pointer-events-none absolute -right-24 -top-12 z-10 hidden md:block">
        <Meni size={86} />
      </div>
      <div className="flex h-[340px] min-h-[340px] flex-col overflow-hidden rounded-[18px] border border-[hsl(var(--landing-sky-primary)/.25)] bg-[linear-gradient(180deg,hsl(var(--landing-panel)/.95),hsl(var(--landing-card-deep)/.95))] px-[22px] py-[18px] text-left shadow-[0_20px_60px_hsl(var(--landing-ink)/.5),0_0_40px_hsl(var(--landing-sky-primary)/.18)]">
        <div className="mb-4 flex items-center justify-between border-b border-[hsl(var(--landing-plain-white)/.06)] pb-3">
          <span className="rounded bg-[hsl(var(--landing-sky-primary)/.18)] px-2 py-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-[hsl(var(--landing-sky-highlight))]">NEW NOTE</span>
          <span className="font-mono text-[11px] text-[hsl(var(--landing-faint))]">just now</span>
        </div>

        <div className="h-[70px] min-h-[70px] overflow-hidden text-[18px] leading-[1.45] text-[hsl(var(--landing-text))]">
          <span>{typed}</span>
          {phase === "typing" && <span className="capture-caret text-[hsl(var(--landing-sky-highlight))]">▍</span>}
        </div>

        <div className={cn("my-4 flex h-[16px] items-center gap-2 font-mono text-[11px] text-[hsl(var(--landing-faint))] transition-opacity duration-300", phase === "typing" ? "invisible opacity-0" : "visible opacity-100")}>
          <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,hsl(var(--landing-sky-primary)/.3),transparent)]" />
          <span>menerio is reading…</span>
          <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,hsl(var(--landing-sky-primary)/.3),transparent)]" />
        </div>

        <div className={cn("flex min-h-[130px] flex-col gap-3 transition-opacity duration-300", phase === "tagged" ? "opacity-100" : "opacity-0")}>
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
      <div className="mt-7 flex justify-center gap-2" aria-hidden="true">
        {thoughts.map((_, i) => <span key={i} className={cn("h-1 w-[22px] rounded-full bg-[hsl(var(--landing-plain-white)/.1)] transition-all", i === idx && "bg-[hsl(var(--landing-sky-primary))] shadow-[0_0_8px_hsl(var(--landing-sky-primary)/.6)]")} />)}
      </div>
    </div>
  );
}

function PillGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-[10px]"><div className="min-w-[70px] font-mono text-[9.5px] uppercase tracking-[.15em] text-[hsl(var(--landing-faint))]">{label}</div><div className="flex flex-wrap gap-1.5">{children}</div></div>;
}

function PeoplePill({ name, delay }: { name: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--landing-pink)/.4)] bg-[linear-gradient(180deg,hsl(var(--landing-pink)/.18),hsl(var(--landing-pink)/.08))] py-[5px] pl-1 pr-[11px] text-[12.5px] font-medium text-[hsl(var(--landing-pink-text))] opacity-0" style={{ animationDelay: `${delay}s` }}><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[linear-gradient(135deg,hsl(var(--landing-pink)),hsl(var(--landing-pink-deep)))] text-[11px] font-bold text-[hsl(var(--landing-plain-white))]">{name[0]}</span>{name}</span>;
}

function CategoryPill({ label, delay }: { label: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--landing-sky-primary)/.4)] bg-[linear-gradient(180deg,hsl(var(--landing-sky-primary)/.18),hsl(var(--landing-sky-primary)/.08))] py-[5px] pl-[11px] pr-[11px] text-[12.5px] font-medium text-[hsl(var(--landing-sky-white))] opacity-0" style={{ animationDelay: `${delay}s` }}><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--landing-sky-primary))] shadow-[0_0_6px_hsl(var(--landing-sky-primary))]" />{label}</span>;
}

function LandingNav() {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-50 border-b border-[hsl(var(--landing-plain-white)/.06)] bg-[hsl(var(--landing-panel)/.78)] backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-[18px] md:px-9">
        <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-extrabold text-[hsl(var(--landing-text))]">
          <MenerioMark />
          <span>Menerio</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm font-medium text-[hsl(var(--landing-muted))] md:flex">
          {['Home', 'Features', 'Integrations', 'Docs', 'Pricing'].map((item) => (
            <a key={item} href={item === 'Home' ? '#' : `#${item.toLowerCase()}`} className={cn("rounded-full px-4 py-2 transition hover:bg-[hsl(var(--landing-plain-white)/.04)] hover:text-[hsl(var(--landing-text))]", item === 'Home' && "bg-[hsl(var(--landing-sky-primary)/.14)] font-semibold text-[hsl(var(--landing-sky-primary))]")}>{item}</a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/auth')} className="hidden text-sm text-[hsl(var(--landing-muted))] transition hover:text-[hsl(var(--landing-text))] sm:inline-flex">Sign In</button>
          <Button onClick={() => navigate('/auth?tab=signup')} className="rounded-xl border border-transparent bg-[linear-gradient(180deg,hsl(var(--landing-button-top)),hsl(var(--landing-button-bottom)))] px-5 py-[11px] text-sm font-semibold text-[hsl(var(--landing-plain-white))] shadow-[0_0_24px_hsl(var(--landing-sky-primary)/.4),inset_0_1px_0_hsl(var(--landing-plain-white)/.2)] hover:brightness-110">
            Get Started — Free
          </Button>
        </div>
      </div>
    </header>
  );
}

function LandingFooter() {
  const links = [{ icon: Twitter, label: "Twitter" }, { icon: Github, label: "GitHub" }, { icon: Linkedin, label: "LinkedIn" }, { icon: Mail, label: "Email" }];
  return (
    <footer id="docs" className="border-t border-[hsl(var(--landing-plain-white)/.06)] bg-[hsl(var(--landing-page))] px-6 py-12">
      <div className="mx-auto grid max-w-[1180px] gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link to="/" className="mb-3 flex items-center gap-3"><MenerioMark /><span className="font-display text-xl font-extrabold text-[hsl(var(--landing-text))]">Menerio</span></Link>
          <p className="max-w-sm text-sm leading-relaxed text-[hsl(var(--landing-muted))]">One brain. Every AI. Capture, search, and connect your thoughts.</p>
        </div>
        <FooterColumn title="Product" links={[{ label: "Docs", to: "/docs" }, { label: "Source Code", to: "https://github.com/MichaelZelbel/menerio", external: true }]} />
        <FooterColumn title="Legal" links={[{ label: "Privacy Policy", to: "/privacy" }, { label: "Terms of Service", to: "/terms" }, { label: "Cookie Policy", to: "/cookies" }]} />
      </div>
      <div className="mx-auto mt-9 flex max-w-[1180px] flex-col items-center justify-between gap-4 border-t border-[hsl(var(--landing-plain-white)/.05)] pt-5 text-xs text-[hsl(var(--landing-faint))] sm:flex-row">
        <p>© 2026 Menerio. All rights reserved.</p>
        <div className="flex gap-4">{links.map(({ icon: Icon, label }) => <a key={label} href="#" aria-label={label} className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--landing-plain-white)/.04)] text-[hsl(var(--landing-muted))] transition hover:bg-[hsl(var(--landing-sky-primary)/.12)] hover:text-[hsl(var(--landing-sky-highlight))]"><Icon className="h-3.5 w-3.5" /></a>)}</div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; to: string; external?: boolean }[] }) {
  return <div><h3 className="mb-3 font-display text-sm font-bold text-[hsl(var(--landing-text))]">{title}</h3><ul className="space-y-3">{links.map((link) => <li key={link.to}>{link.external ? <a href={link.to} target="_blank" rel="noopener noreferrer" className="text-sm text-[hsl(var(--landing-muted))] transition hover:text-[hsl(var(--landing-sky-highlight))]">{link.label}</a> : <Link to={link.to} className="text-sm text-[hsl(var(--landing-muted))] transition hover:text-[hsl(var(--landing-sky-highlight))]">{link.label}</Link>}</li>)}</ul></div>;
}

const Index = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen overflow-hidden bg-[hsl(var(--landing-page))] text-[hsl(var(--landing-text))]">
      <SEOHead title="Menerio — One Brain. Every AI." description="Capture every thought, organize it by meaning, and make it available to any AI through Menerio." jsonLd={{ "@context": "https://schema.org", "@type": "WebApplication", name: "Menerio", applicationCategory: "ProductivityApplication" }} />
      <LandingNav />
      <main className="relative min-h-[calc(100vh-81px)] overflow-hidden">
        <div className="absolute inset-0">
          <div className="landing-aurora-drift absolute -left-[200px] -top-[150px] h-[700px] w-[1100px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-deep)/.45),transparent_70%)] blur-3xl" />
          <div className="landing-aurora-drift absolute -right-[150px] top-[100px] h-[600px] w-[900px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-primary)/.25),transparent_70%)] blur-3xl [animation-duration:26s]" />
          <div className="landing-aurora-drift absolute left-[30%] top-[400px] h-[500px] w-[1200px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-deep)/.3),transparent_70%)] blur-3xl [animation-duration:30s]" />
          <div className="absolute inset-0 opacity-[.06] mix-blend-overlay [background-image:radial-gradient(hsl(var(--landing-plain-white))_1px,transparent_1px)] [background-size:3px_3px]" />
        </div>
        <ParticleField />

        <section className="relative z-10 mx-auto max-w-[1280px] px-6 pb-20 pt-[60px] text-center md:px-9">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--landing-sky-primary)/.25)] bg-[hsl(var(--landing-sky-primary)/.12)] px-3.5 py-[7px] text-[12.5px] font-semibold text-[hsl(var(--landing-sky-highlight))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--landing-success))] shadow-[0_0_8px_hsl(var(--landing-success)/.8)]" />
            A personal AI brain · MCP-native · Open source
          </div>

          <div className="mx-auto mb-[14px] grid max-w-[980px] items-center gap-9 text-left md:grid-cols-[auto_1fr]">
            <div className="relative mx-auto flex flex-col items-center gap-1.5 md:mx-0">
              <div className="absolute -inset-5 rounded-full bg-[radial-gradient(circle,hsl(var(--landing-sky-primary)/.35),transparent_65%)] blur-xl" />
              <Meni size={168} className="relative z-10 drop-shadow-[0_12px_30px_hsl(var(--landing-sky-primary)/.45)]" />
              <span className="relative z-10 rounded-full border border-[hsl(var(--landing-sky-primary)/.3)] bg-[hsl(var(--landing-sky-deep)/.25)] px-2.5 py-[3px] font-mono text-[11px] lowercase tracking-[.15em] text-[hsl(var(--landing-sky-primary))]">meni</span>
            </div>
            <div className="text-center md:text-left">
              <h1 className="font-display text-[clamp(54px,7.4vw,112px)] font-extrabold leading-[.96] text-[hsl(var(--landing-text))] [text-shadow:0_4px_30px_hsl(var(--landing-ink)/.5)]">
                One Brain.<br />
                <span className="bg-[linear-gradient(180deg,hsl(var(--landing-sky-light)),hsl(var(--landing-sky-primary))_50%,hsl(var(--landing-sky-deep)))] bg-clip-text text-transparent drop-shadow-[0_0_50px_hsl(var(--landing-sky-primary)/.5)]">Every AI.</span>
              </h1>
              <p className="mx-auto mt-[18px] max-w-[600px] text-lg leading-relaxed text-[hsl(var(--landing-body))] md:mx-0">Capture every thought — Menerio organizes it by meaning and makes it available to any AI you talk to.</p>
            </div>
          </div>

          <div className="mx-auto mb-6 flex min-h-[360px] max-w-[720px] items-start justify-center">
            <CaptureShowcase />
          </div>

          <div className="mb-[22px] flex justify-center">
            <Button onClick={() => navigate('/auth?tab=signup')} className="group rounded-[14px] border border-transparent bg-[linear-gradient(180deg,hsl(var(--landing-button-top)),hsl(var(--landing-button-bottom)))] px-7 py-[15px] text-[15px] font-semibold text-[hsl(var(--landing-plain-white))] shadow-[0_0_24px_hsl(var(--landing-sky-primary)/.4),inset_0_1px_0_hsl(var(--landing-plain-white)/.2)] hover:brightness-110">
              Get Started — Free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-[hsl(var(--landing-body))]">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Capture from web, mobile, voice</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Available in Claude, ChatGPT, Gemini</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Open source · AGPL-3.0</span>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
};

export default Index;
