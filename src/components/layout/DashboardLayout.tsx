import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "./DashboardSidebar";
import { QuickCapture } from "@/components/notes/QuickCapture";

export function DashboardLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center gap-4 border-b bg-background px-4">
            <SidebarTrigger />
            <h2 className="text-sm font-semibold text-foreground">Menerio</h2>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
        <QuickCapture />
      </div>
    </SidebarProvider>
  );
}
