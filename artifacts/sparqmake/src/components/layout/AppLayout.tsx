import { ReactNode, useState } from "react";
import { Sidebar, MobileTopBar } from "./Sidebar";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden selection:bg-primary/30 selection:text-primary-foreground">
      <MobileTopBar onMenuClick={() => setMobileOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <main className="flex-1 relative flex flex-col min-w-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background">
          {/*
            initial={false}: no entrance animation on the FIRST mount. On a cold
            load the main thread is busy booting modules, the 0.2s fade stalls
            mid-frame, and the whole app sits at half opacity looking clickable
            while nothing is wired yet — the "dimmed dead window" that ate three
            inputs in doc 40's walk (P1.5). Route CHANGES still crossfade; by
            then the app is warm and 0.2s means 0.2s.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              /*
               * THE CONTRACT, and it has bitten twice: this slot is
               * overflow-hidden, so a page that does not bring its own
               * `h-full overflow-y-auto` is CLIPPED, not scrolled, with nothing
               * on screen to say so. /design lost 2799px of 3752px that way and
               * the brand record lost every unset field.
               *
               * It stays hidden rather than becoming auto because Studio v2
               * manages its own panes and needs the outer box fixed. If you add
               * a page here, give it a scroller.
               */
              className="flex-1 h-full overflow-hidden flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
