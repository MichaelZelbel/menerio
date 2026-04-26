import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

export default function WikiLintPlaceholder() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <SEOHead title="Wiki lint — Menerio" noIndex />
      <Card className="max-w-md text-center">
        <CardContent className="py-12">
          <CardTitle className="mb-2">Coming soon</CardTitle>
          <CardDescription>Wiki linting will be available in a later step.</CardDescription>
          <Button className="mt-6" variant="secondary" onClick={() => navigate("/wiki")}>
            <ArrowLeft className="h-4 w-4" /> Back to Wiki
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}