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
  selectedLocationId: string | null
  setSelectedLocationId: (id: string | null) => void
  selectedLocation: BusinessLocation | null
  isLoadingLocations: boolean
  refreshLocations: () => Promise<void>
  hideZeroReviews: boolean
  setHideZeroReviews: (val: boolean | ((prev: boolean) => boolean)) => void
}

const LocationContext = createContext<LocationContextType | undefined>(undefined)

const HIDE_ZERO_STORAGE_KEY = "nexrep_hide_zero_reviews"

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const [locations, setLocations] = useState<BusinessLocation[]>([])
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(null)
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
      setSelectedLocationIdState(null)
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
        .eq("is_connected", true)
        .order("name", { ascending: true })

      if (error || !data || data.length === 0) {
        if (error) {
          console.error("Error fetching locations:", error.message)
        }
        setLocations([])
        setSelectedLocationIdState(null)
      } else if (data.length > 1) {
        // Multiple locations are marked connected (unselected or ambiguous state).
        // Requirement 1 & 3: Fail closed. Do NOT pick a default profile. Require explicit user selection.
        console.warn(
          `[LocationContext] Workspace ${wsId} has ${data.length} connected locations. Requiring explicit profile selection.`
        )
        setLocations([])
        setSelectedLocationIdState(null)
      } else {
        // Exactly ONE business profile is explicitly selected and connected for this workspace
        const singleLoc: BusinessLocation = {
          id: data[0].id,
          name: data[0].name,
          address: data[0].address,
          phone: data[0].phone,
          google_place_id: data[0].google_place_id,
          google_location_id: data[0].google_location_id,
          is_connected: Boolean(data[0].is_connected),
        }

        setLocations([singleLoc])
        setSelectedLocationIdState(singleLoc.id)
      }
    } catch (err) {
      console.error("Failed to refresh locations:", err)
      setLocations([])
      setSelectedLocationIdState(null)
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
          setSelectedLocationIdState(null)
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
          .eq("is_connected", true)
          .order("name", { ascending: true })

        if (!isMounted) return

        if (error || !data || data.length === 0) {
          if (error) {
            console.error("Error fetching locations:", error.message)
          }
          setLocations([])
          setSelectedLocationIdState(null)
        } else if (data.length > 1) {
          // Multiple locations connected: require explicit selection. No automatic choice.
          console.warn(
            `[LocationContext] Workspace ${activeWorkspaceId} has ${data.length} connected locations. Requiring explicit selection.`
          )
          setLocations([])
          setSelectedLocationIdState(null)
        } else {
          // Exactly ONE explicitly selected profile
          const singleLoc: BusinessLocation = {
            id: data[0].id,
            name: data[0].name,
            address: data[0].address,
            phone: data[0].phone,
            google_place_id: data[0].google_place_id,
            google_location_id: data[0].google_location_id,
            is_connected: Boolean(data[0].is_connected),
          }

          setLocations([singleLoc])
          setSelectedLocationIdState(singleLoc.id)
        }
      } catch (err) {
        if (!isMounted) return
        console.error("Failed to load locations:", err)
        setLocations([])
        setSelectedLocationIdState(null)
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
    (id: string | null) => {
      if (!id || id === "all") {
        setSelectedLocationIdState(null)
        return
      }
      if (locations.some((l) => l.id === id)) {
        setSelectedLocationIdState(id)
      } else {
        setSelectedLocationIdState(null)
      }
    },
    [locations]
  )

  const selectedLocation = useMemo(() => {
    if (!selectedLocationId) return null
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
