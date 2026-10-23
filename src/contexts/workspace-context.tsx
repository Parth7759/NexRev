"use client"

import React, { createContext, useContext, useEffect, useState, useCallback } from "react"
import {
  UserWorkspace,
  getWorkspacesAction,
  createWorkspaceAction,
  setActiveWorkspaceAction,
} from "@/app/dashboard/actions"

interface WorkspaceContextType {
  workspaces: UserWorkspace[]
  activeWorkspace: UserWorkspace | null
  activeWorkspaceId: string | null
  isLoading: boolean
  isMigrationPending: boolean
  needsOnboarding: boolean
  setActiveWorkspace: (id: string) => Promise<boolean>
  createWorkspace: (name: string) => Promise<{ success: boolean; error?: string; workspace?: UserWorkspace }>
  refreshWorkspaces: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<UserWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMigrationPending, setIsMigrationPending] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const refreshWorkspaces = useCallback(async () => {
    try {
      const result = await getWorkspacesAction()
      setWorkspaces(result.workspaces)
      setActiveWorkspaceIdState(result.activeWorkspaceId)
      setIsMigrationPending(result.isMigrationPending)
      setIsAuthenticated(result.error !== "Not authenticated")
    } catch (err) {
      console.error("Failed to fetch workspaces:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    getWorkspacesAction()
      .then((result) => {
        if (!isMounted) return
        setWorkspaces(result.workspaces)
        setActiveWorkspaceIdState(result.activeWorkspaceId)
        setIsMigrationPending(result.isMigrationPending)
        setIsAuthenticated(result.error !== "Not authenticated")
        setIsLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        console.error("Failed to fetch workspaces:", err)
        setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const setActiveWorkspace = async (id: string): Promise<boolean> => {
    try {
      const res = await setActiveWorkspaceAction(id)
      if (res.success) {
        setActiveWorkspaceIdState(id)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const createWorkspace = async (
    name: string
  ): Promise<{ success: boolean; error?: string; workspace?: UserWorkspace }> => {
    const res = await createWorkspaceAction({ name })
    if (res.success && res.workspace) {
      await refreshWorkspaces()
      setActiveWorkspaceIdState(res.workspace.id)
    }
    return res
  }

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ||
    (workspaces.length > 0 ? workspaces[0] : null)

  const needsOnboarding =
    !isLoading && !isMigrationPending && isAuthenticated && workspaces.length === 0

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        activeWorkspaceId: activeWorkspace?.id || null,
        isLoading,
        isMigrationPending,
        needsOnboarding,
        setActiveWorkspace,
        createWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider")
  }
  return context
}
