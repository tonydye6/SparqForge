import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Library, 
  Calendar as CalendarIcon, 
  CheckSquare, 
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useGetCampaigns } from "@workspace/api-client-react";

export function Sidebar() {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { data: campaigns } = useGetCampaigns();
  const [calendarCount, setCalendarCount] = useState(0);

  const reviewCount = campaigns?.filter(c => c.status === "pending_review" || c.status === "in_review").length || 0;

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    fetch(`/api/calendar-entries?start=${start.toISOString()}&end=${end.toISOString()}`)
      .then(res => res.json())
      .then(data => setCalendarCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  const NAV_ITEMS = [
    { href: "/", label: "Campaign Studio", icon: LayoutDashboard },
    { href: "/assets", label: "Asset Library", icon: Library },
    { href: "/calendar", label: "Calendar", icon: CalendarIcon, badge: calendarCount || undefined },
    { href: "/review", label: "Review Queue", icon: CheckSquare, badge: reviewCount || undefined },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 240 }}
      className="h-screen flex flex-col bg-sidebar border-r border-sidebar-border relative z-20 shrink-0 transition-all duration-300 ease-in-out"
    >
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border shrink-0 overflow-hidden">
        <img 
          src={`${import.meta.env.BASE_URL}images/sparq-logo.png`} 
          alt="SparqForge Logo" 
          className="w-8 h-8 rounded shrink-0 object-cover"
        />
        {!collapsed && (
          <span className="ml-3 font-display font-bold text-xl text-foreground whitespace-nowrap">
            SPARQ<span className="text-primary">FORGE</span>
          </span>
        )}
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 bg-card border border-border rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-accent hover:border-accent transition-colors z-50"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center px-3 py-3 rounded-lg transition-all duration-200 group relative",
                isActive 
                  ? "bg-primary/10 text-primary" 
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              title={collapsed ? item.label : undefined}
            >
              {isActive && (
                <motion.div 
                  layoutId="activeNavIndicator"
                  className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"
                  initial={false}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon size={20} className={cn("shrink-0", isActive && "text-primary")} />
              
              {!collapsed && (
                <span className="ml-3 font-medium text-sm whitespace-nowrap flex-1">
                  {item.label}
                </span>
              )}

              {!collapsed && item.badge && (
                <span className="ml-auto bg-primary/20 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
              
              {collapsed && item.badge && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border shrink-0">
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          <div className="flex items-center overflow-hidden">
            <img 
              src={`${import.meta.env.BASE_URL}images/avatar.png`}
              alt="User Avatar"
              className="w-9 h-9 rounded-full object-cover border border-border"
            />
            {!collapsed && (
              <div className="ml-3 truncate">
                <p className="text-sm font-semibold text-foreground truncate">Alex Hunter</p>
                <p className="text-xs text-muted-foreground truncate">Creator</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-md hover:bg-destructive/10">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
