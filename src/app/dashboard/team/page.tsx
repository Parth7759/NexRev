"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UserPlus,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building2,
  X,
  Shield,
  UserCheck,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  getTeamMembersAction,
  inviteTeamMemberAction,
  updateMemberRoleAction,
  removeMemberAction,
  TeamMemberItem,
} from "./actions";
import { WorkspaceRole } from "@/types/database.types";

export default function TeamPage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [callerRole, setCallerRole] = useState<WorkspaceRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const refreshMembers = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const res = await getTeamMembersAction(activeWorkspaceId);
      if (res.success) {
        setMembers(res.members);
        setCallerRole(res.callerRole);
      }
    } catch (err: unknown) {
      console.error("Error refreshing team:", err);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isMounted = true;
    if (!activeWorkspaceId) {
      return;
    }

    getTeamMembersAction(activeWorkspaceId)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setMembers(res.members);
          setCallerRole(res.callerRole);
        } else {
          setError(res.error || "Failed to load team members.");
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Error loading team.";
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;

    setIsInviting(true);
    setInviteStatus(null);

    const res = await inviteTeamMemberAction({
      workspaceId: activeWorkspaceId,
      email: inviteEmail,
      role: inviteRole,
    });

    setIsInviting(false);
    if (res.success) {
      setInviteStatus({ type: "success", text: res.message || "Invitation sent." });
      setInviteEmail("");
      refreshMembers();
    } else {
      setInviteStatus({ type: "error", text: res.error || "Failed to invite." });
    }
  };

  const handleRoleChange = async (memberId: string, newRole: WorkspaceRole) => {
    if (!activeWorkspaceId) return;
    const res = await updateMemberRoleAction({
      workspaceId: activeWorkspaceId,
      memberId,
      newRole,
    });
    if (res.success) {
      refreshMembers();
    } else {
      alert(res.error || "Failed to change role.");
    }
  };

  const handleRemoveMember = async (memberId: string, name: string) => {
    if (!activeWorkspaceId) return;
    if (!confirm(`Are you sure you want to remove ${name} from this workspace?`)) return;

    const res = await removeMemberAction({
      workspaceId: activeWorkspaceId,
      memberId,
    });
    if (res.success) {
      refreshMembers();
    } else {
      alert(res.error || "Failed to remove member.");
    }
  };

  const isManager = callerRole === "owner" || callerRole === "admin";
  const isOwner = callerRole === "owner";

  return (
    <div className="space-y-6 max-w-7xl w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Team Members</h2>
          <p className="text-slate-500 text-sm">
            Manage who has access to &ldquo;{activeWorkspace?.name || "your workspace"}&rdquo; and their authorization roles.
          </p>
        </div>
        {isManager && (
          <Button
            onClick={() => {
              setIsInviteOpen(true);
              setInviteStatus(null);
            }}
            className="bg-blue-600 hover:bg-blue-700 h-9 text-xs shadow-sm"
          >
            <UserPlus className="w-4 h-4 mr-2" /> Invite Member
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Active Members</CardTitle>
            <CardDescription className="text-xs">
              Users with access to manage reviews, locations, and integrations.
            </CardDescription>
          </div>
          <span className="text-xs font-mono font-medium text-slate-500">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="text-xs">Loading team members...</span>
            </div>
          ) : members.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm space-y-2">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-medium text-slate-600">No members found</p>
              <p className="text-xs text-slate-400">Invite colleagues to collaborate on reputation management.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => {
                const initials = member.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "NR";

                return (
                  <div
                    key={member.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50/60 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-9 w-9 border border-slate-200">
                        <AvatarFallback className="bg-blue-50 text-blue-700 text-xs font-bold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-900 truncate">{member.name}</p>
                          {member.isCurrentUser && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-medium">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {isOwner && !member.isCurrentUser && member.role !== "owner" ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as WorkspaceRole)}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-2xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`capitalize text-xs font-medium px-2 py-0.5 ${
                            member.role === "owner"
                              ? "border-purple-200 bg-purple-50 text-purple-700"
                              : member.role === "admin"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {member.role === "owner" ? (
                            <Shield className="w-3 h-3 mr-1 text-purple-600" />
                          ) : member.role === "admin" ? (
                            <UserCheck className="w-3 h-3 mr-1 text-blue-600" />
                          ) : null}
                          {member.role}
                        </Badge>
                      )}

                      {isManager && !member.isCurrentUser && member.role !== "owner" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMember(member.id, member.name)}
                          title="Remove member"
                          className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite Member Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-sm text-slate-900">Invite Team Member</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="mt-4 space-y-3">
              {inviteStatus && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                    inviteStatus.type === "success"
                      ? "bg-green-50 border-green-200 text-green-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  {inviteStatus.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <span>{inviteStatus.text}</span>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="invite-email" className="text-xs font-medium text-slate-700">
                  Email Address
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isInviting}
                  required
                  autoFocus
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="invite-role" className="text-xs font-medium text-slate-700">
                  Role & Permissions
                </Label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                  disabled={isInviting}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-2xs focus:outline-none"
                >
                  <option value="member">Member (View & generate review replies)</option>
                  <option value="admin">Admin (Manage integrations, members, & safety rules)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsInviteOpen(false)}
                  disabled={isInviting}
                  className="w-1/2 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isInviting || !inviteEmail.trim()}
                  className="w-1/2 bg-blue-600 hover:bg-blue-700 text-white text-xs shadow-sm"
                >
                  {isInviting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    "Send Invitation"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
