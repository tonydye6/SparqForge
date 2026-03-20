import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AppLayout } from "@/components/layout/AppLayout";
import CampaignStudio from "@/pages/CampaignStudio";
import AssetLibrary from "@/pages/AssetLibrary";
import Calendar from "@/pages/Calendar";
import ReviewQueue from "@/pages/ReviewQueue";
import Settings from "@/pages/Settings";
import CostDashboard from "@/pages/CostDashboard";
import NotFound from "@/pages/not-found";

// The orval generated hooks will use this
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={CampaignStudio} />
        <Route path="/assets" component={AssetLibrary} />
        <Route path="/calendar" component={Calendar} />
        <Route path="/review" component={ReviewQueue} />
        <Route path="/settings" component={Settings} />
        <Route path="/costs" component={CostDashboard} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
