import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Users,
  Globe,
  Plug,
  BarChart3,
  Heart,
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  Star,
  Quote,
} from "lucide-react";
import { useState, useEffect } from "react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const features = [
  { icon: Sparkles, title: "AI-Powered Insights", description: "Leverage machine learning to uncover hidden patterns and make data-driven decisions faster than ever." },
  { icon: Users, title: "Seamless Collaboration", description: "Work together in real-time with your team. Share, comment, and iterate without missing a beat." },
  { icon: Globe, title: "Open Source & Self-Hosted", description: "Full transparency and control. Deploy on your own infrastructure or use our managed cloud." },
  { icon: Plug, title: "Powerful Integrations", description: "Connect with 200+ tools you already use. From Slack to GitHub, everything works together." },
  { icon: BarChart3, title: "Analytics Dashboard", description: "Beautiful, real-time dashboards that tell the story behind your data at a glance." },
  { icon: Heart, title: "Community Driven", description: "Built by developers, for developers. Shape the roadmap and contribute to the future." },
];

const steps = [
  { icon: Zap, title: "Sign Up in Seconds", description: "Create your free account with just an email. No credit card required." },
  { icon: Shield, title: "Connect Your Data", description: "Import from your existing tools or start fresh. We handle the complexity." },
  { icon: Sparkles, title: "Get Actionable Insights", description: "Our AI analyzes your data and delivers insights you can act on immediately." },
];

const testimonials = [
  { name: "Sarah Chen", role: "CTO, TechFlow", quote: "Menerio transformed how our team collaborates. We shipped 3x faster in the first month.", avatar: "SC" },
  { name: "Marcus Rivera", role: "Lead Developer, Nexus", quote: "The AI insights alone saved us hundreds of hours. It's like having a data scientist on the team.", avatar: "MR" },
  { name: "Emily Zhang", role: "Product Manager, Bloom", quote: "Finally, a platform that's powerful enough for enterprise but simple enough for startups.", avatar: "EZ" },
];

const logos = ["Acme Corp", "Globex", "Initech", "Umbrella", "Stark Labs", "Wayne Tech"];

function useCarousel(length: number, interval = 5000) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % length), interval);
    return () => clearInterval(timer);
  }, [length, interval]);
  return index;
}

const Index = () => {
  const navigate = useNavigate();
  const activeTestimonial = useCarousel(testimonials.length);

  return (
    <div className="overflow-hidden">
      {/* ── Hero ── */}
      <section className="relative">
        {/* Animated gradient background */}
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
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Now in Beta — Join 2,000+ early adopters
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="text-4xl font-extrabold font-display tracking-tight sm:text-5xl lg:text-7xl"
            >
              Build Amazing Things
              <br />
              <span className="bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">
                with AI
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl"
            >
              Menerio is the modern platform that turns your ideas into reality.
              Manage projects, collaborate with your team, and ship faster — powered by AI.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button size="xl" onClick={() => navigate("/auth")} className="gap-2 text-base px-8">
                Get Started Free <ArrowRight className="h-4 w-4" />
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
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> Free forever plan</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> No credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> Setup in 2 min</span>
            </motion.div>
          </motion.div>

          {/* Hero visual */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-16 max-w-5xl"
          >
            <div className="rounded-2xl border bg-card/50 backdrop-blur-sm p-2 shadow-xl">
              <div className="rounded-xl bg-gradient-to-br from-muted/50 to-muted aspect-[16/9] flex items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                    <BarChart3 className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Dashboard Preview</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Your product screenshot goes here</p>
                </div>
              </div>
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
              Everything you need to ship faster
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              A complete toolkit designed for modern teams. Powerful alone, unstoppable together.
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
                <Card className="group relative h-full p-6 transition-all duration-300 hover:shadow-lg hover:border-primary/20 hover:-translate-y-1">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <f.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold font-display mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
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
              Up and running in minutes
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Three simple steps to transform your workflow.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="relative grid gap-8 lg:grid-cols-3"
          >
            {/* Connector line */}
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

      {/* ── Social Proof ── */}
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
              <Badge variant="secondary" className="mb-4">Social Proof</Badge>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl font-bold font-display sm:text-4xl">
              Loved by teams everywhere
            </motion.h2>
          </motion.div>

          {/* Testimonials */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="mx-auto max-w-2xl mb-20"
          >
            <Card className="relative overflow-hidden p-8 text-center">
              <Quote className="mx-auto mb-4 h-8 w-8 text-primary/20" />
              <div className="min-h-[120px] flex flex-col items-center justify-center">
                {testimonials.map((t, i) => (
                  <div
                    key={t.name}
                    className={`transition-all duration-500 absolute inset-0 flex flex-col items-center justify-center p-8 ${
                      i === activeTestimonial ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
                    }`}
                  >
                    <p className="text-lg font-medium text-foreground mb-6 italic leading-relaxed">"{t.quote}"</p>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {t.avatar}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Dots */}
              <div className="mt-20 flex justify-center gap-2">
                {testimonials.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === activeTestimonial ? "w-6 bg-primary" : "w-2 bg-muted-foreground/20"
                    }`}
                  />
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Logo cloud */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
          >
            <p className="text-center text-sm text-muted-foreground mb-8">Trusted by innovative teams</p>
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
              {logos.map((name) => (
                <div key={name} className="flex items-center gap-2 text-muted-foreground/40 transition-colors hover:text-muted-foreground/70">
                  <Star className="h-5 w-5" />
                  <span className="text-lg font-semibold font-display tracking-tight">{name}</span>
                </div>
              ))}
            </div>
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
              Ready to get started?
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Join thousands of teams already building faster with Menerio. Free forever — no credit card required.
            </motion.p>
            <motion.div variants={fadeUp} custom={2} className="mt-10">
              <Button size="xl" onClick={() => navigate("/auth")} className="gap-2 text-base px-10 shadow-lg shadow-primary/20">
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
