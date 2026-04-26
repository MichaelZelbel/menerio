import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Brain, CheckCircle2, Database, FileText, Loader2, Lock, Network, Search } from "lucide-react";
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

const homepageFeatures = [
  {
    icon: Brain,
    title: "AI-Powered Memory",
    description: "Every note is automatically embedded and classified. Your AI understands your thoughts by meaning, not just keywords.",
  },
  {
    icon: Search,
    title: "Semantic Search",
    description: "Find anything by what it means, not just what it says. Ask questions and get relevant results from your entire knowledge base.",
  },
  {
    icon: FileText,
    title: "Rich Note-Taking",
    description: "Capture thoughts, ideas, meeting notes, and references. Tag, pin, and organize everything your way.",
  },
  {
    icon: Network,
    title: "MCP-Ready",
    description: "Connect any AI tool — Claude, ChatGPT, Cursor — to your brain via the Model Context Protocol. One brain, every AI.",
  },
  {
    icon: Database,
    title: "Open & Portable",
    description: "Your knowledge lives in your database. No vendor lock-in, no SaaS middlemen. Export anytime.",
  },
  {
    icon: Lock,
    title: "Private & Secure",
    description: "Row-level security ensures only you can access your thoughts. Your brain belongs to you.",
  },
];

function ParticleField() {
  const seeds = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    x: (i * 137) % 100,
    y: (i * 61) % 100,
    s: 1 + ((i * 17) % 4),
    d: (i * 19) % 18,
    dur: 18 + ((i * 13) % 20),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 hidden overflow-hidden dark:block" aria-hidden="true">
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
      <div className="pointer-events-none absolute -right-16 -top-16 z-20 hidden md:block">
        <Meni size={122} />
      </div>
      <div className="flex h-[340px] min-h-[340px] flex-col overflow-hidden rounded-[18px] border border-[hsl(var(--border-strong)/.14)] bg-[hsl(var(--surface))] px-[22px] py-[18px] text-left shadow-[0_14px_40px_rgba(15,35,70,.08)] dark:border-[hsl(var(--landing-sky-primary)/.25)] dark:bg-[linear-gradient(180deg,hsl(var(--landing-panel)/.95),hsl(var(--landing-card-deep)/.95))] dark:shadow-[0_20px_60px_hsl(var(--landing-ink)/.5),0_0_40px_hsl(var(--landing-sky-primary)/.18)]">
        <div className="mb-4 flex items-center justify-between border-b border-[hsl(var(--border)/.08)] pb-3 dark:border-[hsl(var(--landing-plain-white)/.06)]">
          <span className="rounded bg-[hsl(var(--brand)/.10)] px-2 py-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-[hsl(var(--brand))] dark:bg-[hsl(var(--landing-sky-primary)/.18)] dark:text-[hsl(var(--landing-sky-highlight))]">NEW NOTE</span>
          <span className="font-mono text-[11px] text-[hsl(var(--landing-faint))]">just now</span>
        </div>

        <div className="h-[70px] min-h-[70px] overflow-hidden text-[18px] leading-[1.45] text-[hsl(var(--landing-text))]">
          <span>{typed}</span>
          {phase === "typing" && <span className="capture-caret text-[hsl(var(--landing-sky-highlight))]">▍</span>}
        </div>

        <div className={cn("my-4 flex h-[16px] items-center gap-2 font-mono text-[11px] text-[hsl(var(--landing-faint))] transition-opacity duration-300", phase === "typing" ? "invisible opacity-0" : "visible opacity-100")}>
          <span className="h-px flex-1 bg-[hsl(var(--border)/.08)] dark:bg-[linear-gradient(90deg,transparent,hsl(var(--landing-sky-primary)/.3),transparent)]" />
          <span>menerio is reading…</span>
          <span className="h-px flex-1 bg-[hsl(var(--border)/.08)] dark:bg-[linear-gradient(90deg,transparent,hsl(var(--landing-sky-primary)/.3),transparent)]" />
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
        {thoughts.map((_, i) => <span key={i} className={cn("h-1 w-[22px] rounded-full bg-[hsl(var(--text-faint)/.35)] transition-all dark:bg-[hsl(var(--landing-plain-white)/.1)]", i === idx && "bg-[hsl(var(--brand))] dark:bg-[hsl(var(--landing-sky-primary))] dark:shadow-[0_0_8px_hsl(var(--landing-sky-primary)/.6)]")} />)}
      </div>
    </div>
  );
}

function PillGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-[10px]"><div className="min-w-[70px] font-mono text-[9.5px] uppercase tracking-[.15em] text-[hsl(var(--landing-faint))]">{label}</div><div className="flex flex-wrap gap-1.5">{children}</div></div>;
}

function PeoplePill({ name, delay }: { name: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--accent-pink)/.25)] bg-[hsl(var(--accent-pink-soft))] py-[5px] pl-1 pr-[11px] text-[12.5px] font-medium text-[hsl(var(--accent-pink-text))] opacity-0 dark:border-[hsl(var(--landing-pink)/.4)] dark:bg-[linear-gradient(180deg,hsl(var(--landing-pink)/.18),hsl(var(--landing-pink)/.08))] dark:text-[hsl(var(--landing-pink-text))]" style={{ animationDelay: `${delay}s` }}><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--accent-pink-gradient)] text-[11px] font-bold text-[hsl(var(--landing-plain-white))] dark:bg-[linear-gradient(135deg,hsl(var(--landing-pink)),hsl(var(--landing-pink-deep)))]">{name[0]}</span>{name}</span>;
}

function CategoryPill({ label, delay }: { label: string; delay: number }) {
  return <span className="capture-pill-enter inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--brand)/.22)] bg-[hsl(var(--brand-soft))] py-[5px] pl-[11px] pr-[11px] text-[12.5px] font-medium text-[hsl(var(--brand))] opacity-0 dark:border-[hsl(var(--landing-sky-primary)/.4)] dark:bg-[linear-gradient(180deg,hsl(var(--landing-sky-primary)/.18),hsl(var(--landing-sky-primary)/.08))] dark:text-[hsl(var(--landing-sky-white))]" style={{ animationDelay: `${delay}s` }}><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand))] shadow-[0_0_6px_hsl(var(--brand)/.35)] dark:bg-[hsl(var(--landing-sky-primary))] dark:shadow-[0_0_6px_hsl(var(--landing-sky-primary))]" />{label}</span>;
}

const Index = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--landing-text))] dark:bg-[hsl(var(--landing-page))]">
      <SEOHead title="Menerio — One Brain. Every AI." description="Capture every thought, organize it by meaning, and make it available to any AI through Menerio." jsonLd={{ "@context": "https://schema.org", "@type": "WebApplication", name: "Menerio", applicationCategory: "ProductivityApplication" }} />
      <main className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute -left-[160px] -top-[120px] h-[520px] w-[820px] bg-[radial-gradient(ellipse,hsl(var(--brand)/.07),transparent_70%)] blur-3xl dark:landing-aurora-drift dark:-left-[200px] dark:-top-[150px] dark:h-[700px] dark:w-[1100px] dark:bg-[radial-gradient(ellipse,hsl(var(--landing-sky-deep)/.45),transparent_70%)]" />
          <div className="landing-aurora-drift absolute -right-[150px] top-[100px] hidden h-[600px] w-[900px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-primary)/.25),transparent_70%)] blur-3xl [animation-duration:26s] dark:block" />
          <div className="landing-aurora-drift absolute left-[30%] top-[400px] hidden h-[500px] w-[1200px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-deep)/.3),transparent_70%)] blur-3xl [animation-duration:30s] dark:block" />
          <div className="landing-aurora-drift absolute bottom-[280px] right-[-280px] hidden h-[620px] w-[920px] bg-[radial-gradient(ellipse,hsl(var(--landing-sky-primary)/.16),transparent_70%)] blur-3xl [animation-duration:32s] dark:block" />
          <div className="absolute inset-0 hidden opacity-[.06] mix-blend-overlay [background-image:radial-gradient(hsl(var(--landing-plain-white))_1px,transparent_1px)] [background-size:3px_3px] dark:block" />
        </div>
        <ParticleField />

        <section className="relative z-10 mx-auto max-w-[1280px] px-6 pb-20 pt-[60px] text-center md:px-9">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--pill-bg))] px-3.5 py-[7px] text-[12.5px] font-semibold text-[hsl(var(--pill-fg))] shadow-[0_6px_18px_rgba(31,96,224,.25)] dark:border-[hsl(var(--landing-sky-primary)/.25)] dark:bg-[hsl(var(--landing-sky-primary)/.12)] dark:text-[hsl(var(--landing-sky-highlight))] dark:shadow-none">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--pill-fg))] dark:bg-[hsl(var(--landing-success))] dark:shadow-[0_0_8px_hsl(var(--landing-success)/.8)]" />
            A personal AI brain · MCP-native · Open source
          </div>

          <div className="mx-auto mb-[14px] grid max-w-[980px] items-center gap-9 text-left md:grid-cols-[auto_1fr]">
            <div className="relative mx-auto flex flex-col items-center gap-1.5 md:mx-0">
              <div className="absolute -inset-5 rounded-full bg-[radial-gradient(circle,hsl(var(--brand)/.08),transparent_65%)] blur-xl dark:bg-[radial-gradient(circle,hsl(var(--landing-sky-primary)/.35),transparent_65%)]" />
              <Meni size={204} className="relative z-10 drop-shadow-[0_12px_30px_hsl(var(--brand)/.18)] dark:drop-shadow-[0_12px_30px_hsl(var(--landing-sky-primary)/.45)]" />
              <span className="relative z-10 rounded-full border border-[hsl(var(--border-strong)/.14)] bg-[hsl(var(--surface))] px-2.5 py-[3px] font-mono text-[11px] lowercase tracking-[.15em] text-[hsl(var(--brand))] dark:border-[hsl(var(--landing-sky-primary)/.3)] dark:bg-[hsl(var(--landing-sky-deep)/.25)] dark:text-[hsl(var(--landing-sky-primary))]">meni</span>
            </div>
            <div className="text-center md:text-left">
              <h1 className="landing-headline text-[clamp(54px,6vw,88px)] text-[hsl(var(--landing-text))] [letter-spacing:-.04em] dark:[text-shadow:0_4px_30px_rgba(0,0,0,.5)]">
                One Brain.<br />
                <span className="bg-[var(--brand-gradient)] bg-clip-text text-transparent dark:bg-[linear-gradient(180deg,#A6D9FF_0%,#3C9ADD_50%,#1A6EAE_100%)] dark:[filter:drop-shadow(0_0_50px_rgba(60,154,221,.5))]">Every AI.</span>
              </h1>
              <p className="mx-auto mt-[18px] max-w-[600px] text-lg leading-relaxed text-[hsl(var(--landing-body))] md:mx-0">Capture every thought — Menerio organizes it by meaning and makes it available to any AI you talk to.</p>
            </div>
          </div>

          <div className="mx-auto mb-6 flex min-h-[360px] max-w-[720px] items-start justify-center">
            <CaptureShowcase />
          </div>

          <div className="mb-[22px] flex justify-center">
            <Button onClick={() => navigate('/auth?tab=signup')} className="group h-14 rounded-[14px] border border-transparent bg-[hsl(var(--brand))] px-7 py-0 text-[15px] font-semibold leading-none text-[hsl(var(--landing-plain-white))] shadow-[0_8px_20px_rgba(31,96,224,.25)] hover:brightness-105 hover:shadow-[0_10px_24px_rgba(31,96,224,.32)] dark:bg-[linear-gradient(180deg,hsl(var(--landing-button-top)),hsl(var(--landing-button-bottom)))] dark:shadow-[0_0_24px_hsl(var(--landing-sky-primary)/.4),inset_0_1px_0_hsl(var(--landing-plain-white)/.2)] dark:hover:brightness-110">
              Get Started — Free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-[hsl(var(--landing-body))]">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--landing-success))]" />Capture from web, mobile, voice</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--landing-success))]" />Available in Claude, ChatGPT, Gemini</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--landing-success))]" />Open source · AGPL-3.0</span>
          </div>
        </section>

        <section className="relative z-10 border-t border-[hsl(var(--landing-plain-white)/.08)] px-6 pb-14 pt-24 md:px-9 lg:pb-16 lg:pt-28">
          <div className="mx-auto max-w-[1160px]">
            <div className="mx-auto mb-14 max-w-[760px] text-center">
              <p className="mb-4 font-mono text-[12px] font-semibold uppercase tracking-[.22em] text-[hsl(var(--landing-sky-highlight))]">Features</p>
              <h2 className="landing-headline text-[clamp(46px,5.6vw,78px)] text-[hsl(var(--landing-text))] [letter-spacing:-.04em] [text-shadow:0_4px_28px_hsl(var(--landing-ink)/.45)]">
                Your thoughts, supercharged by AI
              </h2>
              <p className="mx-auto mt-5 max-w-[650px] text-lg leading-relaxed text-[hsl(var(--landing-body))]">
                Not just another notes app. A database-backed knowledge system built for the age of AI agents.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {homepageFeatures.map((feature) => (
                <article
                  key={feature.title}
                  className="group relative overflow-hidden rounded-[18px] border border-[hsl(var(--landing-sky-primary)/.16)] bg-[linear-gradient(180deg,hsl(var(--landing-panel)/.74),hsl(var(--landing-card-deep)/.82))] p-6 text-left shadow-[0_18px_50px_hsl(var(--landing-ink)/.22)] transition duration-300 hover:-translate-y-1 hover:border-[hsl(var(--landing-sky-primary)/.35)] hover:shadow-[0_22px_70px_hsl(var(--landing-ink)/.34),0_0_34px_hsl(var(--landing-sky-primary)/.12)]"
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--landing-sky-primary)/.45),transparent)] opacity-70" />
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[14px] border border-[hsl(var(--landing-sky-primary)/.22)] bg-[hsl(var(--landing-sky-primary)/.12)] text-[hsl(var(--landing-sky-highlight))] shadow-[0_0_20px_hsl(var(--landing-sky-primary)/.14)] transition group-hover:bg-[hsl(var(--landing-sky-primary)/.18)]">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-3 font-[var(--font-display)] text-xl font-bold text-[hsl(var(--landing-text))]">{feature.title}</h3>
                  <p className="text-[15px] leading-relaxed text-[hsl(var(--landing-body))]">{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-10 px-6 pb-14 pt-0 text-center md:px-9 lg:pb-16">
          <div className="mx-auto max-w-[760px]">
            <h2 className="landing-headline text-[clamp(46px,5.3vw,76px)] text-[hsl(var(--landing-text))] [letter-spacing:-.04em] [text-shadow:0_4px_28px_hsl(var(--landing-ink)/.45)]">
              Ready to build your brain?
            </h2>
            <p className="mx-auto mt-4 max-w-[640px] text-lg leading-relaxed text-[hsl(var(--landing-body))]">
              Stop losing context every time you switch tools. Start building persistent, AI-accessible knowledge today.
            </p>
            <div className="mt-8 flex justify-center">
              <Button onClick={() => navigate('/auth?tab=signup')} className="group h-11 rounded-[10px] border border-transparent bg-[linear-gradient(180deg,hsl(var(--landing-button-top)),hsl(var(--landing-button-bottom)))] px-6 py-0 text-[13px] font-semibold leading-none text-[hsl(var(--landing-plain-white))] shadow-[0_0_24px_hsl(var(--landing-sky-primary)/.4),inset_0_1px_0_hsl(var(--landing-plain-white)/.2)] hover:brightness-110">
                Start Your Brain <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Index;
