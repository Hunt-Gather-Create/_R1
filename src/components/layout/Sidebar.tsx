"use client";

import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  List,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  Inbox,
  Clock,
  Circle,
  Layers,
  Check,
  Wand2,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW } from "@/lib/design-tokens";
import { useAppShell } from "./AppShell";
import { useOptionalWorkspaceContext } from "@/components/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
  href?: string;
  shortcut?: string;
}

function NavItem({
  icon,
  label,
  isActive,
  isCollapsed,
  onClick,
  href,
  shortcut,
}: NavItemProps) {
  const router = useRouter();

  const handleClick = () => {
    if (href) {
      router.push(href);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        "hover:bg-sidebar-accent",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70",
        isCollapsed && "justify-center px-2"
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left truncate">{label}</span>
          {shortcut && (
            <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
              {shortcut}
            </kbd>
          )}
        </>
      )}
    </button>
  );
}

interface NavSectionProps {
  title: string;
  isCollapsed: boolean;
  children: React.ReactNode;
}

function NavSection({ title, isCollapsed, children }: NavSectionProps) {
  return (
    <div className="mb-4">
      {!isCollapsed && (
        <h3 className="px-2 mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </h3>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function Sidebar() {
  const router = useRouter();
  const {
    sidebarCollapsed,
    toggleSidebar,
    currentView,
    setCurrentView,
    setCreateIssueOpen,
    setCommandPaletteOpen,
    setAIPlanningOpen,
  } = useAppShell();

  const workspaceContext = useOptionalWorkspaceContext();
  const workspace = workspaceContext?.workspace;
  const workspaces = workspaceContext?.workspaces ?? [];

  const handleWorkspaceChange = (slug: string) => {
    router.push(`/w/${slug}`);
  };

  const handleCreateWorkspace = () => {
    router.push("/w/new");
  };

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200",
        sidebarCollapsed ? "w-14" : "w-60"
      )}
    >
      {/* Logo/Workspace Header */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-sidebar-border">
        {!sidebarCollapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 hover:bg-sidebar-accent rounded-md px-1 py-0.5 transition-colors">
                <div className="w-5 h-5 bg-primary rounded flex items-center justify-center flex-shrink-0">
                  <Layers className="w-3 h-3 text-primary-foreground" />
                </div>
                <span className="font-semibold text-sm truncate max-w-[120px]">
                  {workspace?.name ?? "Workspace"}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => handleWorkspaceChange(ws.slug)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-4 h-4 bg-primary/20 rounded flex items-center justify-center flex-shrink-0">
                      <Layers className="w-2.5 h-2.5 text-primary" />
                    </div>
                    <span className="truncate">{ws.name}</span>
                  </div>
                  {workspace?.id === ws.id && (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCreateWorkspace}>
                <Plus className="w-4 h-4 mr-2" />
                Create Workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {sidebarCollapsed && (
          <div className="w-5 h-5 mx-auto bg-primary rounded flex items-center justify-center">
            <Layers className="w-3 h-3 text-primary-foreground" />
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            "p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground",
            sidebarCollapsed && "hidden"
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="p-2 space-y-1">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className={cn(
            "flex items-center w-full gap-2 px-2 py-1.5 rounded-md text-sm",
            "bg-sidebar-accent/50 hover:bg-sidebar-accent text-sidebar-foreground/70",
            sidebarCollapsed && "justify-center"
          )}
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left">Search...</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                ⌘K
              </kbd>
            </>
          )}
        </button>
        <button
          onClick={() => setCreateIssueOpen(true)}
          className={cn(
            "flex items-center w-full gap-2 px-2 py-1.5 rounded-md text-sm",
            "hover:bg-sidebar-accent text-sidebar-foreground/70",
            sidebarCollapsed && "justify-center"
          )}
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left">New Issue</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                C
              </kbd>
            </>
          )}
        </button>
        <button
          onClick={() => setAIPlanningOpen(true)}
          className={cn(
            "flex items-center w-full gap-2 px-2 py-1.5 rounded-md text-sm",
            "hover:bg-sidebar-accent text-sidebar-foreground/70",
            sidebarCollapsed && "justify-center"
          )}
        >
          <Wand2 className="w-4 h-4 flex-shrink-0" />
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left">AI Planning</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                P
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2">
        <NavSection title="Views" isCollapsed={sidebarCollapsed}>
          <NavItem
            icon={<Inbox className="w-4 h-4" />}
            label="Inbox"
            isCollapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<Circle className="w-4 h-4" />}
            label="My Issues"
            isCollapsed={sidebarCollapsed}
          />
        </NavSection>

        <NavSection title="Workspace" isCollapsed={sidebarCollapsed}>
          <NavItem
            icon={<LayoutGrid className="w-4 h-4" />}
            label="Board"
            isActive={currentView === VIEW.BOARD}
            isCollapsed={sidebarCollapsed}
            onClick={() => setCurrentView(VIEW.BOARD)}
            shortcut="G B"
          />
          <NavItem
            icon={<List className="w-4 h-4" />}
            label="List"
            isActive={currentView === VIEW.LIST}
            isCollapsed={sidebarCollapsed}
            onClick={() => setCurrentView(VIEW.LIST)}
            shortcut="G L"
          />
          <NavItem
            icon={<Clock className="w-4 h-4" />}
            label="Cycles"
            isCollapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<MessageSquare className="w-4 h-4" />}
            label="Chat"
            isCollapsed={sidebarCollapsed}
            href={workspace ? `/w/${workspace.slug}/chat` : undefined}
            shortcut="G A"
          />
        </NavSection>
      </nav>

      {/* Footer Actions */}
      <div className="p-2 border-t border-sidebar-border">
        <NavItem
          icon={<Settings className="w-4 h-4" />}
          label="Settings"
          isCollapsed={sidebarCollapsed}
          onClick={() =>
            workspace && router.push(`/w/${workspace.slug}/settings`)
          }
        />
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center w-full mt-2 p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
