import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { 
  useGetBrands, 
  useCreateBrand, 
  useUpdateBrand, 
  useDeleteBrand,
  useGetTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  useGetSocialAccounts,
  useDeleteSocialAccount,
  useRefreshSocialAccount,
  type Brand
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { 
  Plus, Save, Hexagon, Shield, Hash, Type, Trash2, Edit2, LayoutTemplate,
  Share2, RefreshCw, Unplug, AlertTriangle, CheckCircle2, XCircle
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useSearch } from "wouter";

export default function Settings() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialTab = params.get("tab") === "accounts" ? "accounts" : "brands";
  const [activeSettingsTab, setActiveSettingsTab] = useState(initialTab);

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 max-w-[1200px] mx-auto w-full">
      <div className="mb-6 shrink-0">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your brands and connected social accounts.</p>
      </div>

      <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-fit rounded-xl p-1 mb-6 flex-shrink-0">
          <TabsTrigger value="brands" className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-6 py-2">
            <Hexagon className="mr-2 h-4 w-4" /> Brand Settings
          </TabsTrigger>
          <TabsTrigger value="accounts" className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-6 py-2">
            <Share2 className="mr-2 h-4 w-4" /> Connected Accounts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brands" className="flex-1 flex flex-col min-h-0 mt-0">
          <BrandSettingsTab />
        </TabsContent>
        <TabsContent value="accounts" className="flex-1 overflow-y-auto mt-0 pr-4 pb-12">
          <ConnectedAccountsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BrandSettingsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: brands, isLoading } = useGetBrands();
  const [activeBrandId, setActiveBrandId] = useState<string>("");
  const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);

  useEffect(() => {
    if (brands && brands.length > 0 && !activeBrandId) {
      setActiveBrandId(brands[0].id);
    }
  }, [brands, activeBrandId]);

  const activeBrand = brands?.find(b => b.id === activeBrandId);

  const createBrandMutation = useCreateBrand({
    mutation: {
      onSuccess: (newBrand) => {
        queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
        setIsAddBrandOpen(false);
        setActiveBrandId(newBrand.id);
        toast({ title: "Brand created successfully" });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Failed to create brand", description: err.message });
      }
    }
  });

  const onAddBrand = (data: any) => {
    createBrandMutation.mutate({
      data: {
        name: data.name,
        slug: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        colorPrimary: data.colorPrimary || "#ffffff",
        colorSecondary: data.colorSecondary || "#000000",
        colorAccent: data.colorAccent || "#ff0000",
        colorBackground: data.colorBackground || "#121212",
        voiceDescription: data.voiceDescription || "",
        bannedTerms: [],
        trademarkRules: "",
        hashtagStrategy: {},
        imagenPrefix: "",
        negativePrompt: "",
        platformRules: {
          "twitter": { "char_limit": 280 },
          "instagram_feed": { "char_limit": 2200 },
          "instagram_story": { "char_limit": 2200 },
          "linkedin": { "char_limit": 3000 }
        }
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 bg-card" />
        <Skeleton className="h-12 w-full max-w-2xl bg-card" />
        <Skeleton className="h-[400px] w-full bg-card" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <p className="text-muted-foreground">Configure brand DNA, rules, and AI parameters.</p>
        </div>
        
        <Dialog open={isAddBrandOpen} onOpenChange={setIsAddBrandOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 text-primary-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add Brand
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Brand</DialogTitle>
            </DialogHeader>
            <AddBrandForm onSubmit={onAddBrand} isSubmitting={createBrandMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {!brands?.length ? (
        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-border rounded-xl">
          <div className="text-center">
            <h3 className="text-lg font-bold mb-2">No Brands Found</h3>
            <p className="text-muted-foreground">Create your first brand to get started.</p>
          </div>
        </div>
      ) : (
        <Tabs value={activeBrandId} onValueChange={setActiveBrandId} className="flex-1 flex flex-col min-h-0">
          <TabsList className="bg-card border border-border w-full justify-start overflow-x-auto rounded-xl p-1 mb-6 flex-shrink-0 hide-scrollbar">
            {brands.map(brand => (
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

          <div className="flex-1 overflow-y-auto mt-0 pr-4 pb-12">
            {activeBrand && <BrandEditor key={activeBrand.id} brand={activeBrand} />}
          </div>
        </Tabs>
      )}
    </>
  );
}

const PLATFORM_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  twitter: { label: "Twitter / X", color: "#1DA1F2", icon: "X" },
  instagram: { label: "Instagram", color: "#E4405F", icon: "IG" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: "in" },
};

const AVAILABLE_PLATFORMS = [
  { id: "twitter", label: "Twitter / X", description: "Post tweets and threads" },
  { id: "instagram", label: "Instagram", description: "Share photos and reels" },
  { id: "linkedin", label: "LinkedIn", description: "Publish professional content" },
];

function ConnectedAccountsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: accounts, isLoading } = useGetSocialAccounts();
  const baseUrl = import.meta.env.VITE_API_URL || "";

  const deleteMutation = useDeleteSocialAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
        toast({ title: "Account disconnected" });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Failed to disconnect", description: err.message });
      }
    }
  });

  const refreshMutation = useRefreshSocialAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
        toast({ title: "Token refreshed successfully" });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Token refresh failed", description: err.message });
      }
    }
  });

  const handleConnect = (platform: string) => {
    window.location.href = `${baseUrl}/api/auth/${platform}`;
  };

  const connectedPlatforms = new Set(accounts?.map(a => a.platform) || []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full bg-card" />
        <Skeleton className="h-[200px] w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {accounts && accounts.length > 0 && (
        <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
            <Share2 className="text-primary" size={20} />
            <h2 className="text-xl font-bold">Connected Accounts</h2>
          </div>
          <div className="space-y-4">
            {accounts.map(account => {
              const config = PLATFORM_CONFIG[account.platform] || { label: account.platform, color: "#666", icon: "?" };
              const status = account.displayStatus || account.status;
              return (
                <div key={account.id} className="flex items-center justify-between p-4 border border-border bg-background rounded-lg">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: config.color }}
                    >
                      {config.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{account.accountName}</span>
                        <Badge variant="outline" className="text-xs">{config.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {status === "connected" && (
                          <span className="flex items-center gap-1 text-xs text-green-500">
                            <CheckCircle2 size={12} /> Connected
                          </span>
                        )}
                        {status === "expiring" && (
                          <span className="flex items-center gap-1 text-xs text-amber-500">
                            <AlertTriangle size={12} /> Token expiring soon
                          </span>
                        )}
                        {status === "expired" && (
                          <span className="flex items-center gap-1 text-xs text-red-500">
                            <XCircle size={12} /> Token expired
                          </span>
                        )}
                        {status === "revoked" && (
                          <span className="flex items-center gap-1 text-xs text-red-500">
                            <XCircle size={12} /> Revoked
                          </span>
                        )}
                        {account.tokenExpiry && (
                          <span className="text-xs text-muted-foreground">
                            Expires: {new Date(account.tokenExpiry).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(status === "expiring" || status === "expired") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refreshMutation.mutate({ id: account.id })}
                        disabled={refreshMutation.isPending}
                      >
                        <RefreshCw className={`h-4 w-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Refresh
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`Disconnect ${account.accountName}?`)) {
                          deleteMutation.mutate({ id: account.id });
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Unplug className="h-4 w-4 mr-1" /> Disconnect
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
          <Plus className="text-primary" size={20} />
          <h2 className="text-xl font-bold">Connect a Platform</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {AVAILABLE_PLATFORMS.map(platform => {
            const config = PLATFORM_CONFIG[platform.id];
            const isConnected = connectedPlatforms.has(platform.id);
            return (
              <div
                key={platform.id}
                className="flex flex-col items-center p-6 border border-border bg-background rounded-lg text-center"
              >
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-lg mb-3"
                  style={{ backgroundColor: config.color }}
                >
                  {config.icon}
                </div>
                <h3 className="font-semibold mb-1">{platform.label}</h3>
                <p className="text-xs text-muted-foreground mb-4">{platform.description}</p>
                <Button
                  variant={isConnected ? "outline" : "default"}
                  size="sm"
                  onClick={() => handleConnect(platform.id)}
                  className={!isConnected ? "bg-primary hover:bg-primary/90" : ""}
                >
                  {isConnected ? "Connect Another" : "Connect"}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AddBrandForm({ onSubmit, isSubmitting }: { onSubmit: (data: any) => void, isSubmitting: boolean }) {
  const { register, handleSubmit } = useForm();
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Brand Name</label>
        <Input {...register("name", { required: true })} placeholder="e.g. Crown U" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Voice Description</label>
        <Textarea {...register("voiceDescription")} placeholder="Energetic and professional..." rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Primary Color</label>
          <div className="flex gap-2">
            <Input type="color" {...register("colorPrimary")} defaultValue="#00A3FF" className="w-12 p-1 h-10" />
            <Input {...register("colorPrimary")} defaultValue="#00A3FF" className="font-mono flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Secondary Color</label>
          <div className="flex gap-2">
            <Input type="color" {...register("colorSecondary")} defaultValue="#1E3A5F" className="w-12 p-1 h-10" />
            <Input {...register("colorSecondary")} defaultValue="#1E3A5F" className="font-mono flex-1" />
          </div>
        </div>
      </div>
      <DialogFooter className="mt-6">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Brand"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function BrandEditor({ brand }: { brand: Brand }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { register, handleSubmit, reset, watch, setValue } = useForm({
    defaultValues: {
      name: brand.name,
      slug: brand.slug,
      colorPrimary: brand.colorPrimary,
      colorSecondary: brand.colorSecondary,
      colorAccent: brand.colorAccent,
      colorBackground: brand.colorBackground,
      voiceDescription: brand.voiceDescription || "",
      imagenPrefix: brand.imagenPrefix || "",
      negativePrompt: brand.negativePrompt || "",
      bannedTerms: brand.bannedTerms?.join(", ") || "",
      trademarkRules: brand.trademarkRules || "",
      platformRules: JSON.stringify(brand.platformRules || {}, null, 2),
      hashtagStrategy: JSON.stringify(brand.hashtagStrategy || {}, null, 2),
    }
  });

  const updateBrandMutation = useUpdateBrand({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
        toast({ title: "Brand updated successfully" });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Update failed", description: err.message });
      }
    }
  });

  const deleteBrandMutation = useDeleteBrand({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
        toast({ title: "Brand deleted" });
      }
    }
  });

  const onSubmit = (data: any) => {
    try {
      const parsedPlatformRules = JSON.parse(data.platformRules);
      const parsedHashtagStrategy = JSON.parse(data.hashtagStrategy);
      const bannedTermsArray = data.bannedTerms.split(",").map((s: string) => s.trim()).filter(Boolean);

      updateBrandMutation.mutate({
        id: brand.id,
        data: {
          ...brand,
          ...data,
          bannedTerms: bannedTermsArray,
          platformRules: parsedPlatformRules,
          hashtagStrategy: parsedHashtagStrategy,
        }
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Invalid JSON", description: e.message });
    }
  };

  const primary = watch("colorPrimary");
  const secondary = watch("colorSecondary");
  const accent = watch("colorAccent");
  const background = watch("colorBackground");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      
      {/* Visual Identity */}
      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Hexagon className="text-primary" size={20} />
            <h2 className="text-xl font-bold">Visual Identity</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              type="button" 
              variant="destructive" 
              size="sm" 
              onClick={() => {
                if(confirm("Are you sure you want to delete this brand?")) {
                  deleteBrandMutation.mutate({ id: brand.id });
                }
              }}
              disabled={deleteBrandMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete Brand
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <ColorField name="colorPrimary" label="Primary" value={primary} register={register} setValue={setValue} />
          <ColorField name="colorSecondary" label="Secondary" value={secondary} register={register} setValue={setValue} />
          <ColorField name="colorAccent" label="Accent" value={accent} register={register} setValue={setValue} />
          <ColorField name="colorBackground" label="Background" value={background} register={register} setValue={setValue} />
        </div>
      </section>

      {/* Voice & Tone */}
      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
          <Type className="text-primary" size={20} />
          <h2 className="text-xl font-bold">Voice & Tone (AI Context)</h2>
        </div>
        
        <div className="space-y-6">
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Voice Description</label>
            <Textarea {...register("voiceDescription")} className="font-mono text-sm bg-background border-border min-h-[120px]" />
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">Imagen Prefix</label>
              <Textarea {...register("imagenPrefix")} className="font-mono text-sm bg-background border-border h-24" />
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">Negative Prompt</label>
              <Textarea {...register("negativePrompt")} className="font-mono text-sm bg-background border-border h-24" />
            </div>
          </div>
        </div>
      </section>

      {/* Rules */}
      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
          <Shield className="text-primary" size={20} />
          <h2 className="text-xl font-bold">Brand Safety & Rules</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Banned Terms (Comma separated)</label>
            <Textarea {...register("bannedTerms")} className="bg-background border-border min-h-[100px]" />
          </div>
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Trademark Rules</label>
            <Textarea {...register("trademarkRules")} className="bg-background border-border min-h-[100px]" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Platform Rules (JSON)</label>
            <Textarea {...register("platformRules")} className="font-mono text-sm bg-background border-border min-h-[200px]" />
          </div>
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Hashtag Strategy (JSON)</label>
            <Textarea {...register("hashtagStrategy")} className="font-mono text-sm bg-background border-border min-h-[200px]" />
          </div>
        </div>
      </section>

      {/* Templates */}
      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6 border-b border-border pb-4">
          <LayoutTemplate className="text-primary" size={20} />
          <h2 className="text-xl font-bold">Templates</h2>
        </div>
        <BrandTemplates brandId={brand.id} />
      </section>

      <div className="flex justify-end pt-4 pb-8">
        <Button type="submit" disabled={updateBrandMutation.isPending} className="bg-primary hover:bg-primary/90 font-bold px-8 shadow-lg shadow-primary/25">
          <Save className="mr-2" size={18} /> 
          {updateBrandMutation.isPending ? "Saving..." : "Save Brand Changes"}
        </Button>
      </div>

    </form>
  );
}

function ColorField({ name, label, value, register, setValue }: any) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">{label}</label>
      <div className="flex gap-2 items-center">
        <div className="relative w-10 h-10 rounded shadow-inner border border-border overflow-hidden">
          <input 
            type="color" 
            value={value || "#000000"} 
            onChange={(e) => setValue(name, e.target.value, { shouldDirty: true })}
            className="absolute -inset-2 w-16 h-16 cursor-pointer"
          />
        </div>
        <Input {...register(name)} className="font-mono bg-background border-border" />
      </div>
    </div>
  );
}

function BrandTemplates({ brandId }: { brandId: string }) {
  const { data: templates } = useGetTemplates({ brandId });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createTemplateMutation = useCreateTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
        setIsAddOpen(false);
        toast({ title: "Template added" });
      }
    }
  });

  const deleteTemplateMutation = useDeleteTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
        toast({ title: "Template deleted" });
      }
    }
  });

  const { register, handleSubmit, reset } = useForm();

  const onAddTemplate = (data: any) => {
    try {
      const claudeInst = data.claudeCaptionInstruction ? JSON.parse(data.claudeCaptionInstruction) : {};
      const layoutSpc = data.layoutSpec ? JSON.parse(data.layoutSpec) : null;
      
      createTemplateMutation.mutate({
        data: {
          brandId,
          name: data.name,
          description: data.description,
          imagenPromptAddition: data.imagenPromptAddition || "",
          imagenNegativeAddition: data.imagenNegativeAddition || "",
          claudeCaptionInstruction: claudeInst,
          claudeHeadlineInstruction: data.claudeHeadlineInstruction,
          layoutSpec: layoutSpc,
          recommendedAssetTypes: data.recommendedAssetTypes ? data.recommendedAssetTypes.split(",").map((s:string) => s.trim()) : ["image"],
          targetAspectRatios: data.targetAspectRatios ? data.targetAspectRatios.split(",").map((s:string) => s.trim()) : ["1:1"]
        }
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "JSON Parse Error", description: "Ensure instructions and layout specs are valid JSON." });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Manage templates for content generation.</p>
        <Dialog open={isAddOpen} onOpenChange={(v) => { setIsAddOpen(v); if(!v) reset(); }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-2" /> Add Template</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Template</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onAddTemplate)} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input {...register("name", { required: true })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input {...register("description")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Imagen Prompt Additions</label>
                  <Textarea {...register("imagenPromptAddition")} rows={2} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Imagen Negative Additions</label>
                  <Textarea {...register("imagenNegativeAddition")} rows={2} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Claude Caption Instruction (JSON)</label>
                <Textarea {...register("claudeCaptionInstruction")} defaultValue="{}" className="font-mono text-sm" rows={4} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Layout Spec (JSON, optional)</label>
                <Textarea {...register("layoutSpec")} defaultValue="null" className="font-mono text-sm" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Recommended Asset Types (comma separated)</label>
                  <Input {...register("recommendedAssetTypes")} defaultValue="image, video" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Aspect Ratios (comma separated)</label>
                  <Input {...register("targetAspectRatios")} defaultValue="1:1, 16:9, 9:16" />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={createTemplateMutation.isPending}>Save Template</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates?.map(t => (
          <div key={t.id} className="p-4 border border-border bg-background rounded-lg flex flex-col justify-between group">
            <div>
              <h4 className="font-bold">{t.name}</h4>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description || "No description"}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {t.targetAspectRatios?.map(r => <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>)}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if(confirm("Delete template?")) {
                    deleteTemplateMutation.mutate({ id: t.id });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {templates?.length === 0 && <p className="text-sm text-muted-foreground italic col-span-2">No templates configured.</p>}
      </div>
    </div>
  );
}
