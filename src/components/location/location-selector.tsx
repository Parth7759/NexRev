"use client"

import React, { useMemo } from "react"
import { useLocation, BusinessLocation } from "@/contexts/location-context"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Building2, MapPin, Layers, AlertTriangle, Filter } from "lucide-react"

interface LocationSelectorProps {
  counts?: { [locationId: string]: number }
  totalCount?: number
  className?: string
  showAllOption?: boolean
  showFilterToggle?: boolean
}

export function LocationSelector({
  counts = {},
  totalCount,
  className = "w-[220px]",
  showAllOption = true,
  showFilterToggle = true,
}: LocationSelectorProps) {
  const {
    locations,
    selectedLocationId,
    setSelectedLocationId,
    isLoadingLocations,
    hideZeroReviews,
    setHideZeroReviews,
  } = useLocation()

  // Identify any locations sharing the same Google Place ID (e.g. Just Wow and JUST WOW)
  const sharedPlaceIds = useMemo(() => {
    const idCount: Record<string, number> = {}
    locations.forEach((loc) => {
      if (loc.google_place_id) {
        idCount[loc.google_place_id] = (idCount[loc.google_place_id] || 0) + 1
      }
    })
    return new Set(
      Object.entries(idCount)
        .filter(([, count]) => count > 1)
        .map(([placeId]) => placeId)
    )
  }, [locations])

  // Partition locations into active (reviews > 0) and zero-review (reviews === 0)
  const { activeLocations, zeroReviewLocations } = useMemo(() => {
    const active: BusinessLocation[] = []
    const zero: BusinessLocation[] = []

    locations.forEach((loc) => {
      const reviewCount = counts[loc.id] || 0
      if (reviewCount > 0) {
        active.push(loc)
      } else {
        zero.push(loc)
      }
    })

    // Sort active locations descending by review count
    active.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))

    // Sort zero-review locations alphabetically by name
    zero.sort((a, b) => a.name.localeCompare(b.name))

    return { activeLocations: active, zeroReviewLocations: zero }
  }, [locations, counts])

  // If hideZeroReviews is enabled, only show zero-review locations if one is currently selected
  const displayedZeroLocations = useMemo(() => {
    if (!hideZeroReviews) return zeroReviewLocations
    return zeroReviewLocations.filter((loc) => loc.id === selectedLocationId)
  }, [hideZeroReviews, zeroReviewLocations, selectedLocationId])

  if (isLoadingLocations) {
    return (
      <div className={`h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-xs text-slate-400 ${className}`}>
        <Building2 className="w-3.5 h-3.5 mr-2 animate-pulse text-slate-400" />
        <span>Loading businesses...</span>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div className={`h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-xs text-slate-500 ${className}`}>
        <Building2 className="w-3.5 h-3.5 mr-2 text-slate-400" />
        <span>No synced locations</span>
      </div>
    )
  }

  // Find currently selected location to check for shared Place ID flag on trigger
  const currentLocation = locations.find((l) => l.id === selectedLocationId)
  const isCurrentSharedPlaceId = Boolean(
    currentLocation?.google_place_id && sharedPlaceIds.has(currentLocation.google_place_id)
  )

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selectedLocationId}
        onValueChange={(val) => {
          if (val) setSelectedLocationId(val)
        }}
      >
        <SelectTrigger
          className={`bg-white border-slate-200 shadow-sm text-xs font-medium text-slate-800 ${className}`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {selectedLocationId === "all" ? (
              <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            ) : (
              <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            )}
            <SelectValue placeholder="Select Business Location" />
            {isCurrentSharedPlaceId && (
              <span
                className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1 py-0.2 rounded font-normal shrink-0"
                title="Shares Google Place ID with another listing"
              >
                Shared ID
              </span>
            )}
          </div>
        </SelectTrigger>

        <SelectContent className="text-xs min-w-[270px]">
          {showAllOption && (
            <SelectItem value="all" className="cursor-pointer font-medium py-1.5">
              <div className="flex items-center justify-between w-full gap-2">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  All Businesses
                </span>
                {typeof totalCount === "number" && (
                  <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono font-medium">
                    {totalCount}
                  </span>
                )}
              </div>
            </SelectItem>
          )}

          {/* Group 1: Locations with active reviews (ranked by review count) */}
          {activeLocations.length > 0 && (
            <SelectGroup>
              <SelectSeparator className="my-1" />
              <SelectLabel className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider px-2 py-1">
                Active Locations ({activeLocations.length})
              </SelectLabel>

              {activeLocations.map((loc) => {
                const count = counts[loc.id] || 0
                const isShared = loc.google_place_id && sharedPlaceIds.has(loc.google_place_id)

                return (
                  <SelectItem key={loc.id} value={loc.id} className="cursor-pointer py-1.5">
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate font-medium text-slate-800">{loc.name}</span>
                        {isShared && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 py-0 border-amber-300 text-amber-700 bg-amber-50 shrink-0 font-normal flex items-center gap-0.5"
                            title={`Shares Google Place ID (${loc.google_place_id})`}
                          >
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            Shared Place ID
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                        {count}
                      </span>
                    </div>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          )}

          {/* Group 2: Locations with zero reviews */}
          {displayedZeroLocations.length > 0 && (
            <SelectGroup>
              <SelectSeparator className="my-1" />
              <SelectLabel className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider px-2 py-1">
                Other Synced Profiles ({zeroReviewLocations.length})
              </SelectLabel>

              {displayedZeroLocations.map((loc) => {
                const isShared = loc.google_place_id && sharedPlaceIds.has(loc.google_place_id)

                return (
                  <SelectItem key={loc.id} value={loc.id} className="cursor-pointer py-1.5 opacity-90">
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate text-slate-600">{loc.name}</span>
                        {isShared && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 py-0 border-amber-300 text-amber-700 bg-amber-50 shrink-0 font-normal flex items-center gap-0.5"
                            title={`Shares Google Place ID (${loc.google_place_id})`}
                          >
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            Shared Place ID
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono shrink-0">
                        0
                      </span>
                    </div>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      {/* Optional Safe Filter Toggle: Hide / Show zero-review profiles */}
      {showFilterToggle && zeroReviewLocations.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHideZeroReviews((prev) => !prev)}
          title={
            hideZeroReviews
              ? "Showing active locations only. Click to show all profiles."
              : "Click to hide locations with 0 reviews."
          }
          className={`h-9 px-2 text-xs border shadow-sm transition-colors ${
            hideZeroReviews
              ? "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100/60"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Filter className="w-3 h-3 mr-1 text-slate-500" />
          <span>{hideZeroReviews ? "Active only" : "All (6)"}</span>
        </Button>
      )}
    </div>
  )
}
