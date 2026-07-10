import { useNavigate } from "react-router-dom";
import { Heart, CalendarHeart, Sprout } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";
import cherryLeoHeart from "@/assets/brands/cherishly/cherry-leo-glowing-heart.webp";
import leoAvatar from "@/assets/brands/cherishly/leo-avatar.webp";
import cherryLeoHugging from "@/assets/brands/cherishly/cheery-leo-hugging.webp";
import cherry from "@/assets/brands/cherishly/cherry.webp";

// Deterministic pseudo-random placement for the floating hearts so the
// background doesn't reshuffle on re-renders.
const FLOATING_HEARTS = [...Array(18)].map((_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  size: 14 + ((i * 13) % 22),
  delay: `${(i * 1.7) % 18}s`,
  duration: `${20 + ((i * 5) % 14)}s`,
}));

const STEPS = [
  {
    title: "Remember",
    icon: Heart,
    mascot: leoAvatar,
    text: "Store the little details that make someone special — their likes, dreams, and moments that matter.",
  },
  {
    title: "Celebrate",
    icon: CalendarHeart,
    mascot: cherryLeoHugging,
    text: "Never miss a birthday, anniversary, or special occasion. Get gentle reminders when they matter most.",
  },
  {
    title: "Grow Together",
    icon: Sprout,
    mascot: cherryLeoHeart,
    text: "Build deeper connections through thoughtful gestures and shared memories that last a lifetime.",
  },
];

const CherishlyLanding = () => {
  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden bg-[image:var(--gradient-soft)]">
      <SEOHead
        title={`${BRAND.name} — Your little memory companion`}
        description={BRAND.metaDescription}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: BRAND.name,
          url: BRAND.url,
          description: BRAND.metaDescription,
          applicationCategory: "LifestyleApplication",
        }}
      />

      {/* Floating hearts background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {FLOATING_HEARTS.map((heart, i) => (
          <Heart
            key={i}
            className="absolute text-primary/30 animate-[float-heart_var(--fh-duration)_linear_infinite]"
            style={{
              left: heart.left,
              bottom: "-40px",
              width: heart.size,
              height: heart.size,
              animationDelay: heart.delay,
              ["--fh-duration" as string]: heart.duration,
              fill: "currentColor",
            }}
          />
        ))}
      </div>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-20 pt-20 text-center md:pt-28">
        <img
          src={cherryLeoHeart}
          alt="Cherry and Leo, the Cherishly mascots, holding a glowing heart"
          className="mx-auto mb-8 h-40 w-40 rounded-full object-cover shadow-[var(--shadow-glow)] animate-[pulse-soft_3s_ease-in-out_infinite] md:h-48 md:w-48"
        />
        <h1
          className="bg-[image:var(--gradient-primary)] bg-clip-text pb-2 text-5xl font-bold text-transparent md:text-7xl"
          style={{ lineHeight: 1.25 }}
        >
          Love deserves a little memory magic
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-xl font-light leading-relaxed text-foreground/80 md:text-2xl">
          Start cherishing someone special — before the moment fades.
        </p>
        <div className="mt-10">
          <Button
            size="lg"
            className="rounded-full bg-[image:var(--gradient-primary)] px-10 py-6 text-lg text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:scale-105"
            onClick={() => navigate("/auth?tab=signup")}
          >
            Cherish a Lovely Person 💕
          </Button>
          <p className="mt-4 text-sm font-light italic text-muted-foreground">
            Your little memory companion
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="mb-14 space-y-4 text-center">
          <h2 className="bg-[image:var(--gradient-primary)] bg-clip-text text-4xl font-bold text-transparent md:text-5xl">
            How {BRAND.name} Works
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Three simple steps to deepen your connections
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step) => (
            <Card
              key={step.title}
              className="border-primary/20 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-soft)]"
            >
              <CardContent className="space-y-4 pb-8 pt-8 text-center">
                <img
                  src={step.mascot}
                  alt=""
                  aria-hidden="true"
                  className="mx-auto h-24 w-24 rounded-full object-cover shadow-[var(--shadow-soft)]"
                />
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/10">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-2xl font-semibold text-foreground">{step.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{step.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-24 text-center">
        <img
          src={cherry}
          alt="Cherry, the Cherishly mascot"
          className="mx-auto mb-6 h-24 w-24 rounded-full object-cover shadow-[var(--shadow-soft)]"
        />
        <h2 className="text-3xl font-bold text-foreground md:text-4xl">
          Every heart has a story. Keep theirs close.
        </h2>
        <Button
          size="lg"
          className="mt-8 rounded-full bg-[image:var(--gradient-primary)] px-10 py-6 text-lg text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:scale-105"
          onClick={() => navigate("/auth?tab=signup")}
        >
          Start Cherishing — Free
        </Button>
      </section>
    </div>
  );
};

export default CherishlyLanding;
