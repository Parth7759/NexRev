"use client"

import React, { useState } from "react"
import { useWorkspace } from "@/contexts/workspace-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Building2, Sparkles, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"

export function WorkspaceOnboardingModal() {
  const { needsOnboarding, createWorkspace } = useWorkspace()
  const [workspaceName, setWorkspaceName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!needsOnboarding) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      setError("Please enter a workspace or business name.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const res = await createWorkspace(trimmed)
      if (!res.success) {
        setError(res.error || "Failed to create workspace. Please try again.")
        setIsSubmitting(false)
      } else {
        setSuccess(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred."
      setError(msg)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in-0 duration-200">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-2xl border border-slate-100 zoom-in-95 duration-200">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 mb-5 mx-auto">
          <Building2 className="w-6 h-6" />
        </div>

        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-slate-900">Welcome to NexRep</h3>
          <p className="text-sm text-slate-500 mt-1">
            Let&apos;s create your business workspace to manage reviews, locations, and Google Business Profile integrations.
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start">
            <AlertCircle className="w-4 h-4 mr-2 text-red-600 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
            <p className="font-semibold text-slate-900">Workspace Created!</p>
            <p className="text-xs text-slate-500 mt-1">Setting up your dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="onboarding-workspace-name" className="text-xs font-semibold text-slate-700">
                Business / Workspace Name
              </Label>
              <div className="mt-1.5">
                <Input
                  id="onboarding-workspace-name"
                  type="text"
                  placeholder="e.g. Acme Corp, Downtown Dental"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  disabled={isSubmitting}
                  autoFocus
                  required
                  className="text-sm"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                You will be assigned as the Workspace Owner with full administrator rights.
              </p>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !workspaceName.trim()}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-xs transition-all h-10"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Workspace...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Create Workspace & Continue
                </>
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
