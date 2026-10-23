"use client"

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/utils/supabase/client"
import { useWorkspace } from "./workspace-context"

export interface BusinessLocation {
  id: string
  name: string
  address: string | null
  phone?: string | null
  google_place_id?: string | null
  google_location_id?: string | null
  is_connected: boolean
}

interface LocationContextType {
  locations: BusinessLocation[]
  selectedLocationId: string
  setSelectedLocationId: (id: string) => void
  selectedLocation: BusinessLocation | null
  isLoadingLocations: boolean
  refreshLocations: () => Promise<void>
  hideZeroReviews: boolean
  setHideZeroReviews: (val: boolean | ((prev: boolean) => boolean)) => void
}

const LocationContext = createContext<LocationContextType | undefined>(undefined)

const STORAGE_KEY_PREFIX = "nexrep_selected_location_"
const HIDE_ZERO_STORAGE_KEY = "nexrep_hide_zero_reviews"

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const [locations, setLocations] = useState<BusinessLocation[]>([])
  const [selectedLocationId, setSelectedLocationIdState] = useState<string>("all")
  const [isLoadingLocations, setIsLoadingLocations] = useState<boolean>(true)

  // Initialize hideZeroReviews lazily from session storage without setState in effect
  const [hideZeroReviews, setHideZeroReviewsState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(HIDE_ZERO_STORAGE_KEY)
      return saved === "true"
    }
    return false
  })

  const setHideZeroReviews = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setHideZeroReviewsState((prev) => {
      const nextVal = typeof val === "function" ? val(prev) : val
      if (typeof window !== "undefined") {
        sessionStorage.setItem(HIDE_ZERO_STORAGE_KEY, String(nextVal))
      }
      return nextVal
    })
  }, [])

  const fetchLocations = useCallback(async (wsId: string | null) => {
    if (!wsId) {
      setLocations([])
      setSelectedLocationIdState("all")
      setIsLoadingLocations(false)
      return
    }

    try {
      setIsLoadingLocations(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, address, phone, google_place_id, google_location_id, is_connected")
        .eq("workspace_id", wsId)
        .order("name", { ascending: true })

      if (error) {
        console.error("Error fetching locations:", error.message)
        setLocations([])
      } else {
        const locs: BusinessLocation[] = (data || []).map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          phone: l.phone,
          google_place_id: l.google_place_id,
          google_location_id: l.google_location_id,
          is_connected: Boolean(l.is_connected),
        }))
        setLocations(locs)

        // Restore previously selected location from session storage if valid
        const storageKey = `${STORAGE_KEY_PREFIX}${wsId}`
        const savedId = typeof window !== "undefined" ? sessionStorage.getItem(storageKey) : null

        if (savedId && (savedId === "all" || locs.some((loc) => loc.id === savedId))) {
          setSelectedLocationIdState(savedId)
        } else if (locs.length === 1) {
          // If only 1 location exists, default to that location
          setSelectedLocationIdState(locs[0].id)
        } else {
          // Default to all
          setSelectedLocationIdState("all")
        }
      }
    } catch (err) {
      console.error("Failed to refresh locations:", err)
    } finally {
      setIsLoadingLocations(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadAsync = async () => {
      if (!activeWorkspaceId) {
        if (isMounted) {
          setLocations([])
          setSelectedLocationIdState("all")
          setIsLoadingLocations(false)
        }
        return
      }

      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from("locations")
          .select("id, name, address, phone, google_place_id, google_location_id, is_connected")
          .eq("workspace_id", activeWorkspaceId)
          .order("name", { ascending: true })

        if (!isMounted) return

        if (error) {
          console.error("Error fetching locations:", error.message)
          setLocations([])
        } else {
          const locs: BusinessLocation[] = (data || []).map((l) => ({
            id: l.id,
            name: l.name,
            address: l.address,
            phone: l.phone,
            google_place_id: l.google_place_id,
            google_location_id: l.google_location_id,
            is_connected: Boolean(l.is_connected),
          }))
          setLocations(locs)

          const storageKey = `${STORAGE_KEY_PREFIX}${activeWorkspaceId}`
          const savedId = typeof window !== "undefined" ? sessionStorage.getItem(storageKey) : null

          if (savedId && (savedId === "all" || locs.some((loc) => loc.id === savedId))) {
            setSelectedLocationIdState(savedId)
          } else if (locs.length === 1) {
            setSelectedLocationIdState(locs[0].id)
          } else {
            setSelectedLocationIdState("all")
          }
        }
      } catch (err) {
        if (!isMounted) return
        console.error("Failed to load locations:", err)
      } finally {
        if (isMounted) setIsLoadingLocations(false)
      }
    }

    Promise.resolve().then(loadAsync)

    return () => {
      isMounted = false
    }
  }, [activeWorkspaceId])

  const refreshLocations = useCallback(async () => {
    await fetchLocations(activeWorkspaceId)
  }, [fetchLocations, activeWorkspaceId])

  const setSelectedLocationId = useCallback(
    (id: string) => {
      setSelectedLocationIdState(id)
      if (typeof window !== "undefined" && activeWorkspaceId) {
        sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${activeWorkspaceId}`, id)
      }
    },
    [activeWorkspaceId]
  )

  const selectedLocation = useMemo(() => {
    if (selectedLocationId === "all") return null
    return locations.find((l) => l.id === selectedLocationId) || null
  }, [locations, selectedLocationId])

  return (
    <LocationContext.Provider
      value={{
        locations,
        selectedLocationId,
        setSelectedLocationId,
        selectedLocation,
        isLoadingLocations,
        refreshLocations,
        hideZeroReviews,
        setHideZeroReviews,
      }}
    >
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  const context = useContext(LocationContext)
  if (!context) {
    throw new Error("useLocation must be used within a LocationProvider")
  }
  return context
}
