import { apiFetch } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBrandReadiness } from "@/hooks/useBrandReadiness";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Brand {
  id: string;
  [key: string]: unknown;
}

interface PaginatedBrandsResponse {
  data: Brand[];
  total: number;
  limit: number;
  offset: number;
}

interface StepStatus {
  complete: boolean;
}

export function useSetupWizard() {
  const [brandId, setBrandId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [skippedSteps, setSkippedSteps] = useState<Set<number>>(new Set());

  // Fetch brands (limit=1 to check existence and get first brand)
  const {
    data: brandsResponse,
    isLoading: brandsLoading,
  } = useQuery<PaginatedBrandsResponse>({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/api/brands?limit=1`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch brands");
      return res.json();
    },
  });

  const brands: Brand[] = brandsResponse?.data ?? [];

  // Use brand readiness based on current brandId
  const { data: readiness, isLoading: readinessLoading } =
    useBrandReadiness(brandId);

  const isLoading = brandsLoading || readinessLoading;

  // Compute step statuses for 8 steps (index-based)
  const stepStatuses: StepStatus[] = [
    // Step 0: Create Brand
    { complete: brands.length > 0 },
    // Step 1: Logo
    { complete: readiness?.checks?.logo?.passed ?? false },
    // Step 2: Font
    { complete: readiness?.checks?.fonts?.passed ?? false },
    // Step 3: Voice
    { complete: readiness?.checks?.voice?.passed ?? false },
    // Step 4: Platform Rules
    { complete: readiness?.checks?.platformRules?.passed ?? false },
    // Step 5: Template
    { complete: readiness?.checks?.templates?.passed ?? false },
    // Step 6: Asset
    { complete: readiness?.checks?.approvedAssets?.passed ?? false },
    // Step 7: Readiness
    { complete: readiness?.ready ?? false },
  ];

  const hasSelectedBrand = useRef(false);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (brandsLoading) return;
    if (hasSelectedBrand.current) return;
    hasSelectedBrand.current = true;

    if (brands.length > 0) {
      setBrandId((prev) => prev ?? brands[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandsLoading]);

  useEffect(() => {
    if (!brandId || readinessLoading) return;
    if (hasNavigated.current) return;
    hasNavigated.current = true;

    const firstIncompleteIndex = stepStatuses.findIndex((s) => !s.complete);
    if (firstIncompleteIndex === -1) {
      setCurrentStepIndex(7);
    } else {
      setCurrentStepIndex(firstIncompleteIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, readinessLoading]);

  // Navigation actions
  const next = () => {
    setCurrentStepIndex((prev) => Math.min(prev + 1, 7));
  };

  const back = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const skip = () => {
    setSkippedSteps((prev) => new Set(prev).add(currentStepIndex));
    next();
  };

  const goToStep = (n: number) => {
    setCurrentStepIndex(n);
  };

  return {
    currentStepIndex,
    stepStatuses,
    brandId,
    readiness,
    brands,
    isLoading,
    skippedSteps,
    next,
    back,
    skip,
    goToStep,
    setBrandId,
  };
}
