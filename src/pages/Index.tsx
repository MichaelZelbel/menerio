import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-background">
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
          <Button size="xl" onClick={() => navigate("/get-started")}>Start Free Trial</Button>
          <Button variant="outline" size="lg" onClick={() => navigate("/features")}>Learn More</Button>
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
    </div>
  );
};

export default Index;
