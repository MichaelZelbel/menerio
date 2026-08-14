import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardSearch } from "./DashboardSearch";
import { GlobalCreateButton } from "./GlobalCreateButton";
import { GlobalAIChatFAB } from "@/components/chat/GlobalAIChatFAB";
import { CommandPalette } from "./CommandPalette";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LowBalanceBanner } from "./LowBalanceBanner";
import { useProcessingSweep } from "@/hooks/useProcessingSweep";



export function DashboardLayout() {
  useProcessingSweep();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center gap-4 border-b bg-background px-4">
            <SidebarTrigger />
            <DashboardSearch />
            <GlobalCreateButton />
            <div className="ml-auto flex items-center gap-1">
              <NotificationCenter />
              <ThemeToggle />
            </div>
          </header>
          <LowBalanceBanner />


          
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
        <GlobalAIChatFAB />
        <CommandPalette />
      </div>
    </SidebarProvider>
  );
}
