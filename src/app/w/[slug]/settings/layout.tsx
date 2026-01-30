"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Columns3, Tag, Users, Sparkles, Plug, Heart, BarChart3, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsProvider, useSettingsContext } from "./context";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

function NavItem({ href, icon, label, isActive }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function SettingsSidebar() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { workspace } = useSettingsContext();

  const baseSettingsPath = `/w/${params.slug}/settings`;
  const isMarketingWorkspace = workspace?.purpose === "marketing";

  return (
    <aside className="w-60 border-r border-border bg-sidebar flex flex-col">
      <div className="p-4 border-b border-border">
        <button
          onClick={() => router.push(`/w/${params.slug}`)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to app
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-6">
        {/* Workspace Section */}
        <div>
          <h3 className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspace
          </h3>
          <div className="space-y-1">
            <NavItem
              href={baseSettingsPath}
              icon={<Building2 className="w-4 h-4" />}
              label="General"
              isActive={pathname === baseSettingsPath}
            />
            <NavItem
              href={`${baseSettingsPath}/labels`}
              icon={<Tag className="w-4 h-4" />}
              label="Labels"
              isActive={pathname === `${baseSettingsPath}/labels`}
            />
            <NavItem
              href={`${baseSettingsPath}/columns`}
              icon={<Columns3 className="w-4 h-4" />}
              label="Columns"
              isActive={pathname === `${baseSettingsPath}/columns`}
            />
          </div>
        </div>

        {/* Administration Section */}
        <div>
          <h3 className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Administration
          </h3>
          <div className="space-y-1">
            <NavItem
              href={`${baseSettingsPath}/members`}
              icon={<Users className="w-4 h-4" />}
              label="Members"
              isActive={pathname === `${baseSettingsPath}/members`}
            />
            <NavItem
              href={`${baseSettingsPath}/skills`}
              icon={<Sparkles className="w-4 h-4" />}
              label="AI Skills"
              isActive={pathname === `${baseSettingsPath}/skills`}
            />
            <NavItem
              href={`${baseSettingsPath}/soul`}
              icon={<Heart className="w-4 h-4" />}
              label="Persona"
              isActive={pathname === `${baseSettingsPath}/soul`}
            />
            {isMarketingWorkspace && (
              <NavItem
                href={`${baseSettingsPath}/brand`}
                icon={<Palette className="w-4 h-4" />}
                label="Brand"
                isActive={pathname === `${baseSettingsPath}/brand`}
              />
            )}
            <NavItem
              href={`${baseSettingsPath}/integrations`}
              icon={<Plug className="w-4 h-4" />}
              label="Integrations"
              isActive={pathname === `${baseSettingsPath}/integrations`}
            />
            <NavItem
              href={`${baseSettingsPath}/usage`}
              icon={<BarChart3 className="w-4 h-4" />}
              label="Usage"
              isActive={pathname === `${baseSettingsPath}/usage`}
            />
          </div>
        </div>
      </nav>
    </aside>
  );
}

function SettingsLayoutContent({ children }: { children: React.ReactNode }) {
  const { isLoading, error } = useSettingsContext();

  if (isLoading) {
    return (
      <div className="h-screen bg-background flex overflow-hidden">
        <SettingsSidebar />
        <main className="flex-1 flex items-center justify-center overflow-auto">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-background flex overflow-hidden">
        <SettingsSidebar />
        <main className="flex-1 flex items-center justify-center overflow-auto">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground mb-2">
              Error
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <SettingsSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsProvider>
      <SettingsLayoutContent>{children}</SettingsLayoutContent>
    </SettingsProvider>
  );
}
