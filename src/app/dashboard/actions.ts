'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { WorkspaceRole } from '@/types/database.types'
import { verifyWorkspaceMembership } from '@/lib/workspace'

export interface UserWorkspace {
  id: string
  name: string
  slug: string | null
  role: WorkspaceRole
  createdAt: string
}

export interface WorkspaceFetchResult {
  workspaces: UserWorkspace[]
  activeWorkspaceId: string | null
  isMigrationPending: boolean
  error?: string
}

const ACTIVE_WORKSPACE_COOKIE = 'nexrep_active_workspace_id'

/**
 * Checks if a Supabase error indicates that the tables have not been created yet.
 */
function isTableMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    Boolean(error.message?.includes('schema cache')) ||
    Boolean(error.message?.includes('does not exist'))
  )
}

/**
 * Fetches all workspaces for the currently authenticated user.
 */
export async function getWorkspacesAction(): Promise<WorkspaceFetchResult> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        workspaces: [],
        activeWorkspaceId: null,
        isMigrationPending: false,
        error: 'Not authenticated',
      }
    }

    // Query workspace_members joined with workspaces
    const { data, error } = await supabase
      .from('workspace_members')
      .select(`
        role,
        workspaces (
          id,
          name,
          slug,
          created_at
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) {
      if (isTableMissingError(error)) {
        return {
          workspaces: [],
          activeWorkspaceId: null,
          isMigrationPending: true,
          error: 'Multi-tenant database tables are not yet created in Supabase.',
        }
      }
      return {
        workspaces: [],
        activeWorkspaceId: null,
        isMigrationPending: false,
        error: error.message,
      }
    }

    interface JoinedMemberRow {
      role: WorkspaceRole
      workspaces: {
        id: string
        name: string
        slug: string | null
        created_at: string
      } | null
    }

    const rows = (data as unknown as JoinedMemberRow[]) || []
    const workspaces: UserWorkspace[] = rows
      .filter((r) => r.workspaces !== null)
      .map((r) => ({
        id: r.workspaces!.id,
        name: r.workspaces!.name,
        slug: r.workspaces!.slug,
        role: r.role,
        createdAt: r.workspaces!.created_at,
      }))

    // If authenticated user belongs to zero workspaces, auto-provision their initial workspace
    if (workspaces.length === 0) {
      const userName =
        (user.user_metadata?.full_name as string) ||
        user.email?.split('@')[0] ||
        'My Business'
      const defaultWsName = `${userName}'s Workspace`
      const slug = defaultWsName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')

      const { data: newWs } = await supabase
        .from('workspaces')
        .insert({
          name: defaultWsName,
          slug,
          created_by: user.id,
        })
        .select('id, name, slug, created_at')
        .single()

      if (newWs) {
        const { error: memberError } = await supabase
          .from('workspace_members')
          .insert({
            workspace_id: newWs.id,
            user_id: user.id,
            role: 'owner',
          })

        if (!memberError) {
          workspaces.push({
            id: newWs.id,
            name: newWs.name,
            slug: newWs.slug,
            role: 'owner',
            createdAt: newWs.created_at,
          })
        }
      }
    }

    // Determine active workspace from cookie or default to first workspace
    const cookieStore = await cookies()
    const cookieActiveId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value

    let activeWorkspaceId: string | null = null
    if (cookieActiveId && workspaces.some((w) => w.id === cookieActiveId)) {
      activeWorkspaceId = cookieActiveId
    } else if (workspaces.length > 0) {
      activeWorkspaceId = workspaces[0].id
      cookieStore.set(ACTIVE_WORKSPACE_COOKIE, activeWorkspaceId, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365, // 1 year
      })
    }

    return {
      workspaces,
      activeWorkspaceId,
      isMigrationPending: false,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error fetching workspaces'
    return {
      workspaces: [],
      activeWorkspaceId: null,
      isMigrationPending: false,
      error: msg,
    }
  }
}

/**
 * Creates a new workspace and assigns the authenticated user as the owner.
 * Safe against duplicate submissions and unauthorized assignment.
 */
export async function createWorkspaceAction(input: {
  name: string
}): Promise<{ success: boolean; workspace?: UserWorkspace; error?: string }> {
  try {
    const trimmedName = (input.name || '').trim()

    if (!trimmedName || trimmedName.length < 2) {
      return { success: false, error: 'Workspace name must be at least 2 characters.' }
    }
    if (trimmedName.length > 100) {
      return { success: false, error: 'Workspace name cannot exceed 100 characters.' }
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'You must be signed in to create a workspace.' }
    }

    // Generate URL-friendly slug
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    // Check for duplicate workspace with same name recently created by this user
    const { data: existingWorkspace } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('created_by', user.id)
      .eq('name', trimmedName)
      .limit(1)
      .maybeSingle()

    if (existingWorkspace) {
      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from('workspace_members')
        .select('id, role')
        .eq('workspace_id', existingWorkspace.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingMember) {
        // Workspace already exists for this user, activate it and return
        const cookieStore = await cookies()
        cookieStore.set(ACTIVE_WORKSPACE_COOKIE, existingWorkspace.id, {
          path: '/',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365,
        })
        revalidatePath('/dashboard', 'layout')
        return {
          success: true,
          workspace: {
            id: existingWorkspace.id,
            name: existingWorkspace.name,
            slug,
            role: (existingMember.role as WorkspaceRole) || 'owner',
            createdAt: new Date().toISOString(),
          },
        }
      }
    }

    // 1. Insert Workspace
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .insert({
        name: trimmedName,
        slug: slug || null,
        created_by: user.id,
      })
      .select('id, name, slug, created_at')
      .single()

    if (wsError || !workspace) {
      if (isTableMissingError(wsError)) {
        return {
          success: false,
          error:
            'Database migration required: The workspaces table does not exist in Supabase. Please apply supabase/migrations/20261015000000_create_multi_tenant_schema.sql first.',
        }
      }
      return { success: false, error: wsError?.message || 'Failed to create workspace.' }
    }

    // 2. Insert Workspace Member as Owner
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'owner',
      })

    if (memberError) {
      // Attempt rollback of created workspace if membership fails
      await supabase.from('workspaces').delete().eq('id', workspace.id)
      return {
        success: false,
        error: `Failed to assign workspace ownership: ${memberError.message}`,
      }
    }

    // 3. Set cookie for active workspace
    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    })

    revalidatePath('/dashboard', 'layout')

    return {
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: 'owner',
        createdAt: workspace.created_at,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create workspace.'
    return { success: false, error: msg }
  }
}

/**
 * Sets the active workspace for the authenticated user after verifying membership.
 */
export async function setActiveWorkspaceAction(
  workspaceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const authCheck = await verifyWorkspaceMembership(supabase, workspaceId)

    if (!authCheck.isMember) {
      return { success: false, error: authCheck.error || 'Unauthorized workspace selection.' }
    }

    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    })

    revalidatePath('/dashboard', 'layout')
    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to switch workspace.'
    return { success: false, error: msg }
  }
}
