"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  ShieldCheck,
  MapPin,
  MessageSquare,
  Send,
  Compass,
  FileBarChart,
  Users,
  Settings,
  Building2,
  LogOut,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  X,
  HelpCircle,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { useTour } from "@/contexts/tour-context";
import { NexRepLogo } from "@/components/brand/logo";
import {
  getCurrentUserProfileAction,
  signOutAction,
  UserProfileInfo,
} from "@/app/dashboard/actions";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  id?: string;
}

export const navigationGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, id: "tour-nav-dashboard" },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3, id: "tour-nav-analytics" },
      { name: "Profile Audit", href: "/dashboard/audit", icon: ShieldCheck, id: "tour-nav-audit" },
      { name: "Locations", href: "/dashboard/locations", icon: MapPin, id: "tour-nav-locations" },
    ],
  },
  {
    title: "Reputation",
    items: [
      { name: "Reviews & AI Replies", href: "/dashboard/reviews", icon: MessageSquare, id: "tour-nav-reviews" },
      { name: "QR Review Studio", href: "/dashboard/qr", icon: QrCode, id: "tour-nav-qr" },
      { name: "Google Posts", href: "/dashboard/posts", icon: Send, id: "tour-nav-posts" },
      { name: "Local SEO & Keywords", href: "/dashboard/seo", icon: Compass, id: "tour-nav-seo" },
    ],
  },
  {
    title: "Reporting & Account",
    items: [
      { name: "Reports", href: "/dashboard/reports", icon: FileBarChart, id: "tour-nav-reports" },
      { name: "Team", href: "/dashboard/team", icon: Users, id: "tour-nav-team" },
      { name: "Settings", href: "/dashboard/settings", icon: Settings, id: "tour-nav-settings" },
    ],
  },
];

export function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocation } = useLocation();
  const { openHelpModal } = useTour();

  const [userProfile, setUserProfile] = useState<UserProfileInfo | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getCurrentUserProfileAction(activeWorkspaceId).then((res) => {
      if (isMounted && res.success && res.user) {
        setUserProfile(res.user);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOutAction();
    router.push("/login");
  };

  return (
    <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4 select-none">
      {/* Navigation Sections */}
      <div className="space-y-5">
        {navigationGroups.map((group) => (
          <div key={group.title}>
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-emerald-300/60 mb-1.5">
              {group.title}
            </p>
            <nav className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    id={item.id}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      isActive
                        ? "bg-emerald-600/30 text-white font-medium border border-emerald-400/25 shadow-xs"
                        : "text-emerald-100/75 hover:bg-emerald-800/30 hover:text-white font-normal",
                      "group flex items-center justify-between rounded-xl px-3 py-2 text-xs transition-all"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <item.icon
                        className={cn(
                          isActive ? "text-emerald-400" : "text-emerald-300/60 group-hover:text-emerald-200",
                          "h-4 w-4 shrink-0 transition-colors"
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.name}</span>
                    </div>
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}

        {/* Super Admin Access Link (Only for authorized platform admins) */}
        {userProfile?.isSuperAdmin && (
          <div>
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-emerald-300/60 mb-1.5">
              Platform Admin
            </p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className={cn(
                pathname.startsWith("/admin")
                  ? "bg-emerald-600/30 text-white font-medium border border-emerald-400/25"
                  : "text-emerald-100/75 hover:bg-emerald-800/30 hover:text-white font-normal",
                "group flex items-center justify-between rounded-xl px-3 py-2 text-xs transition-all"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldAlert className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="truncate">Super Admin Telemetry</span>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* BOTTOM SECTION: PERMANENT HELP & TOUR BUTTON + USER/BUSINESS PROFILE */}
      <div className="pt-3 mt-4 border-t border-emerald-800/40 space-y-2">
        {/* Permanent Help & Product Tour Entry */}
        <button
          id="tour-help-button"
          type="button"
          onClick={() => {
            if (onNavigate) onNavigate();
            openHelpModal("tour");
          }}
          className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-emerald-200/90 hover:text-white hover:bg-emerald-900/50 transition-all flex items-center justify-between group border border-transparent hover:border-emerald-800/40"
        >
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300 shrink-0 transition-colors" />
            <span>Help & Product Tour</span>
          </div>
          <span className="text-[10px] font-semibold text-emerald-300/80 bg-emerald-950/70 border border-emerald-500/20 px-1.5 py-0.2 rounded-md">
            Guides
          </span>
        </button>

        {/* User / Business Profile Card */}
        <button
          id="tour-bottom-profile"
          type="button"
          onClick={() => setProfileModalOpen(true)}
          className="w-full text-left p-2 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/30 transition-all flex items-center gap-2.5 group"
        >
          <Avatar className="h-8.5 w-8.5 shrink-0 rounded-lg ring-1 ring-emerald-500/30 group-hover:ring-emerald-400 transition-all">
            <AvatarFallback className="text-[11px] font-bold bg-emerald-800 text-white rounded-lg">
              {userProfile?.initials || "NR"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-semibold text-white truncate">
                {userProfile?.fullName || "Account"}
              </p>
              <Badge
                variant="outline"
                className="text-[9px] font-medium px-1.5 py-0 capitalize border-emerald-500/30 text-emerald-300 bg-emerald-950/60"
              >
                {userProfile?.role || "Member"}
              </Badge>
            </div>
            <p className="text-[10px] text-emerald-300/70 truncate flex items-center gap-1 mt-0.5">
              <Building2 className="w-2.5 h-2.5 shrink-0" />
              <span>{selectedLocation?.name || "Active Workspace"}</span>
            </p>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-emerald-400/60 group-hover:text-emerald-300 shrink-0 transition-colors" />
        </button>
      </div>

      {/* EXPANDABLE PROFILE & BUSINESS DRAWER MODAL */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-900 font-sans animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-[#0B2E22] text-white">
              <div className="flex items-center gap-2.5">
                <Avatar className="h-9 w-9 rounded-xl ring-1 ring-emerald-400/40">
                  <AvatarFallback className="text-xs font-bold bg-emerald-800 text-white rounded-xl">
                    {userProfile?.initials || "NR"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 id="profile-modal-title" className="text-xs font-bold text-white">
                    {userProfile?.fullName || "Authenticated User"}
                  </h3>
                  <p className="text-[11px] text-emerald-200/80 truncate">
                    {userProfile?.email || "user@example.com"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="text-emerald-300 hover:text-white p-1 rounded-lg hover:bg-emerald-800/40 transition-colors"
                aria-label="Close profile menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {/* Active Business Profile Card */}
              <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Active Business Profile
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold border-emerald-200 bg-emerald-50 text-emerald-700"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Connected
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 text-xs">
                    {selectedLocation?.name || "NexFlowOps Technologies Pvt. Ltd."}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {selectedLocation?.address || "301, ABC Landmark, Science City Road, Sola, Ahmedabad"}
                  </p>
                  {selectedLocation?.phone && (
                    <p className="text-[11px] text-slate-600 font-mono">{selectedLocation.phone}</p>
                  )}
                </div>
              </div>

              {/* Connected Google Account */}
              <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Google Business Integration
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-600">OAuth Connection:</span>
                  <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Active & Synced
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-600">Sync Engine:</span>
                  <span className="text-[11px] font-mono text-slate-800">Direct Reviews & Location API</span>
                </div>
              </div>

              {/* Quick Navigation Shortcuts */}
              <div className="space-y-1 pt-1">
                <Link
                  href="/dashboard/team"
                  onClick={() => setProfileModalOpen(false)}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-100/70 text-slate-700 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Users className="w-3.5 h-3.5 text-slate-500" /> Team & Role Permissions
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                </Link>

                <Link
                  href="/dashboard/settings"
                  onClick={() => setProfileModalOpen(false)}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-100/70 text-slate-700 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Settings className="w-3.5 h-3.5 text-slate-500" /> Security & Automation Settings
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                </Link>
              </div>

              {/* Sign Out Button */}
              <div className="pt-3 border-t border-slate-100">
                <Button
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  variant="outline"
                  className="w-full text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 h-9 gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {isSigningOut ? "Signing out..." : "Sign Out of NexRep"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-[#0A3022] text-white border-r border-[#124231] shrink-0 select-none">
      {/* Brand Header */}
      <div className="flex h-16 shrink-0 items-center justify-between px-5 border-b border-emerald-900/40">
        <Link href="/dashboard" className="flex items-center group">
          <NexRepLogo variant="dark" showTagline={true} />
        </Link>
      </div>

      {/* Navigation & Profile */}
      <SidebarNavigation />
    </aside>
  );
}
