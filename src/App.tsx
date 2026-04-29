import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
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
const WikiHome = lazy(() => import("./pages/WikiHome"));
const WikiLintPlaceholder = lazy(() => import("./pages/WikiLintPlaceholder"));
const WikiPage = lazy(() => import("./pages/WikiPage"));
const Settings = lazy(() => import("./pages/Settings"));

const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Cookies = lazy(() => import("./pages/Cookies"));

const CommunityGuidelines = lazy(() => import("./pages/CommunityGuidelines"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Wizard = lazy(() => import("./pages/Wizard"));
const Admin = lazy(() => import("./pages/Admin"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const WeeklyReview = lazy(() => import("./pages/WeeklyReview"));
const Actions = lazy(() => import("./pages/Actions"));
const People = lazy(() => import("./pages/People"));
const Groups = lazy(() => import("./pages/Groups"));
const GroupDetail = lazy(() => import("./pages/GroupDetail"));
const Collections = lazy(() => import("./pages/Collections"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const CollectionSchema = lazy(() => import("./pages/CollectionSchema"));
const TimelinePage = lazy(() => import("./pages/TimelinePage"));

const KnowledgeGraph = lazy(() => import("./pages/KnowledgeGraph"));
const MediaLibrary = lazy(() => import("./pages/MediaLibrary"));
const Profile = lazy(() => import("./pages/Profile"));
const SharedNote = lazy(() => import("./pages/SharedNote"));
const ReviewQueue = lazy(() => import("./pages/ReviewQueue"));

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

const LegacyWikiRedirect = () => {
  const { slug } = useParams<{ slug?: string }>();
  return <Navigate to={slug ? `/lexicon/${slug}` : "/lexicon"} replace />;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange={false}>
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
                    
                    <Route path="/community-guidelines" element={<CommunityGuidelines />} />
                  </Route>

                  <Route path="/shared/:token" element={<SharedNote />} />

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
                    <Route path="actions" element={<Actions />} />
                    <Route path="review" element={<WeeklyReview />} />
                    <Route path="timeline" element={<TimelinePage />} />
                    <Route path="people" element={<People />} />
                    <Route path="groups" element={<Groups />} />
                    <Route path="groups/:slug" element={<GroupDetail />} />
                    
                    <Route path="review-queue" element={<ReviewQueue />} />
                    <Route path="graph" element={<KnowledgeGraph />} />
                    <Route path="media" element={<MediaLibrary />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
                  </Route>

                  <Route
                    path="/collections"
                    element={
                      <ProtectedRoute>
                        <DashboardLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Collections />} />
                    <Route path=":slug" element={<CollectionDetail />} />
                    <Route path=":slug/schema" element={<CollectionSchema />} />
                  </Route>

                  <Route
                    path="/lexicon"
                    element={
                      <ProtectedRoute>
                        <DashboardLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<WikiHome />} />
                    <Route path="lint" element={<WikiLintPlaceholder />} />
                    <Route path=":slug" element={<WikiPage />} />
                  </Route>

                  <Route path="/wiki" element={<LegacyWikiRedirect />} />
                  <Route path="/wiki/lint" element={<Navigate to="/lexicon/lint" replace />} />
                  <Route path="/wiki/:slug" element={<LegacyWikiRedirect />} />

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
