"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Code, Megaphone, ArrowLeft } from "lucide-react";
import { createWorkspace } from "@/lib/actions/workspace";
import { PURPOSE_CONFIG, type WorkspacePurpose } from "@/lib/design-tokens";

type Step = "purpose" | "name";

export default function NewWorkspacePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("purpose");
  const [purpose, setPurpose] = useState<WorkspacePurpose | null>(null);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePurposeSelect = (selected: WorkspacePurpose) => {
    setPurpose(selected);
    setStep("name");
  };

  const handleBack = () => {
    setStep("purpose");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !purpose) return;

    setIsLoading(true);
    setError(null);

    try {
      const workspace = await createWorkspace(name.trim(), purpose);
      router.push(`/w/${workspace.slug}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workspace"
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-lg p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4">
            <Layers className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Create Workspace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === "purpose"
              ? "What type of workspace do you need?"
              : "Name your workspace"}
          </p>
        </div>

        {step === "purpose" ? (
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => handlePurposeSelect("software")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border border-input bg-card hover:border-primary hover:bg-accent transition-colors cursor-pointer"
            >
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Code className="w-6 h-6 text-blue-500" />
              </div>
              <div className="text-center">
                <div className="font-medium text-foreground">
                  {PURPOSE_CONFIG.software.label}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {PURPOSE_CONFIG.software.description}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handlePurposeSelect("marketing")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border border-input bg-card hover:border-primary hover:bg-accent transition-colors cursor-pointer"
            >
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Megaphone className="w-6 h-6 text-orange-500" />
              </div>
              <div className="text-center">
                <div className="font-medium text-foreground">
                  {PURPOSE_CONFIG.marketing.label}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {PURPOSE_CONFIG.marketing.description}
                </div>
              </div>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 mb-4">
              {purpose === "software" ? (
                <Code className="w-4 h-4 text-blue-500" />
              ) : (
                <Megaphone className="w-4 h-4 text-orange-500" />
              )}
              <span className="text-sm text-muted-foreground">
                {purpose && PURPOSE_CONFIG[purpose].label}
              </span>
            </div>

            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Workspace Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                autoFocus
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Creating..." : "Create Workspace"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
