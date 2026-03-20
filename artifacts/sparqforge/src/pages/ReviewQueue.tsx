import { MoreHorizontal, MessageSquare, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ReviewQueue() {
  const columns = [
    { id: 'pending', title: 'Pending Review', count: 3, color: 'border-warning/50' },
    { id: 'reviewing', title: 'In Review', count: 1, color: 'border-primary/50' },
    { id: 'approved', title: 'Approved', count: 5, color: 'border-success/50' },
    { id: 'scheduled', title: 'Scheduled', count: 2, color: 'border-muted' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 w-full">
      <div className="mb-8 shrink-0">
        <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
        <p className="text-muted-foreground mt-1">Approve and provide feedback on generated campaigns.</p>
      </div>

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4 hide-scrollbar">
        {columns.map(col => (
          <div key={col.id} className="w-[320px] shrink-0 flex flex-col bg-background rounded-xl border border-border">
            <div className={`p-4 border-b ${col.color} border-t-4 rounded-t-xl bg-card/50 flex justify-between items-center`}>
              <h3 className="font-bold text-foreground uppercase tracking-wide text-sm">{col.title}</h3>
              <Badge variant="secondary" className="bg-muted text-muted-foreground">{col.count}</Badge>
            </div>
            
            <div className="flex-1 p-3 space-y-3 overflow-y-auto">
              {/* Mock Cards */}
              {Array.from({ length: col.count }).map((_, i) => (
                <div key={i} className="bg-card border border-border p-4 rounded-lg shadow-sm hover:border-primary/50 cursor-pointer transition-colors group">
                  <div className="flex justify-between items-start mb-3">
                    <Badge variant="outline" className="text-[10px] bg-background">Crown U</Badge>
                    <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                  
                  <h4 className="font-semibold text-sm text-foreground mb-2">Regional Finals Hype</h4>
                  
                  <div className="flex gap-2 mb-3">
                    <div className="w-8 h-8 rounded bg-muted border border-border" />
                    <div className="w-8 h-8 rounded bg-muted border border-border" />
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/50">
                    <div className="flex items-center gap-1">
                      <Clock size={12} /> Today, 2:30 PM
                    </div>
                    {col.id === 'reviewing' && (
                      <div className="flex items-center gap-1 text-primary">
                        <MessageSquare size={12} /> 2
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
