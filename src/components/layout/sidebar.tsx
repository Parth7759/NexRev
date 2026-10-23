"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessageSquare, MapPin, Settings, Star, User, Users, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const navigation = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Reviews", href: "/dashboard/reviews", icon: MessageSquare },
  { name: "Locations", href: "/dashboard/locations", icon: MapPin },
  { name: "AI Reply Assistant", href: "/dashboard/ai", icon: Sparkles },
  { name: "Team", href: "/dashboard/team", icon: Users },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
      <nav className="flex-1 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white",
                "group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              )}
            >
              <item.icon
                className={cn(
                  isActive ? "text-blue-400" : "text-slate-500 group-hover:text-blue-400",
                  "mr-3 h-5 w-5 shrink-0 transition-colors"
                )}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="mt-10 border-t border-slate-800 pt-6">
        <Link
          href="/admin"
          onClick={onNavigate}
          className={cn(
            pathname.startsWith("/admin") ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white",
            "group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          )}
        >
          <User
            className={cn(
              pathname.startsWith("/admin") ? "text-blue-400" : "text-slate-500 group-hover:text-blue-400",
              "mr-3 h-5 w-5 shrink-0 transition-colors"
            )}
            aria-hidden="true"
          />
          Super Admin
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-slate-900 text-white border-r border-slate-800 shrink-0">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Star className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">NexRep</span>
        </Link>
      </div>
      <SidebarNavigation />
    </aside>
  );
}
