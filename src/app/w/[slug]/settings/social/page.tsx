"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  Unplug,
  User,
  FileText,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useSettingsContext } from "../context";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import {
  getWorkspaceSocialAccounts,
  disconnectSocialAccount,
} from "@/lib/actions/social-accounts";
import type { SocialAccountPublic } from "@/lib/actions/social-accounts";
import {
  testGetProfile,
  testListPosts,
  testGetPost,
} from "@/lib/actions/social-test";
import {
  SUPPORTED_PLATFORMS,
  PLATFORM_CONFIG,
} from "@/lib/social/constants";
import type { SocialPlatform } from "@/lib/types";

interface TestResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export default function SocialSettingsPage() {
  const { workspace, brand } = useSettingsContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [accounts, setAccounts] = useState<SocialAccountPublic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [postIdInputs, setPostIdInputs] = useState<Record<string, string>>({});
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({});

  const loadAccounts = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const data = await getWorkspaceSocialAccounts(workspace.id);
      setAccounts(data);
    } catch {
      toast.error("Failed to load social accounts");
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.id]);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Detect OAuth return
  useEffect(() => {
    const oauthSuccess = searchParams.get("oauth_success");
    const oauthError = searchParams.get("oauth_error");

    if (oauthSuccess) {
      const config = PLATFORM_CONFIG[oauthSuccess];
      toast.success(`${config?.name ?? oauthSuccess} connected successfully`);
      loadAccounts();
      router.replace(pathname);
    } else if (oauthError) {
      toast.error(`OAuth error: ${oauthError}`);
      router.replace(pathname);
    }
  }, [searchParams, pathname, router, loadAccounts]);

  const getAccount = (platform: string) =>
    accounts.find((a) => a.platform === platform);

  const handleConnect = (platform: string) => {
    if (!workspace?.id) return;
    const params = new URLSearchParams({
      returnUrl: pathname,
      workspaceId: workspace.id,
    });
    window.location.href = `/api/oauth/${platform}?${params}`;
  };

  const handleDisconnect = async (platform: SocialPlatform) => {
    if (!workspace?.id) return;
    setDisconnecting((prev) => ({ ...prev, [platform]: true }));
    try {
      await disconnectSocialAccount(workspace.id, platform);
      toast.success(`${PLATFORM_CONFIG[platform]?.name} disconnected`);
      await loadAccounts();
      // Clear any test results for this platform
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[`${platform}-profile`];
        delete next[`${platform}-posts`];
        delete next[`${platform}-post`];
        return next;
      });
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const runTest = async (key: string, fn: () => Promise<TestResult>) => {
    setTestLoading((prev) => ({ ...prev, [key]: true }));
    setTestResults((prev) => ({ ...prev, [key]: null }));
    try {
      const result = await fn();
      setTestResults((prev) => ({ ...prev, [key]: result }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          durationMs: 0,
        },
      }));
    } finally {
      setTestLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="Social Platforms"
        subtitle="Connect accounts and test platform integrations"
      />

      <section className="container space-y-6 pb-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading accounts...
          </div>
        ) : (
          SUPPORTED_PLATFORMS.map((platform) => {
            const config = PLATFORM_CONFIG[platform];
            const account = getAccount(platform);
            const isConnected = account?.connectionStatus === "connected";

            return (
              <div
                key={platform}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                {/* Platform Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted font-semibold text-sm">
                      {config.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">{config.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {config.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-600">
                          <CheckCircle className="w-3 h-3" />
                          @{account.platformUsername}
                        </span>
                        <button
                          onClick={() => handleDisconnect(platform)}
                          disabled={disconnecting[platform]}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-50"
                        >
                          {disconnecting[platform] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Unplug className="w-3 h-3" />
                          )}
                          Disconnect
                        </button>
                      </>
                    ) : account?.connectionStatus === "expired" ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-500/10 text-yellow-600">
                          <XCircle className="w-3 h-3" />
                          Expired
                        </span>
                        <button
                          onClick={() => handleConnect(platform)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Reconnect
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {/* Test Actions — only when connected and ?test param is set */}
                {isConnected && workspace?.id && searchParams.has("test") && (
                  <div className="px-5 py-4 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Test API Methods
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {/* Test Profile */}
                      <button
                        onClick={() =>
                          runTest(`${platform}-profile`, () =>
                            testGetProfile(workspace.id, platform)
                          )
                        }
                        disabled={testLoading[`${platform}-profile`]}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {testLoading[`${platform}-profile`] ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <User className="w-3 h-3" />
                        )}
                        Test Profile
                      </button>

                      {/* List Posts */}
                      <button
                        onClick={() =>
                          runTest(`${platform}-posts`, () =>
                            testListPosts(workspace.id, platform, 5)
                          )
                        }
                        disabled={testLoading[`${platform}-posts`]}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {testLoading[`${platform}-posts`] ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <FileText className="w-3 h-3" />
                        )}
                        List Posts (5)
                      </button>

                      {/* Get Post */}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="Post ID"
                          value={postIdInputs[platform] ?? ""}
                          onChange={(e) =>
                            setPostIdInputs((prev) => ({
                              ...prev,
                              [platform]: e.target.value,
                            }))
                          }
                          className="h-7 px-2.5 text-xs rounded-md border border-border bg-background w-40 focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          onClick={() =>
                            runTest(`${platform}-post`, () =>
                              testGetPost(
                                workspace.id,
                                platform,
                                postIdInputs[platform] ?? ""
                              )
                            )
                          }
                          disabled={
                            testLoading[`${platform}-post`] ||
                            !postIdInputs[platform]?.trim()
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {testLoading[`${platform}-post`] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Search className="w-3 h-3" />
                          )}
                          Get Post
                        </button>
                      </div>
                    </div>

                    {/* Test Results */}
                    {["profile", "posts", "post"].map((method) => {
                      const key = `${platform}-${method}`;
                      const result = testResults[key];
                      if (!result) return null;

                      return (
                        <div
                          key={key}
                          className="rounded-md border border-border overflow-hidden"
                        >
                          <div
                            className={`flex items-center justify-between px-3 py-2 text-xs font-medium ${
                              result.success
                                ? "bg-green-500/10 text-green-700"
                                : "bg-red-500/10 text-red-700"
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              {result.success ? (
                                <CheckCircle className="w-3 h-3" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              {method} — {result.success ? "OK" : "FAILED"}
                            </span>
                            <span className="text-[10px] opacity-75">
                              {result.durationMs}ms
                            </span>
                          </div>
                          <pre className="px-3 py-2 text-[11px] leading-relaxed overflow-x-auto bg-muted/30 max-h-60 overflow-y-auto">
                            {result.success
                              ? JSON.stringify(result.data, null, 2)
                              : result.error}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </GradientPage>
  );
}
