"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building,
  Users,
  MessageSquare,
  ShieldAlert,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  MapPin,
  Sparkles,
  Server,
  Lock,
} from "lucide-react";
import { getSuperAdminPlatformDataAction, PlatformStats } from "./actions";

export default function AdminDashboard() {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    getSuperAdminPlatformDataAction()
      .then((res) => {
        if (!isMounted) return;
        setIsAuthorized(res.isAuthorized);
        setUserEmail(res.userEmail);
        if (res.isAuthorized && res.data) {
          setStats(res.data);
        } else if (res.error) {
          setErrorMsg(res.error);
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setIsAuthorized(false);
        setErrorMsg(err instanceof Error ? err.message : "Failed to verify admin status.");
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-slate-900 animate-spin mb-3" />
        <p className="text-xs font-medium text-slate-600">Verifying platform administrator credentials...</p>
      </div>
    );
  }

  // Unauthorized State: Clear explanation of Workspace Admin vs. Platform Super Admin
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 font-sans">
        <div className="w-full max-w-lg">
          <Card className="border-slate-200/90 bg-white shadow-xl rounded-2xl overflow-hidden">
            <CardHeader className="text-center pb-4 pt-8 border-b border-slate-100">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto mb-3">
                <Lock className="w-7 h-7" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">Platform Super Admin</CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-1">
                Access Restricted — System-Level Administration
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 space-y-5">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  Role Distinction in NexRep
                </div>
                <p className="leading-relaxed">
                  You are currently authenticated as <strong className="text-slate-900">{userEmail || "a workspace user"}</strong>.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-1">
                    <p className="font-semibold text-slate-900 text-[11px]">Workspace Admin / Owner</p>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Manages your business profile, reviews, team members, and AI reply rules within your tenant.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-1">
                    <p className="font-semibold text-slate-900 text-[11px]">Platform Super Admin</p>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Reserved for NexRep operators to monitor cross-tenant health, cron jobs, and infrastructure.
                    </p>
                  </div>
                </div>
              </div>

              {errorMsg && (
                <p className="text-xs text-slate-500 text-center">
                  Notice: {errorMsg}
                </p>
              )}

              <div className="pt-2">
                <Link href="/dashboard" className="block w-full">
                  <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs h-10 font-medium shadow-xs gap-1.5">
                    <ArrowLeft className="w-4 h-4" /> Return to Workspace Dashboard
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Authorized Platform Super Admin Dashboard
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200 bg-white">
                <ArrowLeft className="w-4 h-4 text-slate-700" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Super Admin</h1>
                <Badge className="bg-slate-900 text-white text-[10px] px-2 py-0.5 font-semibold">Instance Operator</Badge>
              </div>
              <p className="text-slate-500 text-xs mt-0.5">
                Real-time multi-tenant telemetry and system health for authenticated operator: {userEmail}
              </p>
            </div>
          </div>
          <Link href="/dashboard">
            <Button variant="outline" className="text-xs h-9 bg-white border-slate-200">
              Back to Dashboard
            </Button>
          </Link>
        </div>

        {/* Real Platform KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">Total Workspaces</CardTitle>
              <Building className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stats?.totalWorkspaces ?? 0}</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Provisioned business tenants</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">Registered Users</CardTitle>
              <Users className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stats?.totalUsers ?? 0}</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Active user profiles</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">Connected GBP Profiles</CardTitle>
              <MapPin className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stats?.connectedLocations ?? 0}</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Live Google locations</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">Reviews & AI Replies</CardTitle>
              <MessageSquare className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {stats?.totalReviews ?? 0} <span className="text-xs font-normal text-slate-400">/ {stats?.totalReplies ?? 0} replies</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">Total processed in database</p>
            </CardContent>
          </Card>
        </div>

        {/* System Infrastructure Health */}
        <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-slate-700" />
              <CardTitle className="text-sm font-semibold text-slate-900">Platform Subsystems & Health</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Live status of background workers, API providers, and OAuth credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 grid gap-3 sm:grid-cols-3">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-900">OpenAI API Engine</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`h-2 w-2 rounded-full ${stats?.systemHealth.aiConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <span className="text-[11px] text-slate-600">
                    {stats?.systemHealth.aiConfigured ? "Configured & Active" : "Fallback Mode"}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start gap-3">
              <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-900">Google Business OAuth</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`h-2 w-2 rounded-full ${stats?.systemHealth.googleOAuthConfigured ? "bg-emerald-500" : "bg-red-500"}`} />
                  <span className="text-[11px] text-slate-600">
                    {stats?.systemHealth.googleOAuthConfigured ? "OAuth App Connected" : "Missing Credentials"}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-900">Automated Cron Worker</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`h-2 w-2 rounded-full ${stats?.systemHealth.cronConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <span className="text-[11px] text-slate-600">
                    {stats?.systemHealth.cronConfigured ? "CRON_SECRET Active" : "Default Auth Guard"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Real Workspace Directory */}
        <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900">Registered Workspaces Directory</CardTitle>
              <CardDescription className="text-xs">
                Live list of tenants provisioned on this NexRep instance.
              </CardDescription>
            </div>
            <span className="text-xs font-mono font-medium text-slate-500">
              {stats?.workspaces.length ?? 0} tenants
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {(!stats?.workspaces || stats.workspaces.length === 0) ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No workspaces registered yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {stats.workspaces.map((ws) => (
                  <div key={ws.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{ws.name}</p>
                      <p className="text-[11px] text-slate-500">
                        Owner: {ws.ownerEmail} • Created {new Date(ws.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200">
                        {ws.connectedLocationsCount > 0 ? (
                          <span className="flex items-center gap-1 text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {ws.connectedLocationsCount} GBP Profile Connected
                          </span>
                        ) : (
                          <span className="text-slate-500">No profile connected</span>
                        )}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
