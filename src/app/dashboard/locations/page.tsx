"use client";

import { useEffect, useState, useCallback, Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Search,
  X,
  ArrowRight,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import {
  getAvailableGoogleProfilesAction,
  selectSingleGoogleProfileAction,
  disconnectGoogleProfileAction,
  syncActiveLocationAction,
  GoogleLocationProfile,
  SyncLocationsResult,
} from "./actions";

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
  google_account_id: string | null;
  is_connected: boolean;
  updated_at: string;
}

function LocationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleSuccess = searchParams.get("google_success");
  const googleError = searchParams.get("google_error");
  const initialSelectParam = searchParams.get("select_profile") === "1";

  const {
    activeWorkspace,
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    isMigrationPending,
  } = useWorkspace();
  const { refreshLocations: refreshLocationContext } = useLocation();

  const [integration, setIntegration] = useState<GoogleIntegrationState>({ isConnected: false });
  const [activeLocation, setActiveLocation] = useState<LocationRecord | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Profile Selector Modal / View State
  const [isSelectingProfile, setIsSelectingProfile] = useState(initialSelectParam);
  const [availableProfiles, setAvailableProfiles] = useState<GoogleLocationProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [profileSearchQuery, setProfileSearchQuery] = useState("");
  const [profilesFetchError, setProfilesFetchError] = useState<string | null>(null);

  // Action Pending States
  const [isSelectingId, setIsSelectingId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // User notifications
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);
  const [actionErrorNotice, setActionErrorNotice] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncLocationsResult | null>(null);

  // Load integration and active location from database
  const loadData = useCallback(async () => {
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
          .eq("is_connected", true),
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

      const connectedLocs = (locationsRes.data || []) as LocationRecord[];
      if (connectedLocs.length === 1) {
        setActiveLocation(connectedLocs[0]);
      } else {
        // Zero or multiple connected: require explicit selection. No default profile.
        setActiveLocation(null);
        if (googleRes.data) {
          setIsSelectingProfile(true);
        }
      }
    } catch (err) {
      console.error("Failed to load locations or integration:", err);
    } finally {
      setIsLoadingData(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) loadData();
    });
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  // Fetch available profiles from Google when profile picker is opened
  const fetchAvailableProfiles = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsLoadingProfiles(true);
    setProfilesFetchError(null);

    try {
      const res = await getAvailableGoogleProfilesAction(activeWorkspaceId);
      if (res.success) {
        setAvailableProfiles(res.profiles);
        if (res.profiles.length === 0) {
          setProfilesFetchError(
            "No business locations were found for this Google account. Ensure your Google account has verified business locations in Google Business Profile."
          );
        }
      } else {
        setProfilesFetchError(res.error || "Failed to fetch available profiles from Google.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error querying Google Business Profiles";
      setProfilesFetchError(msg);
    } finally {
      setIsLoadingProfiles(false);
    }
  }, [activeWorkspaceId]);

  // Trigger profile fetch when isSelectingProfile becomes true
  useEffect(() => {
    let isMounted = true;
    if (isSelectingProfile && activeWorkspaceId) {
      Promise.resolve().then(() => {
        if (isMounted) fetchAvailableProfiles();
      });
    }
    return () => {
      isMounted = false;
    };
  }, [isSelectingProfile, activeWorkspaceId, fetchAvailableProfiles]);

  // Connect Google OAuth start
  const handleConnectGoogle = () => {
    if (!activeWorkspaceId) return;
    const startUrl = `/api/auth/google/start?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    window.location.assign(new URL(startUrl, window.location.origin).toString());
  };

  // User selects and activates ONE business profile
  const handleSelectProfile = async (profile: GoogleLocationProfile) => {
    if (!activeWorkspaceId || isSelectingId) return;

    setIsSelectingId(profile.googleLocationId);
    setActionErrorNotice(null);
    setActionSuccessNotice(null);

    try {
      const res = await selectSingleGoogleProfileAction(activeWorkspaceId, profile);
      if (res.success) {
        setActionSuccessNotice(
          `Successfully connected "${profile.name}". All reviews and dashboard analytics are now active for this business.`
        );
        setIsSelectingProfile(false);
        // Clean URL params
        router.replace("/dashboard/locations");
        await loadData();
        await refreshLocationContext();
      } else {
        setActionErrorNotice(res.error || "Failed to activate business profile.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to select business profile";
      setActionErrorNotice(msg);
    } finally {
      setIsSelectingId(null);
    }
  };

  // User explicitly disconnects the current profile
  const handleDisconnectProfile = async () => {
    if (!activeWorkspaceId || isDisconnecting) return;
    const confirmed = window.confirm(
      "Are you sure you want to disconnect this business profile? Automatic replies and review synchronization will be paused until a profile is reconnected."
    );
    if (!confirmed) return;

    setIsDisconnecting(true);
    setActionErrorNotice(null);
    setActionSuccessNotice(null);

    try {
      const res = await disconnectGoogleProfileAction(activeWorkspaceId);
      if (res.success) {
        setActionSuccessNotice("Business profile disconnected successfully.");
        await loadData();
        await refreshLocationContext();
      } else {
        setActionErrorNotice(res.error || "Failed to disconnect profile.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error disconnecting profile";
      setActionErrorNotice(msg);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Sync reviews ONLY for the active connected location
  const handleSyncActiveLocation = async () => {
    if (!activeWorkspaceId || isSyncing) return;

    setIsSyncing(true);
    setSyncResult(null);
    setActionErrorNotice(null);

    try {
      const res = await syncActiveLocationAction(activeWorkspaceId);
      setSyncResult(res);
      if (res.success) {
        await loadData();
        await refreshLocationContext();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      setSyncResult({ success: false, locationsCount: 0, reviewsCount: 0, message: "", error: msg });
    } finally {
      setIsSyncing(false);
    }
  };

  // Filter available profiles based on search query
  const filteredProfiles = useMemo(() => {
    if (!profileSearchQuery.trim()) return availableProfiles;
    const q = profileSearchQuery.toLowerCase();
    return availableProfiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.address && p.address.toLowerCase().includes(q)) ||
        (p.googlePlaceId && p.googlePlaceId.toLowerCase().includes(q))
    );
  }, [availableProfiles, profileSearchQuery]);

  return (
    <div className="space-y-6 max-w-7xl w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Locations</h2>
          <p className="text-slate-500 text-sm">
            Manage your connected Google Business Profile for workspace &ldquo;{activeWorkspace?.name || "Active"}&rdquo;.
          </p>
        </div>

        {integration.isConnected && activeLocation && !isSelectingProfile && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSelectingProfile(true)}
              className="text-xs text-blue-700 border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 h-9"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
              Change Business Profile
            </Button>
          </div>
        )}
      </div>

      {/* OAuth Callback Success / Error Notifications */}
      {googleSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl flex items-start text-sm shadow-sm">
          <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-green-600" />
          <div>
            <strong>Google Business Profile Notice</strong>
            <p className="mt-0.5 text-green-700">
              {googleSuccess === "1" ? "Google OAuth authorization completed successfully." : googleSuccess}
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

      {/* Action Notices */}
      {actionSuccessNotice && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl flex items-start text-sm shadow-sm">
          <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-green-600" />
          <div className="flex-1">
            <strong>Success</strong>
            <p className="mt-0.5 text-green-700 text-xs">{actionSuccessNotice}</p>
          </div>
          <button
            onClick={() => setActionSuccessNotice(null)}
            className="text-green-600 hover:text-green-800 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionErrorNotice && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start text-sm shadow-sm">
          <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1">
            <strong>Error</strong>
            <p className="mt-0.5 text-red-700 text-xs">{actionErrorNotice}</p>
          </div>
          <button
            onClick={() => setActionErrorNotice(null)}
            className="text-red-600 hover:text-red-800 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live Sync Results Notifications */}
      {syncResult && (
        <div
          className={`p-4 rounded-xl flex items-start text-sm shadow-sm border ${
            syncResult.success
              ? "bg-blue-50/80 border-blue-200 text-blue-900"
              : "bg-red-50/80 border-red-200 text-red-900"
          }`}
        >
          {syncResult.success ? (
            <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-blue-600" />
          ) : (
            <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-red-600" />
          )}
          <div className="space-y-2 flex-1">
            <div className="flex items-center justify-between">
              <strong className="font-semibold">{syncResult.success ? "Google Sync Completed" : "Sync Failed"}</strong>
              {syncResult.lastSyncedAt && (
                <span className="text-xs text-slate-500">
                  Last synced: {new Date(syncResult.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <p className="text-xs">{syncResult.success ? syncResult.message : syncResult.error}</p>
            {syncResult.success && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="bg-white border border-blue-200 px-2.5 py-1 rounded-md text-blue-800 font-medium">
                  Fetched: {syncResult.reviewsCount}
                </span>
                <span className="bg-white border border-emerald-200 px-2.5 py-1 rounded-md text-emerald-800 font-medium">
                  New: {syncResult.newReviewsCount ?? 0}
                </span>
                <span className="bg-white border border-amber-200 px-2.5 py-1 rounded-md text-amber-800 font-medium">
                  Updated: {syncResult.updatedReviewsCount ?? 0}
                </span>
                <span className="bg-white border border-slate-200 px-2.5 py-1 rounded-md text-slate-700 font-medium">
                  Unchanged: {syncResult.skippedReviewsCount ?? 0}
                </span>
              </div>
            )}
            {syncResult.reviewsMessage && syncResult.reviewsMessage !== syncResult.message && (
              <p className="text-xs text-blue-700 bg-blue-100/60 p-2 rounded mt-1.5 flex items-start gap-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                <span>{syncResult.reviewsMessage}</span>
              </p>
            )}
          </div>
          <button
            onClick={() => setSyncResult(null)}
            className="text-slate-400 hover:text-slate-600 p-1 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW A: PROFILE SELECTION SCREEN (When user connects or clicks Change)   */}
      {/* ========================================================================= */}
      {isSelectingProfile && (
        <Card className="border-blue-200 bg-white shadow-md">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-blue-50/70 via-indigo-50/30 to-white pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  Select a Business Profile to Continue
                </CardTitle>
                <CardDescription className="text-xs text-slate-600 mt-1">
                  Choose the specific business profile you want to connect to this NexRep workspace.
                  Exactly <strong>one</strong> profile is connected at a time.
                </CardDescription>
              </div>

              {activeLocation && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSelectingProfile(false)}
                  className="h-8 text-xs text-slate-500 hover:text-slate-700"
                >
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              )}
            </div>

            {/* Profile search filter */}
            {availableProfiles.length > 2 && (
              <div className="mt-3 relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={profileSearchQuery}
                  onChange={(e) => setProfileSearchQuery(e.target.value)}
                  placeholder="Filter available profiles by name or address..."
                  className="pl-9 h-8 text-xs bg-white border-slate-200"
                />
              </div>
            )}
          </CardHeader>

          <CardContent className="pt-6">
            {isLoadingProfiles ? (
              <div className="py-12 text-center">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
                <h4 className="font-medium text-slate-900 text-sm">Fetching your Google Business Profiles...</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Retrieving available locations from your authorized Google account.
                </p>
              </div>
            ) : profilesFetchError ? (
              <div className="rounded-xl border border-red-200 bg-red-50/60 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-2" />
                <h4 className="font-semibold text-red-900 text-sm">Unable to Load Profiles</h4>
                <p className="text-xs text-red-700 mt-1 max-w-md mx-auto">{profilesFetchError}</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={fetchAvailableProfiles}
                    className="text-xs border-red-300 text-red-800 hover:bg-red-100/50 shadow-2xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConnectGoogle}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs"
                  >
                    Reconnect Google Account
                  </Button>
                </div>
              </div>
            ) : availableProfiles.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
                <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <h4 className="font-medium text-slate-900 text-sm">No business profiles available</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Your Google account was authenticated, but no verified business locations were returned.
                </p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={handleConnectGoogle}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs"
                  >
                    Connect Another Google Account
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                  <span>Available Google Business Profiles ({filteredProfiles.length})</span>
                  <span>Select one to activate for this workspace</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredProfiles.map((prof) => {
                    const isCurrent = activeLocation?.google_location_id === prof.googleLocationId;
                    const isSavingThis = isSelectingId === prof.googleLocationId;

                    return (
                      <div
                        key={prof.googleLocationId}
                        className={`rounded-xl border p-4 transition-all flex flex-col justify-between ${
                          isCurrent
                            ? "border-blue-500 bg-blue-50/40 shadow-xs ring-1 ring-blue-500"
                            : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm"
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                                <Building2 className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-semibold text-sm text-slate-900 truncate">{prof.name}</h4>
                                {prof.accountTitle && (
                                  <span className="text-[10px] text-slate-500 block truncate">
                                    Account: {prof.accountTitle}
                                  </span>
                                )}
                              </div>
                            </div>

                            {isCurrent && (
                              <Badge className="border-blue-300 text-blue-700 bg-blue-100 text-[10px] shrink-0 font-medium">
                                Active Profile
                              </Badge>
                            )}
                          </div>

                          <div className="space-y-1.5 mt-3 text-xs text-slate-600">
                            {prof.address && (
                              <div className="flex items-start gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                <span className="line-clamp-2">{prof.address}</span>
                              </div>
                            )}
                            {prof.phone && (
                              <div className="flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{prof.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="font-mono text-[10px] text-slate-400 truncate max-w-[140px]">
                            {prof.googlePlaceId ? `Place ID: ${prof.googlePlaceId}` : prof.googleLocationId}
                          </span>

                          <Button
                            size="sm"
                            disabled={Boolean(isSelectingId) || isCurrent}
                            onClick={() => handleSelectProfile(prof)}
                            className={`h-7 px-3 text-xs font-medium ${
                              isCurrent
                                ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-default"
                                : "bg-slate-900 hover:bg-slate-800 text-white shadow-xs"
                            }`}
                          >
                            {isSavingThis ? (
                              <RefreshCw className="w-3 h-3 animate-spin mr-1.5" />
                            ) : isCurrent ? (
                              <Check className="w-3 h-3 mr-1" />
                            ) : (
                              <ArrowRight className="w-3 h-3 mr-1" />
                            )}
                            {isCurrent ? "Connected" : isSavingThis ? "Connecting..." : "Connect This Profile"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* VIEW B: CONNECTED BUSINESS PROFILE (Active Single Location)               */}
      {/* ========================================================================= */}
      {integration.isConnected && activeLocation ? (
        <div className="space-y-6">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Connected Business Profile
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Workspace &ldquo;{activeWorkspace?.name || "Active"}&rdquo; is actively using this single Google Business Profile.
                  </CardDescription>
                </div>
                <Badge className="border-green-200 text-green-700 bg-green-50 text-xs font-medium">
                  <Check className="w-3 h-3 mr-1" /> Active & Connected
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Profile Details Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900 truncate">{activeLocation.name}</h3>
                        <p className="text-xs text-slate-500">Google Business Profile Listing</p>
                      </div>
                    </div>

                    <div className="space-y-1 pt-2 text-xs text-slate-600 pl-11">
                      {activeLocation.address && (
                        <div className="flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span>{activeLocation.address}</span>
                        </div>
                      )}
                      {activeLocation.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{activeLocation.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-100 shrink-0">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">
                        Google Account
                      </span>
                      <span className="font-medium text-slate-800 text-[11px] truncate block max-w-[180px]">
                        {integration.accountName || "Connected Account"}
                      </span>
                    </div>
                    {activeLocation.google_location_id && (
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">
                          Location ID
                        </span>
                        <span className="font-mono text-[10px] text-slate-700 block truncate max-w-[180px]">
                          {activeLocation.google_location_id}
                        </span>
                      </div>
                    )}
                    {activeLocation.google_place_id && (
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">
                          Place ID
                        </span>
                        <span className="font-mono text-[10px] text-slate-700 block truncate max-w-[180px]">
                          {activeLocation.google_place_id}
                        </span>
                      </div>
                    )}
                    {activeLocation.updated_at && (
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">
                          Last Synchronized
                        </span>
                        <span className="text-[10px] text-slate-700 block font-medium">
                          {new Date(activeLocation.updated_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <Button
                  onClick={handleSyncActiveLocation}
                  disabled={isSyncing || isLoadingData}
                  className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-all h-8 px-3.5"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing Reviews..." : "Sync Reviews"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setIsSelectingProfile(true)}
                  disabled={isSyncing}
                  className="text-slate-700 border-slate-200 bg-white hover:bg-slate-50 shadow-2xs text-xs font-medium h-8 px-3"
                >
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 text-slate-700" />
                  Change Business Profile
                </Button>

                <Button
                  variant="outline"
                  onClick={handleConnectGoogle}
                  disabled={isSyncing}
                  className="text-slate-700 border-slate-200 bg-white hover:bg-slate-50 shadow-2xs text-xs font-medium h-8 px-3"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                  Connect Another Google Account
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleDisconnectProfile}
                  disabled={isDisconnecting || isSyncing}
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 text-xs ml-auto h-8 px-3 font-medium"
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  {isDisconnecting ? "Disconnecting..." : "Disconnect Profile"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : integration.isConnected && !activeLocation ? (
        /* ========================================================================= */
        /* VIEW C: GOOGLE ACCOUNT CONNECTED, BUT NO PROFILE SELECTED YET             */
        /* ========================================================================= */
        <Card className="border-amber-200 bg-amber-50/40 rounded-2xl shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-amber-900 flex items-center gap-2 text-base">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  Google Account Authenticated - Profile Selection Required
                </CardTitle>
                <CardDescription className="text-amber-700 text-xs">
                  Your Google account ({integration.accountName || "Authorized"}) is connected, but you have not yet selected a business profile for this workspace.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600">
              NexRep connects exactly one business profile per workspace to guarantee strict data isolation,
              review synchronization, and safe automatic reply publishing.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button
                onClick={() => setIsSelectingProfile(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs h-9 px-4"
              >
                <Building2 className="mr-1.5 h-3.5 w-3.5" />
                Select Business Profile Now
              </Button>
              <Button
                variant="outline"
                onClick={handleConnectGoogle}
                className="text-slate-700 border-slate-200 bg-white hover:bg-slate-50 shadow-2xs text-xs font-medium h-9 px-3.5"
              >
                Connect Another Google Account
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ========================================================================= */
        /* VIEW D: NO GOOGLE ACCOUNT CONNECTED                                       */
        /* ========================================================================= */
        <Card className="border-slate-200/90 rounded-2xl shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Connect a Location</CardTitle>
                <CardDescription>
                  Link your Google Business Profile to start syncing reviews and locations.
                </CardDescription>
              </div>
              {activeWorkspace && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 font-medium">
                  <Building2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>Workspace: {activeWorkspace.name}</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center bg-slate-50/50">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <MapPin className="h-7 w-7 text-slate-700" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">No business profile connected</h3>
              <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                {activeWorkspace
                  ? `Connect your Google Business Profile for "${activeWorkspace.name}" to import reviews and enable AI reply automation.`
                  : isMigrationPending
                  ? "Multi-tenant database tables are not yet initialized in Supabase. Please apply the schema migration first."
                  : "No active workspace is currently selected. Please set up or choose a workspace above."}
              </p>
              <div className="mt-6">
                <Button
                  onClick={handleConnectGoogle}
                  disabled={isLoadingData || isWorkspaceLoading || !activeWorkspaceId}
                  className="bg-slate-900 hover:bg-slate-800 text-white shadow-xs font-medium h-10 px-5"
                >
                  <Plus className="mr-2 h-4 w-4" /> Connect Google Business Profile
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${className}`}
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
