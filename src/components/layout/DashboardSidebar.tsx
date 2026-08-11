
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
  UserCircle,
  User,
  
  Network,
  Image,
  BookOpen,
  ClipboardList,
  Calendar,
  Layers,
  LayoutGrid,
  LogOut,
  Globe,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { BRAND } from "@/lib/brand";
import { brandLogo } from "@/lib/brand-assets";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
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
  const { role, signOut } = useAuth();
  const navigate = useNavigate();
  const isPremium = role === "premium" || role === "premium_gift" || role === "admin";
  const { completeness } = useProfileSummary();
  const { pendingCount } = useReviewQueue();

  const profileDotColor =
    completeness < 30 ? "bg-destructive" : completeness < 70 ? "bg-yellow-500" : "bg-green-500";

  const isActive = (path: string) =>
    path === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname.startsWith(path);

  // Nav groups are keyed so each brand can order them (BRAND.navGroupOrder)
  // without duplicating the item definitions.
  type NavItem = { title: string; url: string; icon: typeof LayoutDashboard };
  const groupsByKey: Record<string, { items: NavItem[] }> = {
    notes: {
      items: [
        { title: "Notes", url: "/dashboard/notes", icon: FileText },
        { title: "Note Graph", url: "/dashboard/graph", icon: Network },
        { title: "Lexicon", url: "/lexicon", icon: BookOpen },
      ],
    },
    people: {
      items: [
        { title: "People", url: "/dashboard/people", icon: UserCircle },
        { title: "World", url: "/dashboard/world", icon: Globe },
        { title: "Groups", url: "/dashboard/groups", icon: Layers },
        { title: "Timeline", url: "/dashboard/timeline", icon: Calendar },
      ],
    },
    collections: {
      items: [
        { title: "Collections", url: "/collections", icon: LayoutGrid },
        { title: "Media Library", url: "/dashboard/media", icon: Image },
      ],
    },
    review: {
      items: [
        { title: "Review Queue", url: "/dashboard/review-queue", icon: ClipboardList },
        { title: "Weekly Review", url: "/dashboard/review", icon: Calendar },
      ],
    },
  };
  const navGroups: { items: NavItem[] }[] = [
    { items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }] },
    ...BRAND.navGroupOrder.map((key) => groupsByKey[key]),
  ];

  const systemItems = [
    { title: "My Profile", url: "/dashboard/profile", icon: User },
    { title: "Settings", url: "/dashboard/settings", icon: Settings },
    { title: "Connect AI", url: "/dashboard/settings?tab=mcp", icon: Plug },
    ...(BRAND.showDocs ? [{ title: "Documentation", url: "/docs", icon: BookOpen }] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={brandLogo} alt={BRAND.name} className="h-7 w-7 object-contain" />
          {!collapsed && (
            <span className="text-sm font-semibold font-display text-foreground">{BRAND.name}</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group, idx) => (
          <div key={idx}>
            {idx > 0 && <SidebarSeparator />}
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <NavLink to={item.url} end={item.url === "/dashboard"}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {item.title === "Review Queue" && !collapsed && pendingCount > 0 && (
                            <Badge variant="default" className="ml-auto text-[10px] px-1.5 py-0 min-w-[1.25rem] justify-center">
                              {pendingCount}
                            </Badge>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}

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
          </>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={async () => { await signOut(); navigate("/"); }}
          title="Sign Out"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sign Out</span>}
        </Button>
        {!collapsed && (
          <p className="px-2 text-[10px] text-muted-foreground">© {new Date().getFullYear()} {BRAND.name}</p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
