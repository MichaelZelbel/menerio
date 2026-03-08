import { SEOHead } from "@/components/SEOHead";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Search,
  Globe,
  Plug,
  Zap,
  Shield,
  ArrowRight,
  CheckCircle2,
  FileText,
  Sparkles,
  MessageSquare,
  Layers,
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

const features = [
  { icon: Brain, title: "AI-Powered Memory", description: "Every note is automatically embedded and classified. Your AI understands your thoughts by meaning, not just keywords." },
  { icon: Search, title: "Semantic Search", description: "Find anything by what it means, not just what it says. Ask questions and get relevant results from your entire knowledge base." },
  { icon: FileText, title: "Rich Note-Taking", description: "Capture thoughts, ideas, meeting notes, and references. Tag, pin, and organize everything your way." },
  { icon: Plug, title: "MCP-Ready", description: "Connect any AI tool — Claude, ChatGPT, Cursor — to your brain via the Model Context Protocol. One brain, every AI." },
  { icon: Globe, title: "Open & Portable", description: "Your knowledge lives in your database. No vendor lock-in, no SaaS middlemen. Export anytime." },
  { icon: Shield, title: "Private & Secure", description: "Row-level security ensures only you can access your thoughts. Your brain belongs to you." },
];

const steps = [
  { icon: Zap, title: "Sign Up", description: "Create your free account in seconds. Your personal brain database is set up instantly." },
  { icon: FileText, title: "Capture Thoughts", description: "Write notes, capture ideas, save references. Every entry is automatically processed by AI." },
  { icon: Brain, title: "Let AI Connect", description: "AI embeds, classifies, and surfaces connections between your thoughts — automatically." },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="overflow-hidden">
      <SEOHead
        title="Menerio — AI-Powered Knowledge System"
        description="One brain, every AI. Capture, embed, and search your thoughts with semantic AI. Your personal knowledge system that any AI tool can plug into."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Menerio",
          description: "AI-Powered Knowledge System",
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
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="info" className="mb-6 px-4 py-1.5 text-sm font-medium">
                <Brain className="mr-1.5 h-3.5 w-3.5" /> Your AI-powered second brain
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="text-5xl font-extrabold font-display tracking-tight sm:text-6xl lg:text-8xl"
            >
              One Brain.
              <br />
              <span className="bg-gradient-to-r from-primary via-info to-primary bg-[length:200%_auto] animate-[gradient-shift_6s_ease_infinite] bg-clip-text text-transparent">
                Every AI.
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground sm:text-xl leading-relaxed"
            >
              Menerio is your personal knowledge system where every thought is embedded,
              classified, and searchable by meaning — accessible from any AI tool you use.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button size="xl" onClick={() => navigate("/auth")} className="gap-2 text-base px-8 shadow-lg shadow-primary/25">
                Start Your Brain <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate("/features")} className="gap-2 text-base">
                See How It Works
              </Button>
            </motion.div>

            <motion.div
              variants={fadeUp}
              custom={4}
              className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> Free to start</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> AI-powered</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> MCP-ready</span>
            </motion.div>
          </motion.div>

          {/* Floating capability cards instead of dead box */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-20 max-w-4xl"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: MessageSquare, label: "Capture from Slack", desc: "Auto-save thoughts from chat" },
                { icon: Sparkles, label: "AI Embeddings", desc: "Semantic understanding built-in" },
                { icon: Layers, label: "Connect Any Tool", desc: "MCP protocol for all AIs" },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + i * 0.15, duration: 0.5 }}
                >
                  <Card className="group relative overflow-hidden p-5 text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30 bg-card/80 backdrop-blur-sm">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative">
                      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <p className="font-semibold font-display text-sm">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
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
              Your thoughts, supercharged by AI
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Not just another notes app. A database-backed knowledge system built for the age of AI agents.
            </motion.p>
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

      {/* ── How It Works ── */}
      <section className="border-t">
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
              Three steps to a smarter brain
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
              Ready to build your brain?
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Stop losing context every time you switch tools. Start building persistent, AI-accessible knowledge today.
            </motion.p>
            <motion.div variants={fadeUp} custom={2} className="mt-10">
              <Button size="xl" onClick={() => navigate("/auth")} className="gap-2 text-base px-10 shadow-lg shadow-primary/20">
                Start Your Brain <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default Index;
