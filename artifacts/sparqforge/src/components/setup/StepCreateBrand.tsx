import React from "react";
import { useForm } from "react-hook-form";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface StepCreateBrandProps {
  onNext: () => void;
  setBrandId: (id: string) => void;
}

interface BrandFormValues {
  name: string;
  colorPrimary: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function StepCreateBrand({ onNext, setBrandId }: StepCreateBrandProps) {
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { isValid, isSubmitting, errors },
  } = useForm<BrandFormValues>({
    mode: "onChange",
    defaultValues: {
      name: "",
      colorPrimary: "#3b82f6",
    },
  });

  const nameValue = watch("name");
  const colorPrimary = watch("colorPrimary");
  const slug = toSlug(nameValue ?? "");

  const onSubmit = async (data: BrandFormValues) => {
    const { name, colorPrimary } = data;
    const computedSlug = toSlug(name);

    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: computedSlug,
          colorPrimary,
          colorSecondary: "#64748b",
          colorAccent: "#f59e0b",
          colorBackground: "#0f172a",
          voiceDescription: "",
          bannedTerms: [],
          trademarkRules: "",
          hashtagStrategy: "{}",
          imagenPrefix: "",
          negativePrompt: "blurry, low quality, watermark, text overlay",
          platformRules: "{}",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }

      const brand = await res.json();
      setBrandId(brand.id);
      toast({ title: "Brand created", description: `"${name}" is ready to go.` });
      onNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Failed to create brand",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <WizardStepShell
      title="Name your brand"
      description="This is the foundation for all your generated content"
      onNext={handleSubmit(onSubmit)}
      canNext={isValid && !isSubmitting}
      nextLabel={isSubmitting ? "Creating…" : "Create Brand"}
      showBack={false}
      showSkip={false}
    >
      <div className="space-y-6">
        {/* Brand name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="brand-name">
            Brand name
          </label>
          <Input
            id="brand-name"
            placeholder="e.g., Sparq Games"
            autoFocus
            {...register("name", { required: "Brand name is required" })}
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
          {slug && (
            <p className="text-xs text-muted-foreground">
              URL slug: <span className="font-mono">{slug}</span>
            </p>
          )}
        </div>

        {/* Primary color */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="brand-color-hex">
            Primary brand color
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick primary brand color"
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              {...register("colorPrimary")}
              onChange={(e) => {
                setValue("colorPrimary", e.target.value, { shouldValidate: true });
              }}
            />
            <Input
              id="brand-color-hex"
              className="font-mono flex-1"
              value={colorPrimary}
              onChange={(e) => {
                setValue("colorPrimary", e.target.value, { shouldValidate: true });
              }}
              maxLength={7}
              placeholder="#3b82f6"
            />
          </div>
        </div>
      </div>
    </WizardStepShell>
  );
}
