import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, Search, Filter, FolderPlus, MoreVertical, Image as ImageIcon, Video, FileText, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetAssets, useUploadFile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export default function AssetLibrary() {
  const { data: assets, isLoading } = useGetAssets();
  const uploadMutation = useUploadFile();
  const { toast } = useToast();
  
  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      uploadMutation.mutate({ data: { file, type: 'visual' } }, {
        onSuccess: () => {
          toast({ title: "Asset uploaded successfully", description: file.name });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Upload failed", description: err.message });
        }
      });
    });
  }, [uploadMutation, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 max-w-[1600px] mx-auto w-full">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Asset Library</h1>
          <p className="text-muted-foreground mt-1">Manage brand visuals, context briefs, and hashtag sets.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 font-bold">
          <UploadCloud className="mr-2 h-4 w-4" /> Upload New
        </Button>
      </div>

      <Tabs defaultValue="visuals" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="bg-card border border-border w-fit mb-6">
          <TabsTrigger value="visuals" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-6">
            <ImageIcon size={16} className="mr-2" /> Visual Assets
          </TabsTrigger>
          <TabsTrigger value="briefs" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-6">
            <FileText size={16} className="mr-2" /> Briefs & Context
          </TabsTrigger>
          <TabsTrigger value="hashtags" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-6">
            <Hash size={16} className="mr-2" /> Hashtag Library
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-4 mb-6 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input placeholder="Search assets..." className="pl-10 bg-card border-border" />
          </div>
          <Button variant="outline" className="bg-card border-border text-muted-foreground">
            <Filter className="mr-2 h-4 w-4" /> Filter
          </Button>
          <Button variant="outline" className="bg-card border-border text-muted-foreground">
            <FolderPlus className="mr-2 h-4 w-4" /> New Folder
          </Button>
        </div>

        <TabsContent value="visuals" className="flex-1 overflow-y-auto mt-0 border-none p-0 outline-none">
          
          {/* Upload Dropzone */}
          <div 
            {...getRootProps()} 
            className={`mb-8 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-card/30 hover:border-primary/50 hover:bg-card/50'
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto w-12 h-12 bg-background rounded-full flex items-center justify-center mb-4 border border-border shadow-sm">
              <UploadCloud className="text-primary" size={24} />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">Drag & drop files here</h3>
            <p className="text-sm text-muted-foreground">Supports JPG, PNG, MP4, up to 50MB</p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-10">
            {isLoading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square bg-card rounded-xl border border-border animate-pulse" />
              ))
            ) : assets && assets.length > 0 ? (
              assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset as any} />
              ))
            ) : (
              // Placeholder mock data if empty
              Array.from({ length: 8 }).map((_, i) => (
                <AssetCard key={i} asset={{
                  id: `mock-${i}`,
                  name: `Brand_Asset_v${i+1}.png`,
                  status: i % 3 === 0 ? 'approved' : 'uploaded',
                  type: i % 4 === 0 ? 'video' : 'image',
                  createdAt: new Date().toISOString()
                } as any} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="briefs" className="flex-1 overflow-y-auto mt-0">
          <div className="flex flex-col items-center justify-center h-64 text-center border border-border border-dashed rounded-xl bg-card/30">
            <FileText size={48} className="text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-bold text-foreground mb-2">No briefs yet</h3>
            <p className="text-muted-foreground mb-4">Create context documents to guide AI generation.</p>
            <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-white">Create Brief</Button>
          </div>
        </TabsContent>

        <TabsContent value="hashtags" className="flex-1 overflow-y-auto mt-0">
           <div className="flex flex-col items-center justify-center h-64 text-center border border-border border-dashed rounded-xl bg-card/30">
            <Hash size={48} className="text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-bold text-foreground mb-2">Hashtag library empty</h3>
            <p className="text-muted-foreground mb-4">Organize your hashtags by campaign and platform.</p>
            <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-white">Create Set</Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssetCard({ asset }: { asset: any }) {
  return (
    <div className="group relative bg-card border border-border rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:border-primary/50 transition-all duration-300">
      <div className="aspect-square bg-muted/30 relative overflow-hidden">
        {/* landing page hero scenic mountain landscape */}
        <img 
          src={asset.thumbnailUrl || `https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=400&fit=crop`} 
          alt={asset.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-80 group-hover:opacity-100"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          {asset.status === 'approved' && <Badge className="bg-success text-white border-none shadow-sm">Approved</Badge>}
          {asset.status === 'uploaded' && <Badge className="bg-warning text-black border-none shadow-sm">Pending</Badge>}
        </div>
        <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur text-foreground rounded px-1.5 py-0.5 text-xs font-mono shadow-sm flex items-center gap-1">
          {asset.type === 'video' ? <Video size={10} /> : <ImageIcon size={10} />}
          {asset.type === 'video' ? 'MP4' : 'PNG'}
        </div>
      </div>
      <div className="p-3">
        <h4 className="text-sm font-semibold text-foreground truncate" title={asset.name}>{asset.name}</h4>
        <p className="text-xs text-muted-foreground mt-1 flex justify-between items-center">
          <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
            <MoreVertical size={14} />
          </Button>
        </p>
      </div>
    </div>
  );
}
