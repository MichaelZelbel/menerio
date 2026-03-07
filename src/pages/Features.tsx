import { SEOHead } from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";

const Features = () => (
  <section className="container py-24 text-center">
    <SEOHead title="Features — Menerio" description="Explore Menerio's powerful features for project management, team collaboration, and AI-powered workflows." />
    <Badge variant="info" className="mb-4">Features</Badge>
    <h1>Powerful features for modern teams</h1>
    <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
      Everything you need to manage projects, collaborate with your team, and ship faster.
    </p>
  </section>
);

export default Features;
