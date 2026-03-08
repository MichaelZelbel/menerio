import { SEOHead } from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";

const Features = () => (
  <section className="container py-24 text-center">
    <SEOHead title="Features — OpenBrain" description="Explore OpenBrain's AI-powered knowledge features: semantic search, embeddings, MCP integration, and more." />
    <Badge variant="info" className="mb-4">Features</Badge>
    <h1>Your knowledge, supercharged</h1>
    <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
      AI-powered note management with semantic search, automatic classification, and MCP integration for any AI tool.
    </p>
  </section>
);

export default Features;
