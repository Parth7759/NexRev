"use client"

import React from "react"
import Link from "next/link"
import { useLocation } from "@/contexts/location-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import {
  Building2,
  ChevronDown,
  Check,
  MapPin,
  ExternalLink,
} from "lucide-react"

interface LocationSelectorProps {
  counts?: { [locationId: string]: number }
  totalCount?: number
  className?: string
  showAllOption?: boolean
  showFilterToggle?: boolean
  truncateName?: boolean
}

export function LocationSelector({
  counts = {},
  totalCount,
  className = "w-[220px]",
  truncateName = true,
}: LocationSelectorProps) {
  const {
    locations,
    selectedLocation,
    isLoadingLocations,
  } = useLocation()

  if (isLoadingLocations) {
    return (
      <div className={`h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-xs text-slate-400 ${className}`}>
        <Building2 className="w-3.5 h-3.5 mr-2 animate-pulse text-slate-400" />
        <span>Loading business profile...</span>
      </div>
    )
  }

  // If no profile is explicitly selected for this workspace, guide user to select
  if (locations.length === 0 || !selectedLocation) {
    return (
      <Link href="/dashboard/locations?select_profile=1">
        <Button
          variant="outline"
          size="sm"
          className={`h-9 px-3 text-xs gap-1.5 border-dashed border-blue-300 text-blue-700 bg-blue-50/50 hover:bg-blue-100/60 font-medium ${className}`}
        >
          <Building2 className="w-3.5 h-3.5 text-blue-600" />
          <span>Select Business Profile</span>
        </Button>
      </Link>
    )
  }

  // Single explicitly selected and connected Google Business Profile
  const reviewCount =
    typeof totalCount === "number"
      ? totalCount
      : counts[selectedLocation.id] ?? 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`${
              truncateName
                ? "h-9 px-3"
                : "min-h-9 h-auto py-2 px-3"
            } rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-2xs flex items-center justify-between gap-2.5 text-xs font-medium text-slate-800 transition-colors focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 ${className}`}
          >
            <div className={`flex items-center gap-2 ${truncateName ? "truncate min-w-0" : "min-w-0"}`}>
              <Building2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span
                className={`font-semibold text-slate-800 ${
                  truncateName
                    ? "truncate"
                    : "break-words whitespace-normal text-left leading-snug"
                }`}
              >
                {selectedLocation.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 self-center">
              {typeof reviewCount === "number" && (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 py-0.5 rounded font-mono font-medium">
                  {reviewCount}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>
          </button>
        }
      />

      <DropdownMenuContent
        align="end"
        className={`${
          truncateName ? "w-64" : "w-80 sm:w-96 max-w-[90vw]"
        } p-2 bg-white shadow-xl border border-slate-200 rounded-2xl`}
      >
        <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Connected Business Profile
        </div>

        {/* The One Explicitly Selected Profile */}
        <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <div className={truncateName ? "truncate min-w-0" : "min-w-0"}>
                <div
                  className={`font-semibold text-slate-900 flex items-center gap-1.5 ${
                    truncateName ? "truncate" : "break-words whitespace-normal leading-snug"
                  }`}
                >
                  <span className={truncateName ? "truncate" : "break-words"}>{selectedLocation.name}</span>
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                </div>
                {selectedLocation.address ? (
                  <p
                    className={`text-[11px] text-slate-500 mt-1 flex items-start gap-1 ${
                      truncateName ? "truncate" : "break-words whitespace-normal leading-tight"
                    }`}
                  >
                    <MapPin className="w-3 h-3 shrink-0 text-slate-400 mt-0.5" />
                    <span>{selectedLocation.address}</span>
                  </p>
                ) : selectedLocation.google_place_id ? (
                  <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                    ID: {selectedLocation.google_place_id.slice(0, 16)}...
                  </p>
                ) : null}
              </div>
            </div>
            {typeof reviewCount === "number" && (
              <span className="text-[10px] bg-white text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                {reviewCount}
              </span>
            )}
          </div>
        </div>

        <DropdownMenuSeparator className="my-1.5 border-slate-100" />

        {/* Explicit Change Business Profile Action */}
        <Link href="/dashboard/locations?select_profile=1" className="block w-full">
          <DropdownMenuItem className="flex items-center justify-between px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 rounded-lg cursor-pointer">
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-emerald-700" />
              <span className="font-medium">Change Business Profile</span>
            </div>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </DropdownMenuItem>
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
