import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Dashboard = () => (
  <div>
    <h1 className="text-2xl font-display font-bold mb-6">Welcome back</h1>
    <div className="grid gap-6 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Total Projects</CardDescription>
          <CardTitle className="text-3xl">12</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Active Tasks</CardDescription>
          <CardTitle className="text-3xl">48</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Team Members</CardDescription>
          <CardTitle className="text-3xl">8</CardTitle>
        </CardHeader>
      </Card>
    </div>
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">No recent activity to display.</p>
      </CardContent>
    </Card>
  </div>
);

export default Dashboard;
