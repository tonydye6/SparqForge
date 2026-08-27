import { Link, useLocation } from "wouter";
import { 
  Library, 
  Calendar as CalendarIcon, 
  CheckSquare, 
  Settings,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
  MessageSquareText,
  Sparkles,
  Palette,
  TrendingUp,
  Layers
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, apiFetch } from "@/lib/utils";
import { useGetCreatives, getCalendarEntries } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/useAuth";

type SidebarMode = "mobile" | "tablet" | "desktop";

function useResponsiveMode(): SidebarMode {
  const [mode, setMode] = useState<SidebarMode>(() => {
    if (typeof window === "undefined") return "desktop";
    if (window.innerWidth < 768) return "mobile";
    if (window.innerWidth < 1280) return "tablet";
    return "desktop";
  });

  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) setMode("mobile");
      else if (window.innerWidth < 1280) setMode("tablet");
      else setMode("desktop");
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const [location] = useLocation();
  const mode = useResponsiveMode();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const { data: creatives } = useGetCreatives();
  const [calendarCount, setCalendarCount] = useState(0);
  const [pendingAssetCount, setPendingAssetCount] = useState(0);
  const { user, logout } = useAuth();

  const reviewCount = creatives?.data?.filter(c => c.status === "pending_review" || c.status === "in_review").length || 0;

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    getCalendarEntries({ start: start.toISOString(), end: end.toISOString() })
      .then(data => setCalendarCount(data.entries.length))
      .catch((err) => console.error("Failed to load calendar count:", err));
  }, []);

  useEffect(() => {
    apiFetch("/api/assets?status=uploaded&limit=1")
      .then(res => res.json())
      .then(data => setPendingAssetCount(data.total || 0))
      .catch((err) => console.error("Failed to load asset count:", err));
  }, []);

  /**
   * Phase 2 consolidation. Spec: SparqMake Sandbox/22_IMPLEMENTATION_PLAN.md
   *
   * Was 11 items, now 9. Calendar and Content Plan are gone, merged into
   * Pipeline, and Feedback has moved to the footer where a link that gets used
   * twice a year belongs.
   *
   * The plan's target is 7, and the remaining two come out when their
   * replacements actually exist, not before:
   *
   *   Creative History  → retires into the Studio session rail in Phase 4
   *   Review Queue      → dissolves when approval-on-the-artifact ships in Phase 6
   *
   * Removing either now would take a working feature off the nav and leave
   * nothing in its place, which is a regression dressed up as progress.
   */
  const NAV_ITEMS = [
    /*
     * The moment the old comment here predicted: "when v2 reaches parity it
     * becomes Studio". Every retirement gate from doc 39 §3 is met — refine,
     * motion and metering all live in v2 — so v2 carries the name and the top
     * slot, and "/" redirects here. The Co-pilot row below stays until Tony
     * approves removing the legacy stack completely; demoted is not deleted.
     */
    { href: "/studio-v2", label: "Studio", icon: Layers },
    { href: "/pipeline", label: "Pipeline", icon: CalendarIcon, badge: calendarCount || undefined },
    { href: "/copilot", label: "Co-pilot · legacy", icon: MessageSquareText },
    { href: "/studio", label: "Creative History", icon: Sparkles },
    { href: "/assets", label: "Asset Library", icon: Library, badge: pendingAssetCount || undefined },
    { href: "/brand", label: "Brand", icon: Palette },
    { href: "/review", label: "Review Queue", icon: CheckSquare, badge: reviewCount || undefined },
    { href: "/performance", label: "Performance", icon: TrendingUp },
    { href: "/costs", label: "Cost Dashboard", icon: DollarSign },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const collapsed = mode === "tablet" ? !tabletExpanded : mode === "desktop" ? desktopCollapsed : false;
  const sidebarWidth = collapsed ? 64 : 220;

  const displayName = user?.name || user?.email || "User";
  const displayRole = user?.role || "viewer";
  const avatarUrl = user?.image || `${import.meta.env.BASE_URL}images/avatar.png`;

  const handleNavClick = () => {
    if (mode === "mobile") {
      onMobileClose();
    }
    if (mode === "tablet") {
      setTabletExpanded(false);
    }
  };

  const sidebarContent = (
    <motion.aside
      initial={false}
      animate={{ width: mode === "mobile" ? 280 : sidebarWidth }}
      className={cn(
        // Same ground as the app, no right keyline: the nav is a margin of the
        // room, not a cabinet bolted to it. The content column separates itself.
        "h-screen flex flex-col bg-sidebar relative z-20 shrink-0 transition-all duration-300 ease-in-out",
        mode === "mobile" && "w-[280px]"
      )}
    >
      <div className="h-16 flex items-center px-5 shrink-0 overflow-hidden">
        {mode === "mobile" || !collapsed ? (
          <img
            src={`${import.meta.env.BASE_URL}images/sparqmake-horizontal.svg`}
            alt="SparqMake"
            className="h-9 w-auto shrink-0"
          />
        ) : (
          <img
            src={`${import.meta.env.BASE_URL}images/sparq-logo.png`}
            alt="SparqMake"
            className="w-8 h-8 rounded shrink-0 object-cover"
          />
        )}
        {mode === "mobile" && (
          <button
            onClick={onMobileClose}
            className="ml-auto p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {mode === "desktop" && (
        <button
          onClick={() => setDesktopCollapsed(!desktopCollapsed)}
          className="absolute -right-3 top-20 bg-card border border-border rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-accent hover:border-accent transition-colors z-50"
        >
          {desktopCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      )}

      {mode === "tablet" && (
        <button
          onClick={() => setTabletExpanded(!tabletExpanded)}
          className="absolute -right-3 top-20 bg-card border border-border rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-accent hover:border-accent transition-colors z-50"
        >
          {tabletExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      )}

      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map((item) => {
          // Match on a path SEGMENT boundary, not a bare prefix.
          //
          // A bare startsWith lit up two nav items at once: Creative History is
          // "/studio" and Studio v2 is "/studio-v2", and "/studio-v2" starts with
          // "/studio", so both highlighted and the sidebar said you were somewhere
          // you were not. Requiring the next character to be "/" keeps
          // "/studio/123" matching "/studio" while "/studio-v2" no longer does.
          const isActive =
            location === item.href ||
            (item.href !== "/" && location.startsWith(`${item.href}/`));
          const showLabel = mode === "mobile" || !collapsed;
          return (
            <Link 
              key={item.href} 
              href={item.href}
              onClick={handleNavClick}
              className={cn(
                // The row is text, not a pill. Active = ink + the teal edge;
                // colour is not spent on a whole row of chrome.
                "flex items-center px-3 py-2 rounded-md transition-colors duration-150 group relative",
                isActive
                  ? "bg-white/[0.04] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
              )}
              title={collapsed && mode !== "mobile" ? item.label : undefined}
            >
              {isActive && (
                <motion.div 
                  layoutId="activeNavIndicator"
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-full"
                  initial={false}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon size={17} strokeWidth={isActive ? 2.2 : 1.8} className="shrink-0" />

              {showLabel && (
                <span className="ml-3 text-[13px] font-medium whitespace-nowrap flex-1">
                  {item.label}
                </span>
              )}

              {/* A count is data, not an alert: plain tabular figures, no pill. */}
              {showLabel && item.badge && (
                <span className="ml-auto ui-data text-[11px] text-dim">
                  {item.badge}
                </span>
              )}
              
              {!showLabel && item.badge && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Secondary links. Feedback used to occupy a full nav slot; a link used
          twice a year does not earn one. /design is the internal design system
          reference and is deliberately not in the nav at all. */}
      {(mode === "mobile" || !collapsed) && (
        <div className="shrink-0 px-6 pb-3">
          <div className="flex items-center gap-4">
            <Link
              href="/feedback"
              onClick={handleNavClick}
              className="text-[11px] text-dim transition-colors hover:text-muted-foreground"
            >
              Feedback
            </Link>
            <Link
              href="/brand-record"
              onClick={handleNavClick}
              className="text-[11px] text-dim transition-colors hover:text-muted-foreground"
            >
              Record
            </Link>
            <Link
              href="/design"
              onClick={handleNavClick}
              className="text-[11px] text-dim transition-colors hover:text-muted-foreground"
            >
              Design
            </Link>
          </div>
        </div>
      )}

      <div className="px-5 pb-4 pt-2 shrink-0">
        <div className={cn("flex items-center", collapsed && mode !== "mobile" ? "justify-center" : "justify-between")}>
          <div className="flex items-center overflow-hidden">
            <img 
              src={avatarUrl}
              alt="User Avatar"
              className="w-8 h-8 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
            {(mode === "mobile" || !collapsed) && (
              <div className="ml-3 truncate">
                <p className="text-[13px] font-medium text-foreground truncate">{displayName}</p>
                <p className="text-[11px] text-dim truncate capitalize">{displayRole}</p>
              </div>
            )}
          </div>
          {(mode === "mobile" || !collapsed) && (
            <button
              onClick={logout}
              className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-md hover:bg-destructive/10"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );

  if (mode === "mobile") {
    return (
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={onMobileClose}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 z-50"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  return sidebarContent;
}

export function MobileTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="h-14 flex items-center px-4 bg-sidebar border-b border-sidebar-border shrink-0 md:hidden">
      <button
        onClick={onMenuClick}
        className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
      >
        <Menu size={22} />
      </button>
      <img 
        src={`${import.meta.env.BASE_URL}images/sparq-logo.png`} 
        alt="SparqMake Logo" 
        className="w-7 h-7 rounded shrink-0 object-cover ml-3"
      />
      <span className="ml-2 font-display font-bold text-lg text-foreground whitespace-nowrap">
        SPARQ<span className="text-primary">MAKE</span>
      </span>
    </div>
  );
}
