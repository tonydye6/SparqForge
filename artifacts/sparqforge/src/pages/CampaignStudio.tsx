import { useState } from "react";
import { Search, Plus, Play, MoreHorizontal, Settings2, Image as ImageIcon, FileText, Send, Save, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { 
  useGetBrands, 
  useGetTemplates, 
  useGetAssets,
  useCreateCampaign
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const PREVIEW_PANELS = [
  { id: "ig-feed", name: "Instagram Feed", platform: "instagram", ratio: "1:1", ratioClass: "aspect-square" },
  { id: "ig-story", name: "Instagram Story", platform: "instagram", ratio: "9:16", ratioClass: "aspect-[9/16]" },
  { id: "x-post", name: "X (Twitter)", platform: "twitter", ratio: "16:9", ratioClass: "aspect-video" },
  { id: "li-post", name: "LinkedIn", platform: "linkedin", ratio: "1.91:1", ratioClass: "aspect-[1.91/1]" },
];

export default function CampaignStudio() {
  const { toast } = useToast();
  
  const { data: brands } = useGetBrands();
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  
  const { data: templates } = useGetTemplates({ brandId: selectedBrand || undefined }, { query: { enabled: !!selectedBrand } });
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const { data: approvedAssets } = useGetAssets({ brandId: selectedBrand || undefined, status: "approved" }, { query: { enabled: !!selectedBrand } });
  const { data: briefs } = useGetAssets({ brandId: selectedBrand || undefined, type: "context" }, { query: { enabled: !!selectedBrand } });

  const [campaignName, setCampaignName] = useState("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [briefText, setBriefText] = useState("");
  const [refineText, setRefineText] = useState("");
  
  const createCampaignMutation = useCreateCampaign();

  const toggleAsset = (id: string, isPrimary: boolean) => {
    setSelectedAssets(prev => {
      if (prev.includes(id)) {
        return prev.filter(a => a !== id);
      } else {
        return [id, ...prev]; // naive array, in a real app might track primary vs supporting
      }
    });
  };

  const handleSaveDraft = () => {
    if (!selectedBrand) {
      toast({ variant: "destructive", title: "Brand required" });
      return;
    }
    
    createCampaignMutation.mutate({
      data: {
        name: campaignName || "Untitled Campaign",
        brandId: selectedBrand,
        templateId: selectedTemplate || null,
        briefText,
        selectedAssets: selectedAssets.map(id => ({ assetId: id, role: "primary" })),
        createdBy: "current_user",
      }
    }, {
      onSuccess: () => {
        toast({ title: "Draft Saved", description: "Campaign saved successfully." });
      }
    });
  };

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      
      {/* LEFT PANEL: Setup */}
      <aside className="w-[320px] shrink-0 border-r border-border bg-card/50 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Settings2 size={18} className="text-primary" />
            Campaign Setup
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Name</label>
            <Input 
              placeholder="e.g. Fall Tournament Hype" 
              className="bg-background border-border"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Brand DNA</label>
            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Select Brand" />
              </SelectTrigger>
              <SelectContent>
                {brands?.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.colorPrimary }} />
                      {b.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Template</label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate} disabled={!selectedBrand}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Select Template" />
              </SelectTrigger>
              <SelectContent>
                {templates?.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Assets</label>
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              {approvedAssets?.filter(a => a.type === 'visual').slice(0, 5).map(asset => {
                const isSelected = selectedAssets.includes(asset.id);
                return (
                  <div 
                    key={asset.id} 
                    onClick={(e) => toggleAsset(asset.id, !e.shiftKey)}
                    className={`aspect-square rounded-md bg-muted border-2 cursor-pointer overflow-hidden relative group transition-colors ${isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/50'}`}
                  >
                    {asset.thumbnailUrl || asset.fileUrl ? (
                       <img src={asset.thumbnailUrl || asset.fileUrl || ""} alt="Asset" className={`w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-card"><ImageIcon size={16} className="text-muted-foreground" /></div>
                    )}
                    {isSelected && <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] border border-background" />}
                  </div>
                )
              })}
              <div className="aspect-square rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer bg-background/50">
                <Plus size={20} />
              </div>
            </div>
            {selectedBrand && !approvedAssets?.length && <p className="text-xs text-muted-foreground italic">No approved visual assets found.</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Context Brief</label>
            <Select onValueChange={(val) => {
              const brief = briefs?.find(b => b.id === val);
              if(brief) setBriefText(brief.content || "");
            }} disabled={!selectedBrand || !briefs?.length}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Select a Brief" />
              </SelectTrigger>
              <SelectContent>
                {briefs?.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea 
              placeholder="Write custom brief or instructions for the AI..." 
              className="min-h-[120px] bg-background border-border text-sm resize-y mt-2"
              value={briefText}
              onChange={e => setBriefText(e.target.value)}
            />
          </div>
        </div>
        
        <div className="p-4 border-t border-border bg-background shadow-[0_-4px_10px_rgba(0,0,0,0.2)] z-10">
          <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20">
            <Play size={16} className="mr-2" /> Generate Campaign
          </Button>
        </div>
      </aside>

      {/* CENTER PANEL: Previews */}
      <section className="flex-1 flex flex-col min-w-0 relative bg-background/50">
        <div className="h-16 px-6 border-b border-border flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input 
              placeholder="Refine all variants... (e.g. 'Make it more aggressive', 'Add fire effects')" 
              className="w-full pl-10 bg-card border-border h-10 focus-visible:ring-primary/50"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            {refineText && (
              <Button size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 bg-primary hover:bg-primary/90">
                <Send size={14} />
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-3 ml-4">
            <Badge variant="outline" className="bg-card text-muted-foreground border-border">Draft Mode</Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto pb-12">
            {PREVIEW_PANELS.map((panel) => (
              <div key={panel.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-lg flex flex-col hover:border-border/80 transition-colors">
                <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={panel.platform} />
                    <span className="font-semibold text-sm">{panel.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{panel.ratio}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <MoreHorizontal size={16} />
                  </Button>
                </div>
                
                <div className="p-4 flex-1 flex flex-col gap-4">
                  <div className="flex gap-4">
                    <div className={`w-[120px] shrink-0 bg-muted/30 rounded-md border border-border/50 flex flex-col items-center justify-center text-muted-foreground overflow-hidden ${panel.ratioClass}`}>
                      <ImageIcon size={24} className="mb-2 opacity-20" />
                      <span className="text-[10px] font-medium uppercase tracking-wider opacity-50">Placeholder</span>
                    </div>
                    
                    <div className="flex-1 flex flex-col gap-2">
                      <Textarea 
                        className="flex-1 min-h-[100px] resize-none text-sm bg-background border-border p-3"
                        placeholder="AI generated caption will appear here..."
                      />
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[10px] text-muted-foreground">0 chars</span>
                        <div className="flex gap-1">
                           <Button variant="ghost" size="icon" className="h-6 w-6"><FileText size={12} /></Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="relative mt-auto">
                    <Input placeholder={`Refine ${panel.name}...`} className="text-xs h-8 bg-background border-border pr-8" />
                    <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-8 w-8 text-muted-foreground hover:text-primary">
                      <Send size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RIGHT PANEL: Status & Actions */}
      <aside className="w-[280px] shrink-0 border-l border-border bg-card/50 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-foreground">Overview</h2>
          <div className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">
            Cost: $0.00
          </div>
        </div>
        
        <div className="flex-1 p-4 overflow-y-auto">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Activity Log</h3>
          <div className="space-y-4">
            {[
              { time: "Just now", text: "Studio session started", user: "You" },
            ].map((log, i) => (
              <div key={i} className="flex gap-3 relative">
                {i !== 0 && <div className="absolute left-[11px] top-6 bottom-[-20px] w-px bg-border" />}
                <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 z-10">
                  {log.user.charAt(0)}
                </div>
                <div>
                  <p className="text-sm text-foreground">{log.text}</p>
                  <p className="text-xs text-muted-foreground">{log.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-4 border-t border-border space-y-2 bg-background">
          <Button 
            variant="outline" 
            className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground"
            onClick={handleSaveDraft}
            disabled={createCampaignMutation.isPending}
          >
            <Save size={16} className="mr-2 text-muted-foreground" /> 
            {createCampaignMutation.isPending ? "Saving..." : "Save Draft"}
          </Button>
          <Button variant="outline" className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground" disabled>
            <Download size={16} className="mr-2 text-muted-foreground" /> Download All Assets
          </Button>
          <Button className="w-full justify-center bg-primary hover:bg-primary/90 text-primary-foreground font-bold mt-2" disabled>
            Submit for Review
          </Button>
        </div>
      </aside>
    </div>
  );
}
