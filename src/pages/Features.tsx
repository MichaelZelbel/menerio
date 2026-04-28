import { SEOHead } from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Brain,
  Search,
  Globe,
  Plug,
  Shield,
  FileText,
  Sparkles,
  MessageSquare,
  Layers,
  Zap,
  ArrowRight,
  Bot,
  Network,
  Tags,
  History,
  Share2,
  BarChart3,
  BookOpen,
  Workflow,
  Link2,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.06 } },
};

const coreFeatures = [
  {
    icon: Brain,
    title: "AI-Powered Memory",
    description:
      "Every note you capture is automatically embedded and classified using AI. Your knowledge base understands your thoughts by meaning — not just keywords.",
    highlights: ["Auto-classification", "Semantic embeddings", "Smart tagging"],
  },
  {
    icon: Search,
    title: "Semantic Search",
    description:
      "Find anything by what it means. Ask natural questions and get relevant results from your entire knowledge base, powered by vector similarity.",
    highlights: ["Natural language queries", "Vector search", "Instant results"],
  },
  {
    icon: Plug,
    title: "MCP Integration",
    description:
      "Connect any AI tool — Claude, ChatGPT, Cursor — to your brain via the Model Context Protocol. One knowledge base, accessible from every AI you use.",
    highlights: ["Claude & ChatGPT", "Cursor integration", "Universal protocol"],
  },
  {
    icon: FileText,
    title: "Rich Note-Taking",
    description:
      "Capture thoughts, meeting notes, ideas, and references with a powerful editor. Support for markdown, tags, pins, favorites, and rich media.",
    highlights: ["Markdown editor", "Media attachments", "Internal links"],
  },
  {
    icon: Network,
    title: "Note Graph",
    description:
      "Visualize how your notes connect. The interactive note graph reveals hidden patterns and relationships between your notes automatically.",
    highlights: ["Interactive visualization", "Auto-connections", "Cluster detection"],
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description:
      "Row-level security ensures only you can access your data. Your knowledge belongs to you — always encrypted, never shared, fully exportable.",
    highlights: ["Row-level security", "End-to-end privacy", "Full data export"],
  },
];

const captureChannels = [
  { icon: MessageSquare, label: "Slack", desc: "Auto-capture thoughts from Slack messages" },
  { icon: MessageSquare, label: "Telegram", desc: "Send notes directly from Telegram" },
  { icon: MessageSquare, label: "Discord", desc: "Capture ideas from Discord channels" },
  { icon: Bot, label: "MCP Protocol", desc: "Any AI agent can read & write to your brain" },
  { icon: Globe, label: "REST API", desc: "Full API access with scoped API keys" },
  { icon: FileText, label: "Web Editor", desc: "Rich editor with media & markdown support" },
];

const aiFeatures = [
  { icon: Sparkles, label: "Auto-Embedding", desc: "Every note is vectorized for semantic understanding" },
  { icon: Tags, label: "Smart Tags", desc: "AI suggests and applies relevant tags automatically" },
  { icon: Link2, label: "Suggested Links", desc: "Discover connections between notes you didn't see" },
  { icon: Bot, label: "Note Chat", desc: "Chat with your notes — ask questions, get answers" },
  { icon: BarChart3, label: "Media Analysis", desc: "AI analyzes images, PDFs, and documents" },
  { icon: Workflow, label: "Action Extraction", desc: "Automatically extract tasks and follow-ups" },
];

const organizationFeatures = [
  { icon: Layers, title: "Notebooks & Tags", description: "Organize with flexible tagging, pinning, and favorites. Filter and find notes your way." },
  { icon: History, title: "Version History", description: "Track every change. Browse and restore previous versions of any note at any time." },
  { icon: Share2, title: "Secure Sharing", description: "Share individual notes via secure, revocable links. Control access with one click." },
  { icon: BookOpen, title: "Profile System", description: "Build a structured knowledge profile — preferences, expertise, context — that AI agents can reference." },
  { icon: BarChart3, title: "Weekly Reviews", description: "AI-generated weekly summaries of your knowledge activity, new connections, and growth insights." },
  { icon: Zap, title: "Quick Capture", description: "Instantly capture a thought from anywhere in the app. Ideas don't wait, and neither should you." },
];

const Features = () => {
  const navigate = useNavigate();

  return (
    <div className="overflow-hidden">
      <SEOHead
        title="Features — Menerio"
        description="Explore Menerio's AI-powered knowledge features: semantic search, embeddings, MCP integration, knowledge graph, and more."
      />

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-1/2 -right-1/4 h-[600px] w-[600px] rounded-full bg-primary/8 blur-[120px]" />
          <div className="absolute -bottom-1/4 -left-1/4 h-[400px] w-[400px] rounded-full bg-info/6 blur-[100px]" />
        </div>
        <div className="container py-24 lg:py-32 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="info" className="mb-6 px-4 py-1.5 text-sm font-medium">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Everything your brain needs
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeUp}
              custom={1}
              className="text-4xl font-extrabold font-display tracking-tight sm:text-5xl lg:text-6xl"
            >
              Your knowledge,{" "}
              <span className="bg-gradient-to-r from-primary via-info to-primary bg-[length:200%_auto] animate-[gradient-shift_6s_ease_infinite] bg-clip-text text-transparent">
                supercharged
              </span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              custom={2}
              className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed"
            >
              Not just another notes app. Menerio is a database-backed knowledge system built for the
              age of AI agents — where every thought is embedded, connected, and accessible.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Core Features */}
      <section className="border-t bg-card/50">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Core Features</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Built for how you think
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Six pillars that make Menerio the most AI-native knowledge system available.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {coreFeatures.map((f, i) => (
              <motion.div key={f.title} variants={fadeUp} custom={i}>
                <Card className="group relative h-full overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:border-primary/20 hover:-translate-y-1">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <f.icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold font-display mb-2">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">{f.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {f.highlights.map((h) => (
                        <span key={h} className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Capture Channels */}
      <section className="border-t">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Capture Anywhere</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Thoughts don't wait — neither should capture
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Send notes from wherever you work. Every channel feeds into the same AI-powered brain.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {captureChannels.map((ch, i) => (
              <motion.div key={ch.label} variants={fadeUp} custom={i}>
                <Card className="group flex items-start gap-4 p-5 transition-all duration-300 hover:shadow-md hover:border-primary/20">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <ch.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold font-display text-sm">{ch.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ch.desc}</p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* AI Features */}
      <section className="border-t bg-card/50">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">AI Engine</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              AI that works while you think
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Every note triggers a pipeline of AI processing — embedding, tagging, linking, and analysis happen automatically in the background.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {aiFeatures.map((f, i) => (
              <motion.div key={f.label} variants={fadeUp} custom={i}>
                <Card className="group relative overflow-hidden p-5 text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <p className="font-semibold font-display text-sm">{f.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.desc}</p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Organization & Tools */}
      <section className="border-t">
        <div className="container py-24 lg:py-32">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Organization</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Stay organized, effortlessly
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Powerful tools to keep your knowledge structured, accessible, and growing.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {organizationFeatures.map((f, i) => (
              <motion.div key={f.title} variants={fadeUp} custom={i}>
                <Card className="group h-full p-6 transition-all duration-300 hover:shadow-md hover:border-primary/20 hover:-translate-y-1">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-primary">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold font-display mb-1.5">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Open Source & CTA */}
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
            <motion.div variants={fadeUp} custom={0}>
              <Badge variant="secondary" className="mb-4">Open Source</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl lg:text-5xl">
              Your brain, your rules
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Menerio is open source under AGPL-3.0. No vendor lock-in, no hidden data usage.
              Your knowledge stays yours — inspect the code, self-host, or export anytime.
            </motion.p>
            <motion.div variants={fadeUp} custom={3} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="xl" onClick={() => navigate("/auth?tab=signup")} className="gap-2 text-base px-8 shadow-lg shadow-primary/25">
                Start Your Brain <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="gap-2 text-base"
                onClick={() => window.open("https://github.com/MichaelZelbel/menerio", "_blank")}
              >
                <Globe className="h-4 w-4" /> View on GitHub
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default Features;
