"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building, CreditCard, ArrowLeft, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export default function AdminDashboard() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user }, error }) => {
      if (!isMounted) return;
      if (error || !user) {
        router.push("/login?error=" + encodeURIComponent("Super admin dashboard requires authentication."));
        return;
      }

      const { data: memberRecord } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .limit(1)
        .maybeSingle();

      const hasPrivilege = user.app_metadata?.role === "superadmin" || Boolean(memberRecord);

      if (!hasPrivilege) {
        router.push("/dashboard");
        return;
      }

      setIsAuthorized(true);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-600">Verifying administrative credentials...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "icon" }))}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Super Admin</h1>
            <p className="text-slate-500">Manage tenants, subscriptions, and system health.</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Tenants</CardTitle>
              <Building className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">142</div>
              <p className="text-xs text-slate-500 mt-1">+12 this month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Active Users</CardTitle>
              <Users className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">892</div>
              <p className="text-xs text-slate-500 mt-1">+49 this week</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">MRR</CardTitle>
              <CreditCard className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">$12,450</div>
              <p className="text-xs text-slate-500 mt-1">+8% this month</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: "Acme Corp", plan: "Pro", users: 12, status: "Active" },
                { name: "Global Industries", plan: "Enterprise", users: 45, status: "Active" },
                { name: "Local Coffee Co.", plan: "Starter", users: 2, status: "Trial" },
              ].map((tenant, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg bg-white">
                  <div>
                    <h4 className="font-medium text-slate-900">{tenant.name}</h4>
                    <p className="text-sm text-slate-500">{tenant.plan} Plan • {tenant.users} users</p>
                  </div>
                  <Badge variant={tenant.status === 'Active' ? 'default' : 'secondary'}>{tenant.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Badge({ children, variant }: { children: React.ReactNode; variant?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variant === 'default' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>{children}</span>
}
