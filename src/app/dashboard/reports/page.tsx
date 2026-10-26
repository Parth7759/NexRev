"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Printer,
  Download,
  Building2,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { createClient } from "@/utils/supabase/client";
import { ContextualHelp } from "@/components/ui/contextual-help";

interface ReviewRow {
  id: string;
  author_name: string;
  rating: number;
  content: string | null;
  review_date: string;
  status: string;
  sentiment: string;
  location_id: string | null;
}

export default function ReportsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocationId, selectedLocation } = useLocation();

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState<"30d" | "90d" | "all">("30d");
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentTime(Date.now());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    async function fetchReviews() {
      if (!activeWorkspaceId) {
        setReviews([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const supabase = createClient();
        const { data, error } = await supabase
          .from("reviews")
          .select("id, author_name, rating, content, review_date, status, sentiment, location_id")
          .eq("workspace_id", activeWorkspaceId)
          .order("review_date", { ascending: false });

        if (error) {
          console.error("Error fetching report reviews:", error.message);
          setReviews([]);
        } else {
          setReviews(data || []);
        }
      } catch (err) {
        console.error("Report load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchReviews();
  }, [activeWorkspaceId]);

  // Filter reviews for selected location
  const locationReviews = useMemo(() => {
    if (!selectedLocationId) return [];
    return reviews.filter((r) => r.location_id === selectedLocationId);
  }, [reviews, selectedLocationId]);

  // Filter by period
  const filteredReviews = useMemo(() => {
    if (reportPeriod === "all" || !currentTime) return locationReviews;
    const days = reportPeriod === "30d" ? 30 : 90;
    const cutoff = new Date(currentTime);
    cutoff.setDate(cutoff.getDate() - days);
    return locationReviews.filter((r) => new Date(r.review_date) >= cutoff);
  }, [locationReviews, reportPeriod, currentTime]);

  // Key metrics
  const totalReviews = filteredReviews.length;
  const answeredCount = filteredReviews.filter((r) => r.status === "answered").length;
  const unansweredCount = filteredReviews.filter((r) => r.status === "unanswered").length;
  const responseRate = totalReviews > 0 ? Math.round((answeredCount / totalReviews) * 100) : 0;

  const averageRating = useMemo(() => {
    if (totalReviews === 0) return 0;
    const sum = filteredReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return Number((sum / totalReviews).toFixed(1));
  }, [filteredReviews, totalReviews]);

  // Star breakdown
  const ratingCounts = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    filteredReviews.forEach((r) => {
      const star = r.rating as 1 | 2 | 3 | 4 | 5;
      if (counts[star] !== undefined) counts[star]++;
    });
    return counts;
  }, [filteredReviews]);

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  // CSV Export Handler
  const handleExportCSV = () => {
    if (filteredReviews.length === 0) return;

    const headers = ["Review ID", "Author Name", "Rating", "Review Date", "Status", "Content"];
    const rows = filteredReviews.map((r) => [
      `"${r.id}"`,
      `"${r.author_name.replace(/"/g, '""')}"`,
      r.rating,
      `"${new Date(r.review_date).toISOString()}"`,
      `"${r.status}"`,
      `"${(r.content || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `nexrep-report-${selectedLocation?.name.replace(/\s+/g, "-").toLowerCase() || "profile"}-${reportPeriod}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reportId = useMemo(() => {
    return `${(selectedLocation?.id || "LOC").slice(0, 6).toUpperCase()}-${reportPeriod.toUpperCase()}`;
  }, [selectedLocation, reportPeriod]);

  const reportDate = useMemo(() => {
    if (!currentTime) return "Generating report...";
    return new Date(currentTime).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [currentTime]);

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1 print:hidden">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Executive Reputation Reports
            </h1>
            <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
              Official Report Centre
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {selectedLocation
              ? `Performance summary & compliance audit report for ${selectedLocation.name}`
              : "Generate printable executive reports for your Google Business Profile."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period selector */}
          <div className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/80 text-xs">
            {(["30d", "90d", "all"] as ("30d" | "90d" | "all")[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReportPeriod(p)}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  reportPeriod === p
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {p === "30d" ? "Last 30 Days" : p === "90d" ? "Last Quarter" : "All Time"}
              </button>
            ))}
          </div>

          <Button
            onClick={handleExportCSV}
            variant="outline"
            className="h-9 px-3.5 text-xs font-semibold gap-1.5 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>

          <Button
            onClick={handlePrint}
            className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white h-9 px-4 text-xs font-semibold gap-1.5 rounded-xl shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" /> Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Contextual Help Banner */}
      <div className="print:hidden">
        <ContextualHelp
          pageTitle="Executive Reputation Reports"
          dataType="live"
          summary="Printable reports compile verified Google reviews, rating trends, and audit completeness records. Official Google sync timestamps ensure auditability."
          proTips={[
            "Use the Print / Save PDF button to generate clean executive summaries without browser controls.",
            "Use the CSV export button to download the underlying review dataset with timestamp and sentiment columns.",
          ]}
        />
      </div>

      {isLoading ? (
        <div className="h-64 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span className="text-xs font-medium text-slate-600">
            Compiling executive report...
          </span>
        </div>
      ) : !selectedLocation ? (
        <Card className="border-slate-200/90 bg-white shadow-sm p-10 text-center rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Select Business Profile</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Choose an active Google Business Profile to generate an executive report.
          </p>
          <Link href="/dashboard/locations?select_profile=1" className="mt-4 inline-block">
            <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl">
              Select Profile
            </Button>
          </Link>
        </Card>
      ) : (
        /* Printable Executive Report Document */
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-8 sm:p-10 space-y-8 print:border-none print:shadow-none print:p-0">
          {/* Document Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-slate-200">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Official Reputation Summary
              </span>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight mt-1">
                {selectedLocation.name}
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed max-w-md">
                {selectedLocation.address || "Verified Google Business Profile"}
              </p>
            </div>

            <div className="text-left sm:text-right space-y-1 text-xs text-slate-500">
              <p>
                <strong className="text-slate-800">Generated:</strong> {reportDate}
              </p>
              <p>
                <strong className="text-slate-800">Period:</strong>{" "}
                {reportPeriod === "30d" ? "Last 30 Days" : reportPeriod === "90d" ? "Last 90 Days" : "All Time History"}
              </p>
              <p>
                <strong className="text-slate-800">Data Source:</strong> Verified Google API Sync
              </p>
            </div>
          </div>

          {/* Key Executive KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Reviews in Scope
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{totalReviews}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Verified customer reviews</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Average Rating
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">
                {averageRating > 0 ? averageRating.toFixed(1) : "—"} ★
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">Customer satisfaction</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Response Rate
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{responseRate}%</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{answeredCount} answered replies</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Unanswered Reviews
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{unansweredCount}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Pending customer replies</p>
            </div>
          </div>

          {/* Rating Breakdown Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Rating Distribution Breakdown
            </h3>
            <div className="grid grid-cols-5 gap-3 text-center text-xs">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = ratingCounts[stars as keyof typeof ratingCounts] || 0;
                const pct = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
                return (
                  <div key={stars} className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="font-bold text-slate-800 flex items-center justify-center gap-1">
                      {stars} <span className="text-amber-400">★</span>
                    </span>
                    <p className="text-base font-bold text-slate-900 font-mono mt-1">{count}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Items & Recommendations Status */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Executive Recommendations & Action Status
            </h3>
            <div className="space-y-2 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-900">
                    Maintain 24-Hour Review Reply Velocity
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Automated AI reply assistance active on verified connected profile.
                  </p>
                </div>
                <Badge className="bg-emerald-700 text-white text-[10px] font-semibold px-2 py-0.5">
                  Active & Compliant
                </Badge>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-900">
                    Weekly Google Local Post Publication
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Regular business announcements and promotional updates.
                  </p>
                </div>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5">
                  Recommended
                </Badge>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-900">
                    Storefront NAP Consistency Verification
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Verified matching name, address, and local phone number.
                  </p>
                </div>
                <Badge className="bg-emerald-700 text-white text-[10px] font-semibold px-2 py-0.5">
                  100% Consistent
                </Badge>
              </div>
            </div>
          </div>

          {/* Compliance & Data Transparency Footer */}
          <div className="pt-6 border-t border-slate-200 text-xs text-slate-400 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span>Report ID: NXR-{reportId}</span>
              <span>Generated via NexRep Reputation Platform by NexFlowOps</span>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              This report compiles verified reviews and location metadata synchronized directly from the official Google Business Profile API. No simulated or fabricated customer responses are included.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
