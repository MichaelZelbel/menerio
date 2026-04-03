import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Search,
  Bookmark,
  Users,
  Settings,
  Bell,
  Crown,
  ShieldCheck,
  Plug,
  CalendarDays,
  UserCircle,
  User,
  ListChecks,
  Network,
  Image,
  BookOpen,
  ClipboardList,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import logoImg from "@/assets/logo.png";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { PremiumBadge } from "@/components/subscription/PremiumBadge";
import { CreditsDisplay } from "@/components/settings/CreditsDisplay";
import { useProfileSummary } from "@/hooks/useProfileSummary";
import { useReviewQueue } from "@/hooks/useReviewQueue";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

export function DashboardSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role } = useAuth();
  const isPremium = role === "premium" || role === "premium_gift" || role === "admin";
  const { completeness } = useProfileSummary();

  const profileDotColor =
    completeness < 30 ? "bg-destructive" : completeness < 70 ? "bg-yellow-500" : "bg-green-500";

  const isActive = (path: string) =>
    path === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname.startsWith(path);

  const mainItems = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Notes", url: "/dashboard/notes", icon: FileText },
    { title: "People", url: "/dashboard/people", icon: UserCircle },
    { title: "Actions", url: "/dashboard/actions", icon: ListChecks },
    { title: "Weekly Review", url: "/dashboard/review", icon: CalendarDays },
    { title: "Knowledge Graph", url: "/dashboard/graph", icon: Network },
    { title: "Media Library", url: "/dashboard/media", icon: Image },
  ];

  const premiumItems = [
    { title: "Team", url: "/dashboard/team", icon: Users },
  ];

  const systemItems = [
    { title: "My Profile", url: "/dashboard/profile", icon: User },
    { title: "Settings", url: "/dashboard/settings", icon: Settings },
    { title: "Connect AI", url: "/dashboard/settings?tab=mcp", icon: Plug },
    { title: "Documentation", url: "/docs", icon: BookOpen },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={logoImg} alt="Menerio" className="h-7 w-7 object-contain" />
          {!collapsed && (
            <span className="text-sm font-semibold font-display text-foreground">Menerio</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <NavLink to={item.url} end={item.url === "/dashboard"}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {premiumItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <NavLink to={isPremium ? item.url : "#"}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {!collapsed && <PremiumBadge className="ml-auto" />}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <NavLink to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.title === "My Profile" && !collapsed && (
                        <span className={`ml-auto h-2 w-2 rounded-full ${profileDotColor}`} />
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {role === "admin" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/dashboard/admin")} tooltip="Admin">
                    <NavLink to="/dashboard/admin">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Admin</span>
                      {!collapsed && (
                        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-warning/30 text-warning">
                          Admin
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && (
          <>
            <SidebarSeparator />
            <CreditsDisplay compact />
            <p className="px-2 text-[10px] text-muted-foreground">© {new Date().getFullYear()} Menerio</p>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
