"use client"

import React from "react"
import { useWorkspace } from "@/contexts/workspace-context"
import { Database, AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export function MigrationPendingBanner() {
  const { isMigrationPending, refreshWorkspaces, isLoading } = useWorkspace()

  if (!isMigrationPending) {
    return null
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-100 p-2 text-amber-700 shrink-0 mt-0.5">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <Database className="h-4 w-4" /> Database Schema Setup Required
            </h4>
            <p className="text-xs text-amber-800 mt-1 max-w-2xl leading-relaxed">
              The multi-tenant database tables (<code>public.workspaces</code>, <code>public.workspace_members</code>, <code>public.locations</code>)
              have not been created yet in your Supabase project.
            </p>
            <p className="text-xs text-amber-800 mt-1.5">
              Please execute <code className="bg-amber-100/80 px-1 py-0.5 rounded text-[11px] font-mono">supabase/migrations/20261015000000_create_multi_tenant_schema.sql</code> in
              the <strong>Supabase Dashboard &gt; SQL Editor</strong> to initialize your database.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshWorkspaces()}
          disabled={isLoading}
          className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100 shrink-0 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Recheck Tables
        </Button>
      </div>
    </div>
  )
}
