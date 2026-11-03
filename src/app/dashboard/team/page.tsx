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
  Copy,
  Check,
  Clock,
  RotateCw,
  Send,
  Info,
  Mail,
  Ban,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  getTeamMembersAction,
  getPendingInvitationsAction,
  inviteTeamMemberAction,
  revokeInvitationAction,
  resendInvitationAction,
  updateMemberRoleAction,
  removeMemberAction,
  TeamMemberItem,
  PendingInvitationItem,
  InvitationStatus,
} from "./actions";
import { WorkspaceRole } from "@/types/database.types";

export default function TeamPage() {
  const { activeWorkspaceId, activeWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitationItem[]>([]);
  const [callerRole, setCallerRole] = useState<WorkspaceRole | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Invitation status filter
  const [statusFilter, setStatusFilter] = useState<"all" | InvitationStatus>("all");

  const isLoading = isWorkspaceLoading || (!isLoaded && Boolean(activeWorkspaceId));

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    success: boolean;
    message: string;
    inviteLink?: string;
  } | null>(null);

  // Copied link state feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const [membersRes, invitesRes] = await Promise.all([
        getTeamMembersAction(activeWorkspaceId),
        getPendingInvitationsAction(activeWorkspaceId),
      ]);
      if (membersRes.success) {
        setMembers(membersRes.members);
        setCallerRole(membersRes.callerRole);
      }
      if (invitesRes.success) {
        setInvitations(invitesRes.invitations);
      }
    } catch (err: unknown) {
      console.error("Error refreshing team data:", err);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isMounted = true;
    if (!activeWorkspaceId) return;

    Promise.all([
      getTeamMembersAction(activeWorkspaceId),
      getPendingInvitationsAction(activeWorkspaceId),
    ])
      .then(([membersRes, invitesRes]) => {
        if (!isMounted) return;
        if (membersRes.success) {
          setMembers(membersRes.members);
          setCallerRole(membersRes.callerRole);
        } else {
          setError(membersRes.error || "Failed to load team members.");
        }
        if (invitesRes.success) {
          setInvitations(invitesRes.invitations);
        }
        setIsLoaded(true);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Error loading team.";
        setError(msg);
        setIsLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;

    setIsInviting(true);
    setInviteResult(null);

    const res = await inviteTeamMemberAction({
      workspaceId: activeWorkspaceId,
      email: inviteEmail,
      role: inviteRole,
    });

    setIsInviting(false);
    if (res.success) {
      setInviteResult({
        success: true,
        message: res.message || "Invitation created.",
        inviteLink: res.inviteLink,
      });
      setInviteEmail("");
      refreshData();
    } else {
      setInviteResult({
        success: false,
        message: res.error || "Failed to invite.",
      });
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
      setActionNotice({ type: "success", text: "Role updated successfully." });
      refreshData();
      setTimeout(() => setActionNotice(null), 4000);
    } else {
      setActionNotice({ type: "error", text: res.error || "Failed to change role." });
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
      setActionNotice({ type: "success", text: `${name} has been removed from the workspace.` });
      refreshData();
      setTimeout(() => setActionNotice(null), 4000);
    } else {
      setActionNotice({ type: "error", text: res.error || "Failed to remove member." });
    }
  };

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!activeWorkspaceId) return;
    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) return;

    const res = await revokeInvitationAction({
      workspaceId: activeWorkspaceId,
      invitationId,
    });
    if (res.success) {
      setActionNotice({ type: "success", text: `Invitation for ${email} has been revoked.` });
      refreshData();
      setTimeout(() => setActionNotice(null), 4000);
    } else {
      setActionNotice({ type: "error", text: res.error || "Failed to revoke invitation." });
    }
  };

  const handleResendInvitation = async (invitationId: string, email: string) => {
    if (!activeWorkspaceId) return;
    setResendingId(invitationId);

    const res = await resendInvitationAction({
      workspaceId: activeWorkspaceId,
      invitationId,
    });
    setResendingId(null);

    if (res.success) {
      setActionNotice({ type: "success", text: res.message || `Invitation resent to ${email}.` });
      refreshData();
      setTimeout(() => setActionNotice(null), 4000);
    } else {
      setActionNotice({ type: "error", text: res.error || "Failed to resend invitation." });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const isManager = callerRole === "owner" || callerRole === "admin";
  const isOwner = callerRole === "owner";

  const filteredInvitations = invitations.filter((inv) => {
    if (statusFilter === "all") return true;
    return inv.status === statusFilter;
  });

  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const acceptedCount = invitations.filter((i) => i.status === "accepted").length;
  const expiredCount = invitations.filter((i) => i.status === "expired").length;
  const revokedCount = invitations.filter((i) => i.status === "revoked").length;

  return (
    <div className="space-y-6 max-w-7xl w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Team Collaboration</h2>
          <p className="text-slate-500 text-sm">
            Manage authorized members of &ldquo;{activeWorkspace?.name || "your workspace"}&rdquo; and invite new collaborators.
          </p>
        </div>
        {isManager && (
          <Button
            onClick={() => {
              setIsInviteOpen(true);
              setInviteResult(null);
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white h-9 px-3.5 text-xs font-medium shadow-xs gap-1.5 transition-all"
          >
            <UserPlus className="w-4 h-4" /> Invite Member
          </Button>
        )}
      </div>

      {actionNotice && (
        <div
          className={`p-3 text-xs rounded-xl flex items-center justify-between border ${
            actionNotice.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-950"
              : "bg-red-50 border-red-200 text-red-950"
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{actionNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 text-xs rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active Members Card */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Active Members</CardTitle>
            <CardDescription className="text-xs">
              Users with verified access to manage reviews, locations, and integrations.
            </CardDescription>
          </div>
          <span className="text-xs font-mono font-medium text-slate-500">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-slate-900" />
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
                        <AvatarFallback className="bg-slate-100 text-slate-800 text-xs font-bold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-900 truncate">{member.name}</p>
                          {member.isCurrentUser && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
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
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-2xs focus:outline-none focus:ring-1 focus:ring-slate-900"
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

                      {/* Remove member button: Owner can remove anyone (except self). Admin can remove members only */}
                      {((isOwner && !member.isCurrentUser && member.role !== "owner") ||
                        (callerRole === "admin" && !member.isCurrentUser && member.role === "member")) && (
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

      {/* Workspace Invitations Management Card */}
      {isManager && (
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600" /> Workspace Invitations
              </CardTitle>
              <CardDescription className="text-xs">
                Track pending, accepted, expired, and revoked invitation links.
              </CardDescription>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  statusFilter === "all"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All ({invitations.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("pending")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  statusFilter === "pending"
                    ? "bg-white text-amber-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Pending ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("accepted")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  statusFilter === "accepted"
                    ? "bg-white text-emerald-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Accepted ({acceptedCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("expired")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  statusFilter === "expired"
                    ? "bg-white text-rose-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Expired ({expiredCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("revoked")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  statusFilter === "revoked"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Revoked ({revokedCount})
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {filteredInvitations.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs">
                No invitations found in this category.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInvitations.map((inv) => {
                  const isPending = inv.status === "pending";
                  const isAccepted = inv.status === "accepted";
                  const isExpired = inv.status === "expired";
                  const isRevoked = inv.status === "revoked";

                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-slate-900 truncate">{inv.email}</p>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize font-medium ${
                              isPending
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : isAccepted
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : isExpired
                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                : "border-slate-300 bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isPending && <Clock className="w-3 h-3 mr-1 text-amber-600" />}
                            {isAccepted && <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />}
                            {isExpired && <AlertCircle className="w-3 h-3 mr-1 text-rose-600" />}
                            {isRevoked && <Ban className="w-3 h-3 mr-1 text-slate-500" />}
                            {inv.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] capitalize text-slate-600 border-slate-200">
                            {inv.role}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {isAccepted ? (
                            <span className="text-emerald-700 font-medium">Joined workspace</span>
                          ) : isRevoked ? (
                            <span className="text-slate-500">Invitation revoked</span>
                          ) : isExpired ? (
                            <span className="text-rose-600 font-medium">
                              Expired {new Date(inv.expiresAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Copy Link button (pending only) */}
                        {isPending && inv.inviteLink && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(inv.inviteLink!, inv.id)}
                            className="text-xs h-8 gap-1.5 border-slate-200 text-slate-700 hover:bg-white"
                          >
                            {copiedId === inv.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied Link
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-500" /> Copy Link
                              </>
                            )}
                          </Button>
                        )}

                        {/* Resend button (pending, expired, or revoked) */}
                        {!isAccepted && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resendingId === inv.id}
                            onClick={() => handleResendInvitation(inv.id, inv.email)}
                            title="Resend invitation with fresh token"
                            className="text-xs h-8 gap-1.5 border-slate-200 text-slate-700 hover:bg-white"
                          >
                            {resendingId === inv.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" /> Resending...
                              </>
                            ) : (
                              <>
                                <RotateCw className="w-3 h-3 text-slate-500" /> Resend
                              </>
                            )}
                          </Button>
                        )}

                        {/* Revoke button (pending only) */}
                        {isPending && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevokeInvitation(inv.id, inv.email)}
                            title="Revoke invitation"
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
      )}

      {/* Invite Member Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-900 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900">Invite Team Member</h4>
                  <p className="text-xs text-slate-500">Send an invitation to join {activeWorkspace?.name || "this workspace"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteResult?.success ? (
              <div className="mt-4 space-y-4">
                <div className="p-3.5 rounded-xl text-xs bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-900">Invitation Dispatched</p>
                    <p className="text-emerald-800 mt-0.5">{inviteResult.message}</p>
                  </div>
                </div>

                {inviteResult.inviteLink && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-slate-700">Direct Invitation Link</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={inviteResult.inviteLink}
                        className="text-xs font-mono bg-slate-50 text-slate-700 truncate select-all"
                      />
                      <Button
                        size="sm"
                        onClick={() => copyToClipboard(inviteResult.inviteLink!, "modal-link")}
                        className="bg-slate-900 hover:bg-slate-800 text-white text-xs shrink-0 px-3"
                      >
                        {copiedId === "modal-link" ? (
                          <>
                            <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 mr-1" /> Copy Link
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="flex items-start gap-1.5 text-[11px] text-slate-500 pt-1">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                      <span>
                        The invitation link is valid for 7 days. Workspace access is not granted until the recipient accepts.
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      setIsInviteOpen(false);
                      setInviteResult(null);
                    }}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 font-medium"
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} className="mt-4 space-y-4">
                {inviteResult?.success === false && (
                  <div className="p-3 rounded-lg text-xs flex items-center gap-2 border bg-red-50 border-red-200 text-red-900">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{inviteResult.message}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="invite-email" className="text-xs font-medium text-slate-700">
                    Recipient Email Address
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={isInviting}
                    required
                    autoFocus
                    className="text-xs h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="invite-role" className="text-xs font-medium text-slate-700">
                    Assigned Role & Permissions
                  </Label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                    disabled={isInviting}
                    className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-2xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  >
                    <option value="member">Member — View reviews, draft AI replies, view QR codes</option>
                    <option value="admin">Admin — Manage team members, Google locations, QR codes & settings</option>
                  </select>
                </div>

                <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-3 text-[11px] text-slate-500 space-y-1">
                  <p className="font-medium text-slate-700 flex items-center gap-1">
                    <Send className="w-3 h-3 text-slate-500" /> Security Guarantee
                  </p>
                  <p>
                    Invited users cannot access workspace reviews, locations, or settings until they sign in with this exact email address and accept the invitation.
                  </p>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsInviteOpen(false)}
                    disabled={isInviting}
                    className="w-1/2 text-xs h-9"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isInviting || !inviteEmail.trim()}
                    className="w-1/2 bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 font-medium shadow-xs"
                  >
                    {isInviting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Sending...
                      </>
                    ) : (
                      "Send Invitation"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
