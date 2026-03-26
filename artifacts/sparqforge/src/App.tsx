import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";

import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth, AuthProvider } from "@/hooks/useAuth";
import CreativeStudio from "@/pages/CreativeStudio";
import AssetLibrary from "@/pages/AssetLibrary";
import Calendar from "@/pages/Calendar";
import ReviewQueue from "@/pages/ReviewQueue";
import Settings from "@/pages/Settings";
import CostDashboard from "@/pages/CostDashboard";
import ContentPlan from "@/pages/ContentPlan";
import Login from "@/pages/Login";
import SetupWizard from "@/pages/SetupWizard";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    const currentPath = window.location.pathname;
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const relativePath = currentPath.replace(basePath, "") || "/";
    if (relativePath !== "/login") {
      return <Redirect to={`/login?returnTo=${encodeURIComponent(relativePath)}`} />;
    }
  }

  return <>{children}</>;
}

function FirstRunGuard({ children }: { children: React.ReactNode }) {
  const [brands, setBrands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/brands?limit=1", { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        setBrands(data.data || data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (brands.length === 0) {
    return <Redirect to="/setup" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <AuthGate>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/setup">
          <SetupWizard />
        </Route>
        <Route path="/">
          <FirstRunGuard>
            <AppLayout><CreativeStudio /></AppLayout>
          </FirstRunGuard>
        </Route>
        <Route path="/assets">
          <AppLayout><AssetLibrary /></AppLayout>
        </Route>
        <Route path="/calendar">
          <AppLayout><Calendar /></AppLayout>
        </Route>
        <Route path="/content-plan">
          <AppLayout><ContentPlan /></AppLayout>
        </Route>
        <Route path="/review">
          <AppLayout><ReviewQueue /></AppLayout>
        </Route>
        <Route path="/settings">
          <AppLayout><Settings /></AppLayout>
        </Route>
        <Route path="/costs">
          <AppLayout><CostDashboard /></AppLayout>
        </Route>
        <Route>
          <AppLayout><NotFound /></AppLayout>
        </Route>
      </Switch>
    </AuthGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
