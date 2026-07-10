// 1:1 port of the original Cherishly homepage (old repo: src/pages/Home.tsx).
// Markup and classes are kept verbatim for pixel fidelity; the only
// adaptations are import paths, and the CTA/Sign In targets (the old
// CherishWizard flow is replaced by this codebase's /auth signup).
import { useState, useEffect, useMemo } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Calendar, Users } from "lucide-react";
import cherishlyLogo from "@/assets/brands/cherishly/cherishly-logo.png";
import cherryAvatar from "@/assets/brands/cherishly/cherry.webp";
import leoAvatar from "@/assets/brands/cherishly/leo-avatar.webp";
import leoMessageReceivedAvatar from "@/assets/brands/cherishly/leo-message-received.webp";
import cheeryLeoHuggingAvatar from "@/assets/brands/cherishly/cheery-leo-hugging.webp";
import cherryLeoGlowingHeartAvatar from "@/assets/brands/cherishly/cherry-leo-glowing-heart.webp";

const CherishlyLanding = () => {
  const [, setIsLoggedIn] = useState(false);
  const navigate = useNavigate();

  // Randomly select avatar on component mount
  const selectedAvatar = useMemo(() => {
    const avatars = [cherryAvatar, leoAvatar, leoMessageReceivedAvatar, cheeryLeoHuggingAvatar, cherryLeoGlowingHeartAvatar];
    return avatars[Math.floor(Math.random() * avatars.length)];
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/dashboard", { replace: true });
      }
      setIsLoggedIn(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsLoggedIn(!!session);
      if (session) {
        navigate("/dashboard", { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <>
    <SEOHead
      title="Cherishly — Your Relationship Companion"
      description="Cherishly helps you remember and celebrate your loved ones — start free or upgrade for premium features like reminders, AI guidance, and more."
    />
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#FFD9E8] via-[#FFF0F5] to-[#FFF8F5]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-white/40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-center relative">
          <div className="flex items-center gap-2">
            <img src={cherishlyLogo} alt="Cherishly logo" className="w-8 h-8" />
            <span className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              CHERISHLY
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate("/auth")}
            className="absolute right-4 hover:bg-primary/10"
          >
            Sign In
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative flex-1 flex flex-col items-center justify-center pt-24 pb-20 px-4 overflow-hidden">
        {/* Floating Hearts Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(25)].map((_, i) => (
            <Heart
              key={i}
              className="absolute text-primary/20 animate-float-heart"
              style={{
                left: `${(i * 9) % 100}%`,
                top: `${100 + (i * 6)}%`,
                width: `${24 + (i % 4) * 16}px`,
                height: `${24 + (i % 4) * 16}px`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: `${5 + (i % 3) * 1.5}s`,
              }}
              fill="currentColor"
            />
          ))}
          {/* Mask to hide hearts under header */}
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-[#FFD9E8] via-[#FFD9E8] to-transparent z-10 pointer-events-none" />
        </div>

        {/* Vignette Shadow */}
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-black/5 pointer-events-none" />

        {/* Hero Content - Centered */}
        <div className="relative z-10 w-full max-w-4xl mx-auto text-center flex flex-col items-center animate-fade-in">
          {/* Avatar - Above Panel */}
          <div className="relative z-20 mb-0 pointer-events-none">
            <img
              src={selectedAvatar}
              alt="Your Cherishly companion"
              className="block w-44 md:w-72 lg:w-80 h-auto object-contain drop-shadow-2xl"
              style={{
                filter: 'drop-shadow(0 10px 40px rgba(0,0,0,0.2))',
              }}
            />
          </div>

          {/* Text Content with Glassy Panel */}
          <div className="relative z-0 mt-0 overflow-visible bg-white/40 backdrop-blur-xl rounded-3xl border border-white/60 shadow-2xl w-full">
            <div className="space-y-6 px-6 md:px-12 py-12 overflow-visible">
              {/* Headline */}
              <h1
                className="text-5xl md:text-7xl font-bold bg-gradient-primary bg-clip-text text-transparent pb-2"
                style={{
                  lineHeight: '1.35',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textRendering: 'optimizeLegibility',
                  WebkitFontSmoothing: 'antialiased',
                  textShadow: '0 0 1px rgba(0,0,0,0)',
                }}
              >
                Love deserves a little memory magic
              </h1>

              {/* Subheadline */}
              <p className="text-xl md:text-2xl text-gray-700/90 leading-relaxed max-w-2xl mx-auto font-light">
                Start cherishing someone special — before the moment fades.
              </p>

              {/* CTA Button */}
              <div className="pt-4">
                <Button
                  onClick={() => navigate("/auth?tab=signup")}
                  size="lg"
                  className="h-14 px-12 text-lg shadow-glow hover:shadow-xl transition-all duration-300 hover-scale"
                >
                  Cherish a Lovely Person 💕
                </Button>
              </div>

              {/* Supporting Tagline */}
              <p className="text-sm text-gray-600/80 italic font-light">
                Your little memory companion
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* How Cherishly Works Section */}
      <section className="relative py-20 px-4 bg-white/50 backdrop-blur-sm">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-4 animate-fade-in">
            <h2 className="text-4xl md:text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              How CHERISHLY Works
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Three simple steps to deepen your connections
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 animate-fade-in">
            {/* Remember Card */}
            <Card className="border-primary/20 bg-white/60 backdrop-blur-sm hover:shadow-lg transition-all duration-300 hover-scale">
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Heart className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-2xl font-semibold text-gray-800">Remember</h3>
                <p className="text-gray-600 leading-relaxed">
                  Store the little details that make someone special — their likes, dreams, and moments that matter.
                </p>
              </CardContent>
            </Card>

            {/* Celebrate Card */}
            <Card className="border-primary/20 bg-white/60 backdrop-blur-sm hover:shadow-lg transition-all duration-300 hover-scale">
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Calendar className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-2xl font-semibold text-gray-800">Celebrate</h3>
                <p className="text-gray-600 leading-relaxed">
                  Never miss a birthday, anniversary, or special occasion. Get gentle reminders when they matter most.
                </p>
              </CardContent>
            </Card>

            {/* Grow Together Card */}
            <Card className="border-primary/20 bg-white/60 backdrop-blur-sm hover:shadow-lg transition-all duration-300 hover-scale">
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Users className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-2xl font-semibold text-gray-800">Grow Together</h3>
                <p className="text-gray-600 leading-relaxed">
                  Build deeper connections through thoughtful gestures and shared memories that last a lifetime.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer — ported from the old app's global Footer; the Pricing and
          Help & Guide links are intentionally dropped (no pricing anymore,
          no /help route in this codebase). */}
      <footer className="w-full border-t bg-background py-8 mt-auto">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <a href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors underline">
                Privacy Policy
              </a>
              <span className="text-muted-foreground">•</span>
              <a href="/terms" className="text-muted-foreground hover:text-foreground transition-colors underline">
                Terms of Service
              </a>
              <span className="text-muted-foreground">•</span>
              <a href="/cookies" className="text-muted-foreground hover:text-foreground transition-colors underline">
                Cookies Policy
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Questions or feedback? Reach us anytime at{" "}
              <a href="mailto:support@cherishly.ai" className="text-foreground hover:text-primary transition-colors underline">
                support@cherishly.ai
              </a>
              {" "}💗
            </p>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} by Zelbel Ltd. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
    </>
  );
};

export default CherishlyLanding;
