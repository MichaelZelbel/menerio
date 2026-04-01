import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { PageLoader } from "@/components/LoadingStates";

// Lazy-loaded routes
const Index = lazy(() => import("./pages/Index"));
const Features = lazy(() => import("./pages/Features"));
const Docs = lazy(() => import("./pages/Docs"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Notes = lazy(() => import("./pages/Notes"));
const Settings = lazy(() => import("./pages/Settings"));

const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Cookies = lazy(() => import("./pages/Cookies"));
const Impressum = lazy(() => import("./pages/Impressum"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Wizard = lazy(() => import("./pages/Wizard"));
const Admin = lazy(() => import("./pages/Admin"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const WeeklyReview = lazy(() => import("./pages/WeeklyReview"));
const People = lazy(() => import("./pages/People"));
const Actions = lazy(() => import("./pages/Actions"));
const KnowledgeGraph = lazy(() => import("./pages/KnowledgeGraph"));
const MediaLibrary = lazy(() => import("./pages/MediaLibrary"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<PageLayout />}>
                    <Route path="/" element={<Index />} />
                    <Route path="/features" element={<Features />} />
                    <Route path="/docs" element={<Docs />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/cookies" element={<Cookies />} />
                    <Route path="/impressum" element={<Impressum />} />
                  </Route>

                  <Route path="/auth" element={<Auth />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route
                    path="/wizard"
                    element={
                      <ProtectedRoute>
                        <Wizard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute>
                        <DashboardLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="notes" element={<Notes />} />
                    <Route path="notes/:noteId" element={<Notes />} />
                    <Route path="settings" element={<Settings />} />
                    
                    <Route path="activity" element={<ActivityPage />} />
                    <Route path="review" element={<WeeklyReview />} />
                    <Route path="people" element={<People />} />
                    <Route path="actions" element={<Actions />} />
                    <Route path="graph" element={<KnowledgeGraph />} />
                    <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
                  </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <CookieConsentBanner />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
