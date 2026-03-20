import { Instagram, Twitter, Linkedin, Facebook, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const p = platform.toLowerCase();
  
  if (p.includes("instagram")) return <Instagram className={cn("text-[#E1306C]", className)} />;
  if (p.includes("twitter") || p.includes("x")) return <Twitter className={cn("text-[#1DA1F2]", className)} />;
  if (p.includes("linkedin")) return <Linkedin className={cn("text-[#0A66C2]", className)} />;
  if (p.includes("facebook")) return <Facebook className={cn("text-[#1877F2]", className)} />;
  if (p.includes("youtube")) return <Youtube className={cn("text-[#FF0000]", className)} />;
  
  return <div className={cn("w-5 h-5 bg-muted rounded-full", className)} />;
}
