import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ReadinessCheck {
  passed: boolean;
  label: string;
  count?: number;
}

interface BrandReadinessResult {
  ready: boolean;
  missing: string[];
  checks: Record<string, ReadinessCheck>;
}

export function useBrandReadiness(brandId: string | null | undefined) {
  return useQuery<BrandReadinessResult>({
    queryKey: ["brand-readiness", brandId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/brand-readiness/${brandId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch brand readiness");
      return res.json();
    },
    enabled: !!brandId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
