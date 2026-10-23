"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MapPin,
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Check,
  Building2,
  Phone,
  Info,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useWorkspace } from "@/contexts/workspace-context";
import { syncGoogleLocationsAction } from "./actions";

interface GoogleIntegrationState {
  isConnected: boolean;
  accountName?: string | null;
  updatedAt?: string | null;
}

interface LocationRecord {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  google_place_id: string | null;
  google_location_id: string | null;
  is_connected: boolean;
  updated_at: string;
}

function LocationsContent() {
  const searchParams = useSearchParams();
  const googleSuccess = searchParams.get("google_success");
  const googleError = searchParams.get("google_error");

  const {
    activeWorkspace,
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    isMigrationPending,
  } = useWorkspace();

  const [integration, setIntegration] = useState<GoogleIntegrationState>({ isConnected: false });
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
    reviewsMessage?: string;
    error?: string;
  } | null>(null);

  const refreshLocations = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const supabase = createClient();
      const [googleRes, locationsRes] = await Promise.all([
        supabase
          .from("google_integrations")
          .select("account_name, updated_at")
          .eq("workspace_id", activeWorkspaceId)
          .maybeSingle(),
        supabase
          .from("locations")
          .select("*")
          .eq("workspace_id", activeWorkspaceId)
          .order("created_at", { ascending: false }),
      ]);

      if (googleRes.data) {
        setIntegration({
          isConnected: true,
          accountName: googleRes.data.account_name,
          updatedAt: googleRes.data.updated_at,
        });
      } else {
        setIntegration({ isConnected: false });
      }

      setLocations(locationsRes.data || []);
    } catch (err) {
      console.error("Failed to refresh locations:", err);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isMounted = true;
    if (!activeWorkspaceId) {
      return;
    }
    const supabase = createClient();

    Promise.all([
      supabase
        .from("google_integrations")
        .select("account_name, updated_at")
        .eq("workspace_id", activeWorkspaceId)
        .maybeSingle(),
      supabase
        .from("locations")
        .select("*")
        .eq("workspace_id", activeWorkspaceId)
        .order("created_at", { ascending: false }),
    ])
      .then(([googleRes, locationsRes]) => {
        if (!isMounted) return;
        if (googleRes.data) {
          setIntegration({
            isConnected: true,
            accountName: googleRes.data.account_name,
            updatedAt: googleRes.data.updated_at,
          });
        } else {
          setIntegration({ isConnected: false });
        }
        setLocations(locationsRes.data || []);
        setIsLoadingData(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load locations or integration:", err);
        setIsLoadingData(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  const handleConnectGoogle = () => {
    if (!activeWorkspaceId) return;

    const startUrl = `/api/auth/google/start?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    window.location.assign(new URL(startUrl, window.location.origin).toString());
  };

  const handleSyncLocations = async () => {
    if (!activeWorkspaceId || isSyncing) return;

    setIsSyncing(true);
    setSyncResult(null);

    try {
      const res = await syncGoogleLocationsAction(activeWorkspaceId);
      setSyncResult(res);
      if (res.success) {
        await refreshLocations();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      setSyncResult({ success: false, message: "", error: msg });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Locations</h2>
        <p className="text-slate-500">Manage and synchronize your Google Business Profile locations.</p>
      </div>

      {/* OAuth Callback Status Notifications */}
      {googleSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl flex items-start text-sm shadow-sm">
          <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-green-600" />
          <div>
            <strong>Google Business Profile Connected</strong>
            <p className="mt-0.5 text-green-700">
              {googleSuccess === "1" ? "OAuth authorization completed successfully." : googleSuccess}
            </p>
          </div>
        </div>
      )}

      {googleError && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start text-sm shadow-sm">
          <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-red-600" />
          <div>
            <strong>Google OAuth Notice</strong>
            <p className="mt-0.5 text-red-700">{googleError}</p>
          </div>
        </div>
      )}

      {/* Live Sync Results Notifications */}
      {syncResult && (
        <div
          className={`p-4 rounded-xl flex items-start text-sm shadow-sm border ${
            syncResult.success
              ? "bg-blue-50 border-blue-200 text-blue-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          {syncResult.success ? (
            <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-blue-600" />
          ) : (
            <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-red-600" />
          )}
          <div className="space-y-1">
            <strong>{syncResult.success ? "Sync Completed" : "Sync Failed"}</strong>
            <p className="text-xs">{syncResult.success ? syncResult.message : syncResult.error}</p>
            {syncResult.reviewsMessage && (
              <p className="text-xs text-blue-700 bg-blue-100/60 p-2 rounded mt-1.5 flex items-start gap-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                <span>{syncResult.reviewsMessage}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Connection Card */}
      {integration.isConnected ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Google Business Profile Connected
                </CardTitle>
                <CardDescription>
                  Workspace &ldquo;{activeWorkspace?.name || "Active"}&rdquo; is linked to Google Cloud Project 248443327820.
                </CardDescription>
              </div>
              <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">
                <Check className="w-3 h-3 mr-1" /> Authorized
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm">
              <div>
                <span className="text-xs font-medium text-slate-500 block">Connected Account</span>
                <span className="font-medium text-slate-900">{integration.accountName || "Google Account"}</span>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-500 block">OAuth Scope</span>
                <span className="font-mono text-xs text-slate-700">business.manage</span>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-500 block">Token Storage</span>
                <span className="text-xs text-slate-600">AES-256-GCM Encrypted (Database)</span>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-500 block">Last Synced / Updated</span>
                <span className="text-xs text-slate-600">
                  {integration.updatedAt ? new Date(integration.updatedAt).toLocaleString() : "Active"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                onClick={handleSyncLocations}
                disabled={isSyncing || isLoadingData}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-sm transition-all"
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing Locations & Reviews..." : "Sync Locations"}
              </Button>

              <Button
                variant="outline"
                onClick={handleConnectGoogle}
                disabled={isSyncing}
                className="text-slate-700 border-slate-300 hover:bg-slate-50 text-xs"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reconnect / Switch Google Account
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Connect a Location</CardTitle>
                <CardDescription>
                  Link your Google Business Profile to start syncing reviews and locations.
                </CardDescription>
              </div>
              {activeWorkspace && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-100 text-xs text-blue-700 font-medium">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Workspace: {activeWorkspace.name}</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <MapPin className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">No locations connected</h3>
              <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
                {activeWorkspace
                  ? `You haven't connected any Google Business Profile locations for "${activeWorkspace.name}" yet. Connect your account to see reviews and analytics.`
                  : isMigrationPending
                  ? "Multi-tenant database tables are not yet initialized in Supabase. Please apply the schema migration first."
                  : "No active workspace is currently selected. Please set up or choose a workspace above."}
              </p>
              <div className="mt-6">
                <Button
                  onClick={handleConnectGoogle}
                  disabled={isLoadingData || isWorkspaceLoading || !activeWorkspaceId}
                  className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                >
                  <Plus className="mr-2 h-4 w-4" /> Connect Google Business Profile
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Your Locations Section */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            Your Locations {locations.length > 0 ? `(${locations.length})` : ""}
          </h3>
          {integration.isConnected && locations.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncLocations}
              disabled={isSyncing}
              className="text-xs text-slate-700 border-slate-200 hover:bg-slate-50 h-8"
            >
              <RefreshCw className={`mr-1.5 h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>

        {locations.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {locations.map((loc) => (
              <Card key={loc.id} className="border-slate-200 bg-white shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold text-slate-900 leading-tight truncate">
                          {loc.name}
                        </CardTitle>
                        {loc.google_place_id && (
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5 truncate">
                            Place ID: {loc.google_place_id}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50 shrink-0 text-[11px]">
                      Connected
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-slate-600 pt-0">
                  {loc.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{loc.address}</span>
                    </div>
                  )}
                  {loc.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{loc.phone}</span>
                    </div>
                  )}
                  <div className="pt-2 text-[10px] text-slate-400 border-t border-slate-100 flex items-center justify-between">
                    <span>Synced with Google Business Profile</span>
                    <span>{loc.updated_at ? new Date(loc.updated_at).toLocaleDateString() : ""}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-8 text-center">
            <div className="w-10 h-10 rounded-full bg-slate-200/70 text-slate-500 flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-5 h-5" />
            </div>
            <h4 className="font-medium text-slate-900 text-sm">0 locations synced yet</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {integration.isConnected
                ? "Your Google Business Profile account is connected. Click the Sync Locations button to retrieve your business locations."
                : "Approval granted for project 248443327820. Connect your account to sync locations."}
            </p>
            {integration.isConnected && (
              <div className="mt-4">
                <Button
                  size="sm"
                  onClick={handleSyncLocations}
                  disabled={isSyncing}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing..." : "Sync Locations Now"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}
    >
      {children}
    </span>
  );
}

export default function LocationsPage() {
  return (
    <Suspense fallback={null}>
      <LocationsContent />
    </Suspense>
  );
}
