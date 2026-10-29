"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Bell,
  Building2,
  Menu,
  Users,
  Check,
  CheckCheck,
  Sparkles,
  MessageSquare,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceSelector } from "@/components/workspace/workspace-selector";
import { useLocation } from "@/contexts/location-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { SidebarNavigation } from "./sidebar";
import { NexRepLogo } from "@/components/brand/logo";
import {
  getDashboardNotificationsAction,
  DashboardNotificationItem,
} from "@/app/dashboard/actions";

export function Header() {
  const { selectedLocation } = useLocation();
  const { activeWorkspaceId } = useWorkspace();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Notification Dropdown state
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotificationItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Load Notifications & handle localStorage read status persistence
  useEffect(() => {
    let isMounted = true;

    // Load persisted read notifications for this workspace asynchronously
    const timer = setTimeout(() => {
      if (!isMounted) return;
      if (activeWorkspaceId) {
        try {
          const stored = localStorage.getItem(`nexrep_read_notifications_${activeWorkspaceId}`);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              setReadIds(parsed);
              return;
            }
          }
        } catch {
          // ignore localStorage error
        }
      }
      setReadIds([]);
    }, 0);

    getDashboardNotificationsAction(activeWorkspaceId).then((res) => {
      if (isMounted && res.success) {
        setNotifications(res.notifications);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [activeWorkspaceId]);

  // Close notifications on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !readIds.includes(n.id)).length;

  const handleMarkAllRead = () => {
    const allIds = notifications.map((n) => n.id);
    setReadIds(allIds);
    if (activeWorkspaceId) {
      try {
        localStorage.setItem(`nexrep_read_notifications_${activeWorkspaceId}`, JSON.stringify(allIds));
      } catch {
        // Ignore localStorage write errors
      }
    }
  };

  const handleMarkOneRead = (id: string) => {
    setReadIds((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      if (activeWorkspaceId) {
        try {
          localStorage.setItem(`nexrep_read_notifications_${activeWorkspaceId}`, JSON.stringify(next));
        } catch {
          // Ignore localStorage write errors
        }
      }
      return next;
    });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center justify-between border-b border-emerald-950/10 bg-white/95 backdrop-blur-md px-4 shadow-[0_1px_3px_0_rgba(16,78,56,0.03)] sm:px-6 lg:px-8 font-sans select-none">
      {/* Left Section: Mobile Menu + Workspace & Active Business */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Mobile Hamburger Drawer */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-9 w-9 text-slate-700 hover:text-slate-900 -ml-1 mr-0.5 rounded-lg"
                aria-label="Open mobile navigation menu"
              />
            }
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 p-0 bg-[#0A3022] text-white border-r border-[#124231]"
          >
            <div className="flex h-16 shrink-0 items-center px-5 border-b border-emerald-900/40">
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center group"
              >
                <NexRepLogo variant="dark" showTagline={true} />
              </Link>
            </div>
            <SidebarNavigation onNavigate={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Workspace Selector */}
        <WorkspaceSelector />

        {/* Active Business Badge */}
        {selectedLocation ? (
          <Link
            id="tour-location-selector"
            href="/dashboard/locations"
            className="hidden sm:flex h-9 items-center gap-2 px-3 rounded-xl bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200/80 text-xs font-medium text-emerald-900 shadow-2xs transition-all group"
            title="Active Google Business Profile - Click to manage"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <Building2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span className="truncate max-w-[160px] md:max-w-[220px] font-bold text-emerald-950">
              {selectedLocation.name}
            </span>
          </Link>
        ) : (
          <Link
            id="tour-location-selector"
            href="/dashboard/locations?select_profile=1"
            className="hidden sm:flex h-9 items-center gap-2 px-3 rounded-xl bg-amber-50/80 hover:bg-amber-100/80 border border-amber-200 text-xs font-semibold text-amber-900 shadow-2xs transition-all"
            title="Select a Google Business Profile"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Select Profile</span>
          </Link>
        )}
      </div>

      {/* Right Section: Notifications Only (Profile dropdown moved to bottom sidebar) */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="relative" ref={notificationsRef}>
          <Button
            id="tour-notifications"
            variant="ghost"
            size="icon"
            onClick={() => setNotificationsOpen((prev) => !prev)}
            className="h-9 w-9 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl relative transition-all"
            aria-label="View notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white shadow-2xs">
                {unreadCount}
              </span>
            )}
          </Button>

          {/* Notifications Popover */}
          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white shadow-2xl border border-slate-200/90 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  <h4 className="font-semibold text-xs text-slate-900">Notifications</h4>
                  {unreadCount > 0 && (
                    <Badge className="bg-emerald-600 text-white text-[9px] px-1.5 py-0 font-medium">
                      {unreadCount} new
                    </Badge>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium"
                  >
                    <CheckCheck className="w-3 h-3 text-slate-500" /> Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 space-y-1">
                    <Check className="w-6 h-6 mx-auto text-emerald-500" />
                    <p className="text-xs font-medium text-slate-600">All caught up!</p>
                    <p className="text-[10px] text-slate-400">No unread alerts or pending items.</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const isRead = readIds.includes(n.id);
                    return (
                      <Link
                        key={n.id}
                        href={n.link}
                        onClick={() => {
                          handleMarkOneRead(n.id);
                          setNotificationsOpen(false);
                        }}
                        className={`block px-4 py-3 hover:bg-slate-50 transition-colors ${
                          !isRead
                            ? n.type === "negative_alert"
                              ? "bg-red-50/40 border-l-2 border-red-500"
                              : "bg-emerald-50/30"
                            : "bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 shrink-0">
                            {n.type === "negative_alert" ? (
                              <ShieldAlert className="w-4 h-4 text-red-600" />
                            ) : n.type === "review" ? (
                              <MessageSquare className="w-4 h-4 text-amber-500" />
                            ) : n.type === "draft" ? (
                              <Sparkles className="w-4 h-4 text-emerald-600" />
                            ) : n.type === "team" ? (
                              <Users className="w-4 h-4 text-purple-600" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-slate-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p
                                  className={`text-xs truncate ${
                                    !isRead
                                      ? n.type === "negative_alert"
                                        ? "font-semibold text-red-950"
                                        : "font-semibold text-slate-900"
                                      : "text-slate-700"
                                  }`}
                                >
                                  {n.title}
                                </p>
                                {n.type === "negative_alert" && !isRead && (
                                  <span className="text-[9px] font-semibold text-red-700 bg-red-100/80 px-1 py-0.2 rounded shrink-0">
                                    Urgent
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0 font-mono">{n.timestamp}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
                              {n.message}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
