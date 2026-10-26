"use client"

import React, { useState } from "react"
import { useWorkspace } from "@/contexts/workspace-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Building2,
  ChevronDown,
  Check,
  Plus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react"

export function WorkspaceSelector() {
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspace,
    createWorkspace,
    isLoading,
    isMigrationPending,
  } = useWorkspace()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Loading workspace...</span>
      </div>
    )
  }

  if (isMigrationPending) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
        <Building2 className="w-3.5 h-3.5 text-amber-600" />
        <span>Migration Required</span>
      </div>
    )
  }

  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsCreateOpen(true)}
        className="h-9 gap-1.5 border-dashed border-blue-300 text-blue-700 bg-blue-50/50 hover:bg-blue-50 text-xs font-medium"
      >
        <Plus className="w-3.5 h-3.5" />
        Create Workspace
      </Button>
    )
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newWorkspaceName.trim()
    if (!trimmed) {
      setCreateError("Workspace name is required")
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const res = await createWorkspace(trimmed)
      if (res.success) {
        setIsCreateOpen(false)
        setNewWorkspaceName("")
      } else {
        setCreateError(res.error || "Failed to create workspace")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating workspace"
      setCreateError(msg)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button
            type="button"
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-900 transition-all text-xs font-medium shadow-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
          >
            <div className="w-6 h-6 rounded bg-blue-600/10 text-blue-600 flex items-center justify-center shrink-0">
              <Building2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold max-w-[130px] truncate sm:max-w-[200px]">
              {activeWorkspace?.name || "Select Workspace"}
            </span>
            {activeWorkspace?.role && (
              <span className="capitalize text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-normal">
                {activeWorkspace.role}
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-0.5" />
          </button>
        } />

        <DropdownMenuContent align="start" className="w-64 p-1.5 bg-white shadow-lg border border-slate-200 rounded-xl">
          <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Your Workspaces
          </div>

          {workspaces.map((ws) => {
            const isSelected = ws.id === activeWorkspaceId
            return (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => setActiveWorkspace(ws.id)}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer text-xs ${
                  isSelected
                    ? "bg-blue-50 text-blue-900 font-medium"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? "text-blue-600" : "text-slate-400"}`} />
                  <span className="truncate">{ws.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="capitalize text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {ws.role}
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </div>
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator className="my-1 border-slate-100" />

          <DropdownMenuItem
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700 rounded-lg cursor-pointer font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Workspace Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-100 zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-sm text-slate-900">New Workspace</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3">
              {createError && (
                <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                  {createError}
                </div>
              )}

              <div>
                <Label htmlFor="modal-ws-name" className="text-xs font-medium text-slate-700">
                  Workspace Name
                </Label>
                <Input
                  id="modal-ws-name"
                  type="text"
                  placeholder="e.g. Acme Stores, North Branch"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  disabled={isCreating}
                  required
                  autoFocus
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                  className="w-1/2 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isCreating || !newWorkspaceName.trim()}
                  className="w-1/2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs"
                >
                  {isCreating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 mr-1" /> Create
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
