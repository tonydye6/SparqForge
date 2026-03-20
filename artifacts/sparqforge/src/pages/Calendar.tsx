import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Calendar() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  return (
    <div className="flex flex-col h-full overflow-hidden p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Content Calendar</h1>
          <p className="text-muted-foreground mt-1">Schedule and review upcoming posts.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-card border border-border rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><ChevronLeft size={16}/></Button>
            <span className="font-semibold text-sm px-4 min-w-[140px] text-center">October 2024</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><ChevronRight size={16}/></Button>
          </div>
          <Button variant="outline" className="bg-card border-border">
            <Filter size={16} className="mr-2" /> Filter
          </Button>
        </div>
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
        <div className="grid grid-cols-7 border-b border-border bg-background/50">
          {days.map(day => (
            <div key={day} className="py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>
        
        <div className="flex-1 grid grid-cols-7 grid-rows-5">
          {Array.from({ length: 35 }).map((_, i) => {
            const isCurrentMonth = i >= 2 && i <= 32;
            const hasEvent = i === 12 || i === 15 || i === 18 || i === 22;
            
            return (
              <div 
                key={i} 
                className={`border-r border-b border-border p-2 min-h-[100px] transition-colors hover:bg-muted/30 ${!isCurrentMonth ? 'bg-background/40 opacity-50' : ''}`}
              >
                <span className={`text-sm font-medium ${i === 15 ? 'bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center rounded-full' : 'text-muted-foreground'}`}>
                  {(i % 31) + 1}
                </span>
                
                {hasEvent && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] bg-[#00A3FF]/10 text-[#00A3FF] border border-[#00A3FF]/20 px-1.5 py-0.5 rounded truncate font-medium">
                      Crown U Match Announce
                    </div>
                    {i === 15 && (
                      <div className="text-[10px] bg-[#FF4D00]/10 text-[#FF4D00] border border-[#FF4D00]/20 px-1.5 py-0.5 rounded truncate font-medium">
                        Rumble U Highlights
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
