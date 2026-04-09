import { SEOHead } from "@/components/SEOHead";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Search,
  Globe,
  Zap,
  Shield,
  ArrowRight,
  CheckCircle2,
  FileText,
  Sparkles,
  Lightbulb,
  Link2,
  Bot,
  PenLine,
  Code2,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const useCases = [
  {
    icon: Lightbulb,
    title: "Save ideas before you forget them",
    description: "Quick-capture thoughts from any device — your phone, browser, Slack, or Telegram. Just write and move on.",
  },
  {
    icon: Search,
    title: "Find that thing you read last month",
    description: "Search by what you meant, not exact words. Ask "that article about pricing strategy" and find it instantly.",
  },
  {
    icon: Link2,
    title: "Connect the dots between your notes",
    description: "AI automatically surfaces related thoughts you'd never find on your own. Your ideas start building on each other.",
  },
  {
    icon: Bot,
    title: "Use your notes in any AI tool",
    description: "Feed your knowledge into ChatGPT, Claude, or Cursor. Your personal brain becomes every AI's context.",
  },
];

const steps = [
  {
    icon: PenLine,
    title: "Write or paste anything",
    description: "Notes, links, meeting summaries, voice memos, Slack messages — capture from wherever you are.",
  },
  {
    icon: Sparkles,
    title: "AI organizes it for you",
    description: "Every note gets auto-tagged, embedded by meaning, and connected to related thoughts — no manual work.",
  },
  {
    icon: Search,
    title: "Search and use anywhere",
    description: "Find anything by meaning, not keywords. Plug your knowledge into any AI tool you use.",
  },
];

const features = [
  { icon: Brain, title: "Never forget anything", description: "Every note is embedded and classified by AI. Your memory becomes permanent and searchable." },
  { icon: Search, title: "Search by meaning", description: "Find notes by concept, even when you can't remember the exact words you used." },
  { icon: FileText, title: "Rich note-taking", description: "Capture thoughts, ideas, meeting notes, and references. Tag, pin, and organize your way." },
  { icon: Bot, title: "Works with any AI tool", description: "Connect ChatGPT, Claude, Cursor, or any AI via a simple protocol. One brain, every tool." },
  { icon: Globe, title: "Open & portable", description: "Your data lives in your database. No vendor lock-in. Export anytime, own everything." },
  { icon: Shield, title: "Private & secure", description: "Row-level security ensures only you can access your thoughts. Your brain belongs to you." },
];

const Index = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  const scrollToHowItWorks = () => {
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="overflow-hidden">
      <SEOHead
        title="Menerio — Remember Everything, Find Anything"
        description="Your personal knowledge base powered by AI. Write down thoughts, ideas, and notes — and find them by meaning, not just keywords. Free and open source."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Menerio",
          description: "Personal knowledge base powered by AI",
          applicationCategory: "ProductivityApplication",
        }}
      />

      {/* ── Hero ── */}
      <section className="relative min-h-[90vh] flex items-center">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-1/2 -left-1/4 h-[800px] w-[800px] rounded-full bg-primary/8 blur-[120px] animate-[pulse_8s_ease-in-out_infinite]" />
          <div className="absolute -bottom-1/2 -right-1/4 h-[600px] w-[600px] rounded-full bg-info/8 blur-[120px] animate-[pulse_10s_ease-in-out_infinite_1s]" />
          <div className="absolute top-1/4 right-1/3 h-[400px] w-[400px] rounded-full bg-secondary/6 blur-[100px] animate-[pulse_12s_ease-in-out_infinite_2s]" />
        </div>

        <div className="container relative py-28 lg:py-40">
          <motion.div
            className="mx-auto max-w-4xl text-center"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.h1
              variants={fadeUp}
              custom={0}
              className="text-5xl font-extrabold font-display tracking-tight sm:text-6xl lg:text-8xl"
            >
              Remember everything.
              <br />
              <span className="bg-gradient-to-r from-primary via-info to-primary bg-[length:200%_auto] animate-[gradient-shift_6s_ease_infinite] bg-clip-text text-transparent">
                Find anything.
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={1}
              className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground sm:text-xl leading-relaxed"
            >
              Menerio is your personal knowledge base. Write down thoughts, ideas,
              meeting notes, or links — and AI makes them searchable by meaning,
              not just keywords.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={2}
              className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button size="xl" onClick={() => navigate("/auth?tab=signup")} className="gap-2 text-base px-8 shadow-lg shadow-primary/25">
                Get Started Free <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="lg" onClick={scrollToHowItWorks} className="gap-2 text-base">
                See How It Works
              </Button>
            </motion.div>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground flex-wrap"
            >
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> Free to start</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> No credit card needed</span>
              <a
                href="https://github.com/MichaelZelbel/menerio"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <Code2 className="h-4 w-4 text-primary" /> Open Source
              </a>
            </motion.div>
          </motion.div>

          {/* Mini demo illustration */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-20 max-w-3xl"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              <Card className="p-5 bg-card/80 backdrop-blur-sm border-dashed">
                <p className="text-xs font-medium text-muted-foreground mb-1">You write:</p>
                <p className="text-sm font-medium">"Had a great call with Sarah about the Q3 pricing model…"</p>
              </Card>
              <div className="hidden sm:flex justify-center">
                <motion.div
                  animate={{ x: [0, 8, 0] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                >
                  <ArrowRight className="h-6 w-6 text-primary" />
                </motion.div>
              </div>
              <Card className="p-5 bg-card/80 backdrop-blur-sm border-primary/30">
                <p className="text-xs font-medium text-muted-foreground mb-1">You search later:</p>
                <p className="text-sm font-medium">"pricing discussion with Sarah"</p>
                <p className="text-xs text-success mt-2 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Found instantly</p>
              </Card>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Use Cases ── */}
      <section className="border-t bg-card/50">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Use Cases</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              What people use Menerio for
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Whether you're a founder, researcher, student, or creative — if you think a lot, Menerio helps you keep track.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-6 sm:grid-cols-2"
          >
            {useCases.map((uc, i) => (
              <motion.div key={uc.title} variants={fadeUp} custom={i}>
                <Card className="group relative h-full overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:border-primary/20 hover:-translate-y-1">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex gap-4">
                    <div className="flex-shrink-0 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <uc.icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold font-display mb-1">{uc.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{uc.description}</p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="border-t">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">How It Works</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Three steps. Zero effort.
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              From thought to searchable knowledge in seconds.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="relative grid gap-8 lg:grid-cols-3"
          >
            <div className="absolute top-16 left-0 right-0 hidden lg:block">
              <div className="mx-auto h-0.5 w-2/3 bg-gradient-to-r from-transparent via-border to-transparent" />
            </div>

            {steps.map((step, i) => (
              <motion.div key={step.title} variants={fadeUp} custom={i} className="relative text-center">
                <div className="mx-auto mb-6 flex h-32 w-32 flex-col items-center justify-center">
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                    <step.icon className="h-7 w-7 text-primary" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold font-display mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="border-t bg-card/50">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Features</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Everything you need, nothing you don't
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {features.map((f, i) => (
              <motion.div key={f.title} variants={fadeUp} custom={i}>
                <Card className="group relative h-full overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:border-primary/20 hover:-translate-y-1">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <f.icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold font-display mb-2">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative border-t">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-primary/10" />
          <div className="absolute -bottom-1/2 left-1/2 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-primary/8 blur-[120px]" />
        </div>
        <div className="container relative py-24 lg:py-32 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
          >
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl font-bold font-display sm:text-4xl lg:text-5xl">
              Start capturing your thoughts
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Stop losing ideas every time you switch tools. Build a knowledge base that grows smarter with every note.
            </motion.p>
            <motion.div variants={fadeUp} custom={2} className="mt-10">
              <Button size="xl" onClick={() => navigate("/auth?tab=signup")} className="gap-2 text-base px-10 shadow-lg shadow-primary/20">
                Get Started Free <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default Index;
