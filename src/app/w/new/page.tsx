"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Code,
  Megaphone,
  ArrowLeft,
  DollarSign,
  Sparkles,
  LucideIcon,
} from "lucide-react";
import { createWorkspace, createCustomWorkspace } from "@/lib/actions/workspace";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import {
  ConfigurationChat,
  type WorkspaceColumn,
  type WorkspaceLabel,
  type SuggestedIssue,
} from "./_components/ConfigurationChat";
import { ConfigurationPreview } from "./_components/ConfigurationPreview";

type Step = "purpose" | "name" | "configure";

const PURPOSE_UI: Record<
  WorkspacePurpose,
  {
    icon: LucideIcon;
    bgColor: string;
    textColor: string;
    label: string;
    description: string;
  }
> = {
  software: {
    icon: Code,
    bgColor: "bg-blue-500/10",
    textColor: "text-blue-500",
    label: "Software",
    description: "Track bugs, features, and technical tasks",
  },
  marketing: {
    icon: Megaphone,
    bgColor: "bg-orange-500/10",
    textColor: "text-orange-500",
    label: "Marketing",
    description: "Manage campaigns, content, and creative projects",
  },
  sales: {
    icon: DollarSign,
    bgColor: "bg-green-500/10",
    textColor: "text-green-500",
    label: "Sales",
    description: "Track leads, deals, and your sales pipeline",
  },
  custom: {
    icon: Sparkles,
    bgColor: "bg-violet-500/10",
    textColor: "text-violet-500",
    label: "Custom",
    description: "AI-powered workspace tailored to your needs",
  },
};

export default function NewWorkspacePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("purpose");
  const [purpose, setPurpose] = useState<WorkspacePurpose | null>(null);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<WorkspaceColumn[]>([]);
  const [labels, setLabels] = useState<WorkspaceLabel[]>([]);
  const [issues, setIssues] = useState<SuggestedIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePurposeSelect = (selected: WorkspacePurpose) => {
    setPurpose(selected);
    setStep("name");
  };

  const handleBack = () => {
    if (step === "name") {
      setStep("purpose");
    } else if (step === "configure") {
      setStep("name");
    }
    setError(null);
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (purpose === "custom") {
      setStep("configure");
    } else {
      handleCreateTemplateWorkspace();
    }
  };

  const handleCreateTemplateWorkspace = async () => {
    if (!name.trim() || !purpose || purpose === "custom") return;

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

  const handleCreateCustomWorkspace = async () => {
    if (!name.trim() || columns.length < 2) return;

    setIsLoading(true);
    setError(null);

    try {
      const columnsForApi = columns.map((col) => ({
        name: col.name,
        status: col.status,
      }));

      const issuesForApi = issues.map((issue) => ({
        title: issue.title,
        description: issue.description,
      }));

      const workspace = await createCustomWorkspace(
        name.trim(),
        columnsForApi,
        labels,
        issuesForApi
      );
      router.push(`/w/${workspace.slug}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workspace"
      );
      setIsLoading(false);
    }
  };

  const getStepDescription = () => {
    switch (step) {
      case "purpose":
        return "What type of workspace do you need?";
      case "name":
        return "Name your workspace";
      case "configure":
        return "Configure your workspace";
    }
  };

  // Custom workspace configuration step - full width chat interface
  if (step === "configure") {
    return (
      <div className="flex flex-col h-screen bg-background">
        {/* Header */}
        <header className="flex items-center gap-3 h-12 px-4 border-b border-border shrink-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-violet-500/20 rounded flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-violet-500" />
            </div>
            <span className="font-semibold text-sm">{name}</span>
          </div>
        </header>

        {/* Main content - Chat and Preview side by side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat panel */}
          <div className="w-1/2 border-r border-border">
            <ConfigurationChat
              columns={columns}
              labels={labels}
              issues={issues}
              onColumnsChange={setColumns}
              onLabelsChange={setLabels}
              onIssuesChange={setIssues}
            />
          </div>

          {/* Preview panel */}
          <div className="w-1/2">
            <ConfigurationPreview
              workspaceName={name}
              columns={columns}
              labels={labels}
              issues={issues}
              onColumnsChange={setColumns}
              onLabelsChange={setLabels}
              onIssuesChange={setIssues}
              onCreateWorkspace={handleCreateCustomWorkspace}
              isCreating={isLoading}
            />
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-md border border-destructive/20">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Purpose and Name steps - centered card UI
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{
        background:
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120, 119, 198, 0.15), transparent)",
      }}
    >
      <div className="w-full max-w-lg p-8">
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            Create Workspace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {getStepDescription()}
          </p>
        </div>

        {step === "purpose" && (
          <div className="grid grid-cols-2 gap-4">
            {(Object.keys(PURPOSE_UI) as WorkspacePurpose[]).map((key) => {
              const config = PURPOSE_UI[key];
              const {
                icon: Icon,
                bgColor,
                textColor,
                label,
                description: desc,
              } = config;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePurposeSelect(key)}
                  className="flex flex-col items-center gap-3 p-6 rounded-xl border border-border/40 bg-card/50 hover:border-border/80 hover:shadow-lg hover:shadow-black/20 transition-all cursor-pointer"
                >
                  <div
                    className={`w-12 h-12 rounded-lg ${bgColor} flex items-center justify-center`}
                  >
                    <Icon className={`w-6 h-6 ${textColor}`} />
                  </div>
                  <div className="text-center">
                    <div className="font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {step === "name" && (
          <form onSubmit={handleNameSubmit} className="space-y-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            {purpose && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 mb-4">
                {(() => {
                  const { icon: Icon, textColor, label } = PURPOSE_UI[purpose];
                  return (
                    <>
                      <Icon className={`w-4 h-4 ${textColor}`} />
                      <span className="text-sm text-muted-foreground">
                        {label}
                      </span>
                    </>
                  );
                })()}
              </div>
            )}

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
              {isLoading
                ? "Creating..."
                : purpose === "custom"
                  ? "Continue"
                  : "Create Workspace"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
