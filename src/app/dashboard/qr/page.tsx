"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  QrCode,
  MapPin,
  ExternalLink,
  Download,
  Printer,
  Copy,
  Check,
  Plus,
  RefreshCw,
  Sparkles,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Info,
  SlidersHorizontal,
  X,
  FileDown,
  BarChart2,
  MousePointerClick,
  Scan,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getQrStudioDataAction,
  saveQrCodeAction,
  getQrAssetsAction,
  QrStudioPageData,
} from "./actions";
import { QrCodeRecord } from "@/lib/qr-service";

export default function QrStudioPage() {
  const { activeWorkspaceId } = useWorkspace();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<QrStudioPageData | null>(null);
  const [selectedQr, setSelectedQr] = useState<QrCodeRecord | null>(null);
  const [qrAssets, setQrAssets] = useState<{ svg?: string; dataUrl?: string }>({});

  // Modals & Panels
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    id: "",
    locationId: "",
    title: "Review Us on Google",
    callToAction: "We value your honest feedback! Tap below to share your experience on our official Google review page.",
    customGoogleReviewUrl: "",
    isActive: true,
  });

  // UI Feedback
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Live Simulator preview state
  const [simulatedStyle, setSimulatedStyle] = useState<"short" | "detailed" | "natural">("natural");

  // Load Data
  const loadData = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsLoading(true);
    setNotice(null);
    try {
      const res = await getQrStudioDataAction(activeWorkspaceId);
      setData(res);
      if (res.success && res.overview?.qrCodes && res.overview.qrCodes.length > 0) {
        setSelectedQr(res.overview.qrCodes[0]);
      } else {
        setSelectedQr(null);
      }
      if (!res.success && res.error) {
        setNotice({ type: "error", message: res.error });
      }
    } catch (err: unknown) {
      setNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load QR Studio data.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        loadData();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  // Load QR visual assets when selected QR changes
  const selectedSlug = selectedQr?.publicSlug;
  useEffect(() => {
    let isCurrent = true;
    if (!selectedSlug) {
      Promise.resolve().then(() => {
        if (isCurrent) setQrAssets({});
      });
      return;
    }
    getQrAssetsAction(selectedSlug).then((res) => {
      if (isCurrent && res.success) {
        setQrAssets({ svg: res.svg, dataUrl: res.dataUrl });
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [selectedSlug]);

  const handleOpenCreateModal = () => {
    const defaultLocation = data?.locations?.find((l) => l.isConnected) || data?.locations?.[0];
    setFormData({
      id: "",
      locationId: defaultLocation?.id || "",
      title: "Review Us on Google",
      callToAction: "We value your honest feedback! Tap below to share your genuine experience on our official Google review page.",
      customGoogleReviewUrl: "",
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (qr: QrCodeRecord) => {
    setFormData({
      id: qr.id,
      locationId: qr.locationId,
      title: qr.title,
      callToAction: qr.callToAction,
      customGoogleReviewUrl: qr.customGoogleReviewUrl || "",
      isActive: qr.isActive,
    });
    setIsModalOpen(true);
  };

  const handleSaveQr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    if (!formData.locationId) {
      setNotice({ type: "error", message: "Please select a location for this QR code." });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const res = await saveQrCodeAction({
        id: formData.id || undefined,
        workspaceId: activeWorkspaceId,
        locationId: formData.locationId,
        title: formData.title.trim(),
        callToAction: formData.callToAction.trim(),
        customGoogleReviewUrl: formData.customGoogleReviewUrl.trim() || null,
        isActive: formData.isActive,
      });

      if (!res.success) {
        setNotice({ type: "error", message: res.error || "Failed to save QR code." });
      } else {
        setNotice({
          type: "success",
          message: formData.id ? "QR code updated successfully!" : "New QR code generated successfully!",
        });
        setIsModalOpen(false);
        await loadData();
      }
    } catch (err: unknown) {
      setNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save QR code.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async (slug: string) => {
    const origin = data?.publicOrigin || window.location.origin;
    const url = `${origin}/review/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadPng = (slug: string, locationName: string) => {
    if (!qrAssets.dataUrl) return;
    const a = document.createElement("a");
    a.href = qrAssets.dataUrl;
    a.download = `Google-Review-QR-${locationName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadSvg = (slug: string, locationName: string) => {
    if (!qrAssets.svg) return;
    const blob = new Blob([qrAssets.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Google-Review-QR-${locationName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const overview = data?.overview;
  const qrCodes = overview?.qrCodes || [];
  const publicOrigin = data?.publicOrigin || "";

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-800/10 text-emerald-800 rounded-xl">
              <QrCode className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                QR Review Studio
              </h1>
              <p className="text-sm text-slate-500">
                Empower in-store customers to share genuine feedback on Google with AI assistance & 0 friction.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            onClick={handleOpenCreateModal}
            className="bg-[#0B3B2C] hover:bg-[#082D22] text-white text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Create QR Code
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {notice && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            notice.type === "success"
              ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center justify-between">
              Active QR Codes
              <QrCode className="w-4 h-4 text-emerald-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">
              {overview?.totalQrCodes ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-slate-500">Live review entry points</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center justify-between">
              Total Customer Scans
              <Scan className="w-4 h-4 text-blue-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">
              {overview?.totalScans ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-slate-500">Customers landed on review page</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center justify-between">
              Continued to Google
              <MousePointerClick className="w-4 h-4 text-amber-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">
              {overview?.totalGoogleClicks ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-slate-500">Redirected to official Google form</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center justify-between">
              Google Conversion Rate
              <BarChart2 className="w-4 h-4 text-emerald-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">
              {overview?.overallCtr ?? 0}%
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-slate-500">Scan-to-Google intent rate</p>
          </CardContent>
        </Card>
      </div>

      {/* FTC & Google Anti-Gating Compliance Notice */}
      <div className="rounded-xl border border-emerald-900/10 bg-emerald-50/60 p-4 text-xs text-emerald-900 flex items-start gap-3">
        <Info className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-emerald-950">
            FTC & Google Non-Gating Compliance Guarantee
          </p>
          <p className="text-emerald-800/90 leading-relaxed">
            All customer QR landing pages are 100% neutral. Every customer has immediate, unhindered access to your official Google review form regardless of rating. NexRep does not filter sentiment, incentivize reviews, or fake submissions.
          </p>
        </div>
      </div>

      {/* Main Studio Grid: QR List + Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: QR Code Cards / Table (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Your Google Business QR Codes ({qrCodes.length})
            </h2>
            {qrCodes.length > 0 && (
              <span className="text-xs text-slate-400">
                Click a card to preview and export
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
              Loading your QR codes...
            </div>
          ) : data && !data.success ? (
            <div className="p-8 text-center bg-amber-50/70 rounded-2xl border border-amber-200/90 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-sm font-bold text-amber-950">Database Setup Required</h3>
                <p className="text-xs text-amber-900/90 leading-relaxed">
                  {data.error}
                </p>
              </div>
            </div>
          ) : qrCodes.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-center mx-auto">
                <QrCode className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-sm font-bold text-slate-900">No QR Codes Generated Yet</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Generate your first smart QR code for any connected Google Business location. Place it on your front desk, counters, menus, or receipts to capture genuine customer reviews.
                </p>
              </div>
              <Button
                onClick={handleOpenCreateModal}
                className="bg-[#0B3B2C] hover:bg-[#082D22] text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Generate First QR Code
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {qrCodes.map((qr) => {
                const isSelected = selectedQr?.id === qr.id;
                const publicUrl = `${publicOrigin}/review/${qr.publicSlug}`;
                const ctr = qr.scansCount > 0 ? Math.round((qr.googleClicksCount / qr.scansCount) * 100) : 0;

                return (
                  <div
                    key={qr.id}
                    onClick={() => setSelectedQr(qr)}
                    className={`cursor-pointer rounded-2xl border transition-all p-4 bg-white ${
                      isSelected
                        ? "border-emerald-600 ring-2 ring-emerald-500/20 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:shadow-2xs"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900 text-sm truncate">
                            {qr.locationName}
                          </h3>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold px-2 py-0 ${
                              qr.isActive
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-50 text-slate-500 border-slate-200"
                            }`}
                          >
                            {qr.isActive ? "Active" : "Paused"}
                          </Badge>
                          {qr.googlePlaceId && (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200"
                            >
                              Google Verified
                            </Badge>
                          )}
                        </div>

                        {qr.locationAddress && (
                          <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                            {qr.locationAddress}
                          </p>
                        )}

                        <div className="pt-2 flex items-center gap-4 text-xs text-slate-600">
                          <div>
                            <span className="font-semibold text-slate-900">{qr.scansCount}</span>
                            <span className="text-slate-400 ml-1">scans</span>
                          </div>
                          <div className="h-3 w-px bg-slate-200" />
                          <div>
                            <span className="font-semibold text-slate-900">{qr.googleClicksCount}</span>
                            <span className="text-slate-400 ml-1">Google clicks</span>
                          </div>
                          <div className="h-3 w-px bg-slate-200" />
                          <div>
                            <span className="font-semibold text-emerald-700">{ctr}%</span>
                            <span className="text-slate-400 ml-1">conversion</span>
                          </div>
                        </div>
                      </div>

                      {/* Small QR Thumbnail */}
                      <div className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center shrink-0 p-1">
                        <QrCode className="w-8 h-8 text-emerald-900" />
                      </div>
                    </div>

                    {/* Quick action bar */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyLink(qr.publicSlug);
                          }}
                          className="h-7 px-2 text-xs text-slate-600 hover:text-slate-900"
                        >
                          {copiedSlug === qr.publicSlug ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600 mr-1" />
                              <span className="text-emerald-700 font-medium">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              Copy Link
                            </>
                          )}
                        </Button>

                        <a
                          href={publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center text-xs text-slate-600 hover:text-emerald-700 h-7 px-2 rounded-md hover:bg-slate-100 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Test Landing Page
                        </a>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedQr(qr);
                            setIsPrintModalOpen(true);
                          }}
                          className="h-7 px-2.5 text-xs text-emerald-800 border-emerald-200 hover:bg-emerald-50"
                        >
                          <Printer className="w-3 h-3 mr-1 text-emerald-700" />
                          Print Standee
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditModal(qr);
                          }}
                          className="h-7 px-2 text-xs text-slate-600 hover:text-slate-900"
                        >
                          <SlidersHorizontal className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Live Mobile Mockup & Asset Exporter (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-700" />
              Live Customer Experience Preview
            </h2>
            {selectedQr && (
              <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                Real-time Mockup
              </span>
            )}
          </div>

          {selectedQr ? (
            <div className="space-y-4">
              {/* Asset Export Bar */}
              <Card className="border-slate-200/90 bg-white shadow-2xs">
                <CardContent className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {selectedQr.locationName}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono truncate">
                      /review/{selectedQr.publicSlug}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadPng(selectedQr.publicSlug, selectedQr.locationName)}
                      disabled={!qrAssets.dataUrl}
                      className="h-8 text-xs font-medium border-slate-200 hover:bg-slate-50 text-slate-700"
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      PNG
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadSvg(selectedQr.publicSlug, selectedQr.locationName)}
                      disabled={!qrAssets.svg}
                      className="h-8 text-xs font-medium border-slate-200 hover:bg-slate-50 text-slate-700"
                    >
                      <FileDown className="w-3.5 h-3.5 mr-1" />
                      SVG
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setIsPrintModalOpen(true)}
                      className="h-8 text-xs font-semibold bg-[#0B3B2C] hover:bg-[#082D22] text-white"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1" />
                      Print Card
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Smartphone Frame Mockup */}
              <div className="relative mx-auto max-w-[340px] rounded-[36px] p-3 bg-slate-900 shadow-2xl ring-1 ring-slate-800">
                {/* Speaker notch */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 h-4 w-28 bg-slate-800 rounded-full z-20 flex items-center justify-center">
                  <div className="w-10 h-1 bg-slate-700 rounded-full" />
                </div>

                {/* Inner Screen */}
                <div className="relative rounded-[28px] overflow-hidden bg-slate-50 border border-slate-200 text-slate-900 pt-7 pb-5 px-4 font-sans select-none min-h-[520px] flex flex-col justify-between">
                  {/* Business Header */}
                  <div className="text-center space-y-1.5">
                    <div className="w-12 h-12 rounded-xl bg-[#0B3B2C] text-white flex items-center justify-center mx-auto shadow-sm font-bold text-sm">
                      {selectedQr.locationName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-slate-900 text-sm leading-tight">
                        {selectedQr.locationName}
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        {selectedQr.locationAddress || "Official Google Review Partner"}
                      </p>
                    </div>

                    <div className="pt-1">
                      <h5 className="font-semibold text-xs text-slate-800">
                        {selectedQr.title}
                      </h5>
                      <p className="text-[10px] text-slate-500 leading-snug px-2">
                        {selectedQr.callToAction}
                      </p>
                    </div>
                  </div>

                  {/* 5-Star Rating Preview */}
                  <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs space-y-2 my-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">
                      Rate Your Experience
                    </p>
                    <div className="flex justify-center gap-1.5 text-amber-400">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span key={star} className="text-xl">★</span>
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-400 px-1">
                      <span>Poor</span>
                      <span>Great</span>
                    </div>
                  </div>

                  {/* AI Suggestion Multi-Style Simulator */}
                  <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        AI Review Assistant
                      </span>
                      <span className="text-[9px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-medium">
                        Optional
                      </span>
                    </div>

                    {/* Style selector pills */}
                    <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 rounded-lg text-[9px] font-semibold text-center">
                      <button
                        type="button"
                        onClick={() => setSimulatedStyle("short")}
                        className={`py-1 rounded-md transition-colors ${
                          simulatedStyle === "short" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                        }`}
                      >
                        Short
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimulatedStyle("detailed")}
                        className={`py-1 rounded-md transition-colors ${
                          simulatedStyle === "detailed" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                        }`}
                      >
                        Detailed
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimulatedStyle("natural")}
                        className={`py-1 rounded-md transition-colors ${
                          simulatedStyle === "natural" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                        }`}
                      >
                        Natural
                      </button>
                    </div>

                    {/* Sample draft preview */}
                    <div className="bg-slate-50 rounded-lg p-2 border border-slate-200 text-[10px] text-slate-700 leading-relaxed italic">
                      {simulatedStyle === "short" &&
                        `"Quick and professional service at ${selectedQr.locationName}. Highly recommend!"`}
                      {simulatedStyle === "detailed" &&
                        `"I had a fantastic experience visiting ${selectedQr.locationName}. The team was attentive, knowledgeable, and delivered exceptional quality throughout."`}
                      {simulatedStyle === "natural" &&
                        `"Really happy with my experience here today. Clean space, welcoming staff, and everything was taken care of seamlessly."`}
                    </div>
                  </div>

                  {/* Continue to Google Button Mockup */}
                  <div className="space-y-1.5 pt-2">
                    <div className="w-full py-2.5 rounded-xl bg-[#0B3B2C] text-white text-xs font-semibold text-center shadow-xs flex items-center justify-center gap-1.5">
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy & Continue to Google</span>
                    </div>
                    <p className="text-[9px] text-slate-400 text-center">
                      Copies review & opens official Google review page
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
              Select a QR code from the list to preview its live mobile customer page.
            </div>
          )}
        </div>
      </div>

      {/* CREATE / EDIT QR CODE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-900 font-sans"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-[#0B2E22] text-white">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">
                  {formData.id ? "Edit QR Code Settings" : "Generate New QR Review Code"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-emerald-300 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQr} className="p-6 space-y-4 text-xs">
              {/* Location Selector */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">
                  Google Business Profile Location <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.locationId}
                  onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
                  disabled={Boolean(formData.id)}
                  className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="" disabled>Select a location...</option>
                  {(data?.locations || []).map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.isConnected ? "(Connected)" : "(Sync pending)"}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Customers who scan this code will be directed to this location&apos;s verified Google reviews page.
                </p>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">Page Headline</label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Review Us on Google"
                  className="h-9 text-xs"
                  required
                />
              </div>

              {/* Call to action */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">Call to Action Subtitle</label>
                <Textarea
                  value={formData.callToAction}
                  onChange={(e) => setFormData({ ...formData, callToAction: e.target.value })}
                  placeholder="Share your genuine feedback with future customers..."
                  className="text-xs resize-none h-18"
                  required
                />
              </div>

              {/* Custom Google Review URL override (optional) */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">
                  Custom Google Review Link (Optional)
                </label>
                <Input
                  value={formData.customGoogleReviewUrl}
                  onChange={(e) => setFormData({ ...formData, customGoogleReviewUrl: e.target.value })}
                  placeholder="https://g.page/r/.../review or leave blank to use automatic Google Place ID"
                  className="h-9 text-xs font-mono"
                />
                <p className="text-[11px] text-slate-500">
                  Leave empty to automatically use the official verified Place ID review destination.
                </p>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <p className="font-semibold text-slate-900 text-xs">Active Status</p>
                  <p className="text-[11px] text-slate-500">
                    When inactive, scanning will show a maintenance notice.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="h-9 text-xs font-semibold bg-[#0B3B2C] hover:bg-[#082D22] text-white"
                >
                  {isSaving ? "Saving..." : formData.id ? "Update QR Code" : "Create QR Code"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINTABLE COUNTER CARD / TABLE TENT MODAL */}
      {isPrintModalOpen && selectedQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-900 font-sans"
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-[#0B2E22] text-white">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">Printable Table Tent / Counter Standee</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="text-emerald-300 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Printable Area Preview */}
            <div className="p-6 max-h-[75vh] overflow-y-auto">
              <div
                id="printable-standee-card"
                className="mx-auto max-w-[360px] p-6 rounded-2xl border-2 border-slate-900 bg-white text-center space-y-4 shadow-sm"
              >
                {/* Branding Badge */}
                <div className="flex items-center justify-center gap-1.5 text-[#0B3B2C] font-bold text-xs tracking-wider uppercase">
                  <span>★ Google Verified Partner ★</span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-lg font-extrabold text-slate-950 leading-tight">
                    {selectedQr.locationName}
                  </h3>
                  <p className="text-xs text-slate-600 font-medium">
                    {selectedQr.title}
                  </p>
                </div>

                {/* High Contrast QR Code Display */}
                <div className="p-3 bg-white border-2 border-slate-900 rounded-2xl inline-block shadow-xs">
                  {qrAssets.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrAssets.dataUrl}
                      alt="Google Review QR Code"
                      className="w-48 h-48 mx-auto"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-slate-400">
                      <QrCode className="w-24 h-24" />
                    </div>
                  )}
                </div>

                {/* 5-Star Graphics */}
                <div className="flex justify-center gap-1 text-amber-500 text-xl font-bold">
                  ★★★★★
                </div>

                {/* 3 Step Instruction Guide */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-1.5 text-[11px] text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[#0B3B2C] text-white flex items-center justify-center text-[9px] font-bold shrink-0">1</span>
                    <span>Point phone camera at this QR code</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[#0B3B2C] text-white flex items-center justify-center text-[9px] font-bold shrink-0">2</span>
                    <span>Share your genuine thoughts (with optional AI)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[#0B3B2C] text-white flex items-center justify-center text-[9px] font-bold shrink-0">3</span>
                    <span>Tap to post directly on Google</span>
                  </div>
                </div>

                <p className="text-[9px] text-slate-400 font-medium">
                  Official Google Business Profile Review Link • Powered by NexRep
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadPng(selectedQr.publicSlug, selectedQr.locationName)}
                className="text-xs"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Download Graphic
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="text-xs"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => window.print()}
                  className="bg-[#0B3B2C] hover:bg-[#082D22] text-white text-xs font-semibold"
                >
                  <Printer className="w-3.5 h-3.5 mr-1" />
                  Print Counter Card
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
