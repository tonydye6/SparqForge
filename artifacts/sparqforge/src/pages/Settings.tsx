import { useGetBrands, useCreateBrand } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Save, Hexagon, Shield, Hash, Type } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Settings() {
  const { data: brands, isLoading } = useGetBrands();

  if (isLoading) {
    return <div className="p-8 space-y-6">
      <Skeleton className="h-10 w-48 bg-card" />
      <Skeleton className="h-12 w-full max-w-2xl bg-card" />
      <Skeleton className="h-[400px] w-full bg-card" />
    </div>;
  }

  const activeBrands = brands?.length ? brands : [
    { id: "mock-1", name: "Crown U", colorPrimary: "#00A3FF" },
    { id: "mock-2", name: "Rumble U", colorPrimary: "#FF4D00" },
    { id: "mock-3", name: "Mascot Mayhem", colorPrimary: "#FFD700" },
    { id: "mock-4", name: "Corporate", colorPrimary: "#8B5CF6" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 max-w-[1200px] mx-auto w-full">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Brand Settings</h1>
          <p className="text-muted-foreground mt-1">Configure brand DNA, rules, and AI parameters.</p>
        </div>
        <Button className="bg-card border border-border hover:bg-muted text-foreground">
          <Plus className="mr-2 h-4 w-4" /> Add Brand
        </Button>
      </div>

      <Tabs defaultValue={activeBrands[0]?.id} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start overflow-x-auto rounded-xl p-1 mb-6 flex-shrink-0 hide-scrollbar">
          {activeBrands.map(brand => (
            <TabsTrigger 
              key={brand.id} 
              value={brand.id}
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-6 py-2"
            >
              <div className="w-2.5 h-2.5 rounded-full mr-2 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: brand.colorPrimary, color: brand.colorPrimary }} />
              {brand.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {activeBrands.map(brand => (
          <TabsContent key={brand.id} value={brand.id} className="flex-1 overflow-y-auto mt-0 pr-4 pb-12 space-y-8">
            
            {/* Brand Colors */}
            <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
                <Hexagon className="text-primary" size={20} />
                <h2 className="text-xl font-bold">Visual Identity</h2>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Primary</label>
                  <div className="flex gap-2 items-center">
                    <div className="w-10 h-10 rounded shadow-inner border border-border" style={{ backgroundColor: brand.colorPrimary }} />
                    <Input defaultValue={brand.colorPrimary} className="font-mono bg-background border-border" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Secondary</label>
                  <div className="flex gap-2 items-center">
                    <div className="w-10 h-10 rounded shadow-inner border border-border bg-[#1E3A5F]" />
                    <Input defaultValue="#1E3A5F" className="font-mono bg-background border-border" />
                  </div>
                </div>
              </div>
            </section>

            {/* AI Prompts */}
            <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
                <Type className="text-primary" size={20} />
                <h2 className="text-xl font-bold">Voice & Tone (AI Context)</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-semibold text-foreground mb-2 block">System Voice Prompt</label>
                  <p className="text-xs text-muted-foreground mb-2">Instructions injected into the LLM for every generation.</p>
                  <Textarea 
                    className="font-mono text-sm bg-background border-border min-h-[120px]" 
                    defaultValue={`You are the social media manager for ${brand.name}. Your tone is energetic, competitive, and highly engaged with the esports community. Use gaming terminology naturally but avoid cringe slang. Be hyped but professional.`}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-semibold text-foreground mb-2 block">Negative Prompt (Imagen)</label>
                  <Input 
                    className="font-mono text-sm bg-background border-border" 
                    defaultValue="ugly, deformed, poorly drawn, extra limbs, low resolution, watermark, text"
                  />
                </div>
              </div>
            </section>

            {/* Rules */}
            <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
                <Shield className="text-primary" size={20} />
                <h2 className="text-xl font-bold">Brand Safety</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="text-sm font-semibold text-foreground mb-2 block">Banned Terms (Comma separated)</label>
                  <Textarea 
                    className="bg-background border-border min-h-[100px]" 
                    defaultValue="kill, murder, dead game, toxic, abuse"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-foreground mb-2 block">Trademark Rules</label>
                  <Textarea 
                    className="bg-background border-border min-h-[100px]" 
                    defaultValue="Always capitalize the 'U' in Crown U. Never abbreviate to CU."
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end pt-4">
              <Button className="bg-primary hover:bg-primary/90 font-bold px-8 shadow-lg shadow-primary/25">
                <Save className="mr-2" size={18} /> Save Changes
              </Button>
            </div>

          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
