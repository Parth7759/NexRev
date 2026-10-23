"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Building2, Layers, Menu, Star } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceSelector } from "@/components/workspace/workspace-selector";
import { useLocation } from "@/contexts/location-context";
import { SidebarNavigation } from "./sidebar";

export function Header() {
  const { selectedLocation, selectedLocationId } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-xs sm:px-6 lg:px-8">
      {/* Left Section: Mobile Menu + Workspace & Active Business */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Mobile Hamburger Drawer */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-9 w-9 text-slate-600 hover:text-slate-900 -ml-1 mr-0.5"
                aria-label="Open mobile navigation menu"
              />
            }
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-slate-900 text-white border-r border-slate-800">
            <div className="flex h-16 shrink-0 items-center px-6 border-b border-slate-800">
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2"
              >
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Star className="text-white w-5 h-5" />
                </div>
                <span className="font-bold text-xl tracking-tight text-white">NexRep</span>
              </Link>
            </div>
            <SidebarNavigation onNavigate={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Workspace Selector */}
        <WorkspaceSelector />

        {/* Active Business Badge: Exact h-9 and rounded-lg to match WorkspaceSelector */}
        {selectedLocationId !== "all" && selectedLocation ? (
          <div className="hidden sm:flex h-9 items-center gap-1.5 px-3 rounded-lg bg-blue-50/80 border border-blue-200 text-xs font-medium text-blue-800 shadow-2xs">
            <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate max-w-[150px] md:max-w-[180px]">{selectedLocation.name}</span>
          </div>
        ) : (
          <div className="hidden sm:flex h-9 items-center gap-1.5 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600 shadow-2xs">
            <Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>All Businesses</span>
          </div>
        )}
      </div>

      {/* Right Section: Notifications & Profile Avatar */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-slate-500 hover:text-slate-700 hover:bg-slate-100/70"
          aria-label="View notifications"
        >
          <Bell className="h-4.5 w-4.5" />
        </Button>

        {/* Subtle Separator */}
        <div className="hidden sm:block h-6 w-px bg-slate-200" aria-hidden="true" />

        {/* Profile Avatar with matched height */}
        <Avatar className="h-9 w-9 cursor-pointer ring-1 ring-slate-200 transition-shadow hover:ring-slate-300">
          <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
          <AvatarFallback className="text-xs font-semibold bg-blue-50 text-blue-700">NR</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
