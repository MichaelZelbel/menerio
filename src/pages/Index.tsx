import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container flex h-16 items-center justify-between">
          <h1 className="text-2xl font-bold font-display text-primary">Menerio</h1>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm">Sign In</Button>
            <Button size="sm">Get Started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container py-24 text-center">
        <Badge variant="info" className="mb-4">Now in Beta</Badge>
        <h1 className="mx-auto max-w-3xl">
          Build with confidence.<br />
          <span className="text-primary">Ship with clarity.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Menerio is your modern platform for managing projects, teams, and workflows — all in one place.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button size="xl">Start Free Trial</Button>
          <Button variant="outline" size="lg">Learn More</Button>
        </div>
      </section>

      {/* Cards showcase */}
      <section className="container pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="animate-fade-in">
            <CardHeader>
              <div className="mb-2"><Badge variant="success">Active</Badge></div>
              <CardTitle>Dashboard</CardTitle>
              <CardDescription>Real-time metrics and insights at a glance.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input placeholder="Search metrics..." />
            </CardContent>
          </Card>

          <Card className="animate-fade-in" style={{ animationDelay: "100ms" }}>
            <CardHeader>
              <div className="mb-2"><Badge variant="warning">In Progress</Badge></div>
              <CardTitle>Workflows</CardTitle>
              <CardDescription>Automate repetitive tasks with ease.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button size="sm">Create</Button>
                <Button variant="outline" size="sm">Import</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in" style={{ animationDelay: "200ms" }}>
            <CardHeader>
              <div className="mb-2"><Badge variant="error">3 Issues</Badge></div>
              <CardTitle>Reports</CardTitle>
              <CardDescription>Generate and export detailed reports.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm">Review</Button>
                <Button variant="ghost" size="sm">Dismiss</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Buttons showcase */}
      <section className="container pb-24">
        <h3 className="mb-6 font-display">Component Variants</h3>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="success">Success</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </section>
    </div>
  );
};

export default Index;
