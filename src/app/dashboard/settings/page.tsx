"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  getSettingsPageDataAction,
  saveWorkspaceSettingsAction,
  updateProfileNameAction,
} from "./actions";
import { AutoReplyMode } from "@/lib/reply-safety";
import { ReplyTone } from "@/lib/ai";
import {
  ShieldCheck,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
} from "lucide-react";

export default function SettingsPage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Profile state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  // Workspace safety & AI settings state
  const [autoReplyMode, setAutoReplyMode] = useState<AutoReplyMode>("manual_approval");
  const [requireCriticalApproval, setRequireCriticalApproval] = useState(true);
  const [defaultTone, setDefaultTone] = useState<ReplyTone>("professional");
  const [businessContext, setBusinessContext] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;

    getSettingsPageDataAction(activeWorkspaceId)
      .then((data) => {
        if (!isMounted) return;
        if (data.user) {
          setFullName(data.user.name);
          setEmail(data.user.email);
        }
        if (data.settings) {
          setAutoReplyMode(data.settings.autoReplyMode);
          setRequireCriticalApproval(data.settings.requireApprovalForCritical);
          setDefaultTone(data.settings.defaultReplyTone);
          setBusinessContext(data.settings.businessContext);
        }
        setUserRole(data.userRole || null);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Error loading settings:", err);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileMessage(null);

    const res = await updateProfileNameAction(fullName);
    setIsSavingProfile(false);
    if (res.success) {
      setProfileMessage("Profile updated successfully.");
    } else {
      setProfileMessage(res.error || "Failed to update profile.");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;

    setIsSavingSettings(true);
    setSettingsMessage(null);

    const res = await saveWorkspaceSettingsAction(activeWorkspaceId, {
      autoReplyMode,
      requireApprovalForCritical: requireCriticalApproval,
      defaultReplyTone: defaultTone,
      businessContext,
    });

    setIsSavingSettings(false);
    if (res.success) {
      setSettingsMessage({ type: "success", text: res.message || "Settings updated successfully." });
    } else {
      setSettingsMessage({ type: "error", text: res.error || "Failed to save settings." });
    }
  };

  const isAuthorized = userRole === "owner" || userRole === "admin";

  return (
    <div className="space-y-6 max-w-4xl w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h2>
        <p className="text-slate-500">
          Manage your account profile and configure automatic reply safety rules for &ldquo;{activeWorkspace?.name || "your workspace"}&rdquo;.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-sm">Loading workspace settings...</span>
        </div>
      ) : (
        <>
          {/* 1. Account Profile Card */}
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">User Profile</CardTitle>
                  <CardDescription className="text-xs">
                    Your personal details and sign-in credentials.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                {profileMessage && (
                  <div className="p-3 text-xs rounded-lg bg-blue-50 border border-blue-200 text-blue-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>{profileMessage}</span>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-medium text-slate-700">Full Name</Label>
                    <Input
                      id="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your full name"
                      className="text-xs"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium text-slate-700">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      disabled
                      className="text-xs bg-slate-50 text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="pt-1">
                  <Button
                    type="submit"
                    disabled={isSavingProfile || !fullName.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9"
                  >
                    {isSavingProfile ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        Saving...
                      </>
                    ) : (
                      "Save Profile"
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* 2. Automatic Reply Safety & AI Settings Card */}
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-50 text-green-700 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Automatic Reply Safety Rules</CardTitle>
                    <CardDescription className="text-xs">
                      Enforce human approval gates and prevent unintentional or repeated publishing.
                    </CardDescription>
                  </div>
                </div>
                {userRole && (
                  <Badge variant="outline" className="capitalize text-xs font-normal border-slate-200 bg-slate-50 text-slate-600">
                    Your Role: {userRole}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {!isAuthorized && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    You have view-only access. Only workspace owners and administrators can modify reply safety rules.
                  </span>
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-5">
                {settingsMessage && (
                  <div
                    className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
                      settingsMessage.type === "success"
                        ? "bg-green-50 border-green-200 text-green-900"
                        : "bg-red-50 border-red-200 text-red-900"
                    }`}
                  >
                    {settingsMessage.type === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                    <span>{settingsMessage.text}</span>
                  </div>
                )}

                {/* Auto Reply Mode Selector */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-900">
                    Publishing Workflow Mode
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label
                      className={`p-3.5 rounded-xl border text-xs cursor-pointer flex flex-col justify-between transition-all ${
                        autoReplyMode === "manual_approval"
                          ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900">Manual Approval</span>
                          <input
                            type="radio"
                            name="autoReplyMode"
                            checked={autoReplyMode === "manual_approval"}
                            onChange={() => setAutoReplyMode("manual_approval")}
                            disabled={!isAuthorized}
                            className="text-blue-600"
                          />
                        </div>
                        <p className="text-slate-500 text-[11px] leading-relaxed">
                          All AI replies are generated as drafts. A team member must inspect and click publish.
                        </p>
                      </div>
                      <span className="inline-block mt-2 font-medium text-[10px] text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded w-fit">
                        Recommended
                      </span>
                    </label>

                    <label
                      className={`p-3.5 rounded-xl border text-xs cursor-pointer flex flex-col justify-between transition-all ${
                        autoReplyMode === "auto_publish_positive"
                          ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900">Auto-Publish 4-5 Stars</span>
                          <input
                            type="radio"
                            name="autoReplyMode"
                            checked={autoReplyMode === "auto_publish_positive"}
                            onChange={() => setAutoReplyMode("auto_publish_positive")}
                            disabled={!isAuthorized}
                            className="text-blue-600"
                          />
                        </div>
                        <p className="text-slate-500 text-[11px] leading-relaxed">
                          Automatically publishes replies to glowing 4 and 5-star reviews. Critical reviews stay as drafts.
                        </p>
                      </div>
                      <span className="inline-block mt-2 font-medium text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded w-fit">
                        Selective Auto
                      </span>
                    </label>

                    <label
                      className={`p-3.5 rounded-xl border text-xs cursor-pointer flex flex-col justify-between transition-all ${
                        autoReplyMode === "auto_publish_all"
                          ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900">Auto-Publish All</span>
                          <input
                            type="radio"
                            name="autoReplyMode"
                            checked={autoReplyMode === "auto_publish_all"}
                            onChange={() => setAutoReplyMode("auto_publish_all")}
                            disabled={!isAuthorized}
                            className="text-blue-600"
                          />
                        </div>
                        <p className="text-slate-500 text-[11px] leading-relaxed">
                          Publishes AI replies to all reviews automatically unless restricted by critical review lock.
                        </p>
                      </div>
                      <span className="inline-block mt-2 font-medium text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded w-fit">
                        Fully Automated
                      </span>
                    </label>
                  </div>
                </div>

                {/* Critical Review Safety Gate */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="critical-lock"
                      checked={requireCriticalApproval}
                      onChange={(e) => setRequireCriticalApproval(e.target.checked)}
                      disabled={!isAuthorized}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <Label htmlFor="critical-lock" className="text-xs font-semibold text-slate-900 cursor-pointer">
                        Critical Review Safety Gate (Always Require Approval for 1-3 Stars)
                      </Label>
                      <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                        Even if auto-publishing is enabled, critical customer reviews (1 to 3 stars) will never be published without explicit human review and approval.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Default Tone & Business Context */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tone-select" className="text-xs font-medium text-slate-700">
                      Default Reply Tone
                    </Label>
                    <select
                      id="tone-select"
                      value={defaultTone}
                      onChange={(e) => setDefaultTone(e.target.value as ReplyTone)}
                      disabled={!isAuthorized}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="professional">Professional (Polished, courteous, respectful)</option>
                      <option value="friendly">Friendly (Warm, cheerful, welcoming)</option>
                      <option value="concise">Concise (Direct, brief, 1-2 clear sentences)</option>
                      <option value="empathetic">Empathetic (Compassionate, attentive, resolving)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="biz-context" className="text-xs font-medium text-slate-700">
                      Custom Business Context & AI Instructions
                    </Label>
                    <Input
                      id="biz-context"
                      value={businessContext}
                      onChange={(e) => setBusinessContext(e.target.value)}
                      disabled={!isAuthorized}
                      placeholder="e.g. Downtown Dental, family practice open since 2012"
                      className="text-xs"
                    />
                  </div>
                </div>

                {isAuthorized && (
                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={isSavingSettings}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 shadow-sm"
                    >
                      {isSavingSettings ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          Saving Safety Rules...
                        </>
                      ) : (
                        "Save Safety Rules"
                      )}
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
