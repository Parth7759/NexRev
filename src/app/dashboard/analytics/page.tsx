"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Download,
  TrendingUp,
  TrendingDown,
  Eye,
  Search,
  Phone,
  Compass,
  Loader2,
  Building2,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { createClient } from "@/utils/supabase/client";
import {
  AreaTrendChart,
  RatingDistributionChart,
  SentimentDonutChart,
  TrendDataPoint,
} from "@/components/ui/charts";
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

type DateRangeOption = "7d" | "30d" | "90d" | "all";

export default function AnalyticsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocationId, selectedLocation } = useLocation();

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeOption>("30d");
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
          console.error("Error fetching analytics reviews:", error.message);
          setReviews([]);
        } else {
          setReviews(data || []);
        }
      } catch (err) {
        console.error("Analytics load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchReviews();
  }, [activeWorkspaceId]);

  // Filter reviews by selected location
  const locationReviews = useMemo(() => {
    if (!selectedLocationId) return [];
    return reviews.filter((r) => r.location_id === selectedLocationId);
  }, [reviews, selectedLocationId]);

  // Filter reviews by selected date range
  const filteredReviews = useMemo(() => {
    if (dateRange === "all" || !currentTime) return locationReviews;

    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    const cutoff = new Date(currentTime);
    cutoff.setDate(cutoff.getDate() - days);

    return locationReviews.filter((r) => new Date(r.review_date) >= cutoff);
  }, [locationReviews, dateRange, currentTime]);

  // Previous period reviews for comparison
  const previousPeriodReviews = useMemo(() => {
    if (dateRange === "all" || !currentTime) return [];

    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    const currentCutoff = new Date(currentTime);
    currentCutoff.setDate(currentCutoff.getDate() - days);

    const prevCutoff = new Date(currentTime);
    prevCutoff.setDate(prevCutoff.getDate() - days * 2);

    return locationReviews.filter((r) => {
      const d = new Date(r.review_date);
      return d >= prevCutoff && d < currentCutoff;
    });
  }, [locationReviews, dateRange, currentTime]);

  // Calculations
  const totalReviews = filteredReviews.length;
  const prevTotal = previousPeriodReviews.length;
  const reviewGrowth =
    prevTotal > 0
      ? Math.round(((totalReviews - prevTotal) / prevTotal) * 100)
      : totalReviews > 0
      ? 100
      : 0;

  const averageRating = useMemo(() => {
    if (totalReviews === 0) return 0;
    const sum = filteredReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return Number((sum / totalReviews).toFixed(1));
  }, [filteredReviews, totalReviews]);

  const prevAverage = useMemo(() => {
    if (prevTotal === 0) return 0;
    const sum = previousPeriodReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return Number((sum / prevTotal).toFixed(1));
  }, [previousPeriodReviews, prevTotal]);

  const ratingDiff = Number((averageRating - prevAverage).toFixed(1));

  const answeredCount = filteredReviews.filter((r) => r.status === "answered").length;
  const responseRate = totalReviews > 0 ? Math.round((answeredCount / totalReviews) * 100) : 0;

  // Rating Distribution
  const ratingDistribution = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    filteredReviews.forEach((r) => {
      const star = r.rating as 1 | 2 | 3 | 4 | 5;
      if (counts[star] !== undefined) counts[star]++;
    });
    return [5, 4, 3, 2, 1].map((stars) => {
      const count = counts[stars as keyof typeof counts] || 0;
      const percentage = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
      return { stars, count, percentage };
    });
  }, [filteredReviews, totalReviews]);

  // Sentiment Breakdown
  const sentimentCounts = useMemo(() => {
    let positive = 0;
    let neutral = 0;
    let negative = 0;
    filteredReviews.forEach((r) => {
      if (r.sentiment === "positive" || r.rating >= 4) positive++;
      else if (r.sentiment === "neutral" || r.rating === 3) neutral++;
      else negative++;
    });
    return { positive, neutral, negative };
  }, [filteredReviews]);

  // Trend line buckets
  const trendData: TrendDataPoint[] = useMemo(() => {
    if (filteredReviews.length === 0) {
      return [
        { label: "P1", value: 0 },
        { label: "P2", value: 0 },
        { label: "P3", value: 0 },
        { label: "P4", value: 0 },
      ];
    }

    const groups: Record<string, number> = {};
    const sorted = [...filteredReviews].sort(
      (a, b) => new Date(a.review_date).getTime() - new Date(b.review_date).getTime()
    );

    sorted.forEach((r) => {
      const d = new Date(r.review_date);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      groups[key] = (groups[key] || 0) + 1;
    });

    const entries = Object.entries(groups);
    if (entries.length <= 6) {
      return entries.map(([label, value]) => ({ label, value }));
    }
    const step = Math.ceil(entries.length / 6);
    return entries.filter((_, i) => i % step === 0 || i === entries.length - 1).map(([label, value]) => ({
      label,
      value,
    }));
  }, [filteredReviews]);

  // CSV Export handler
  const handleExportCSV = () => {
    if (filteredReviews.length === 0) return;

    const headers = ["Review ID", "Author Name", "Rating", "Review Date", "Status", "Sentiment", "Content"];
    const rows = filteredReviews.map((r) => [
      `"${r.id}"`,
      `"${r.author_name.replace(/"/g, '""')}"`,
      r.rating,
      `"${new Date(r.review_date).toISOString()}"`,
      `"${r.status}"`,
      `"${r.sentiment}"`,
      `"${(r.content || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `nexrep-analytics-${selectedLocation?.name.replace(/\s+/g, "-").toLowerCase() || "profile"}-${dateRange}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Reputation & Business Analytics
            </h1>
            <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
              Live Verified Data
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {selectedLocation
              ? `Performance analytics & customer sentiment breakdown for ${selectedLocation.name}`
              : "Select a business profile to view verified Google analytics."}
          </p>
        </div>

        {/* Date Filter Pills & CSV Export */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/80 text-xs">
            {(["7d", "30d", "90d", "all"] as DateRangeOption[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDateRange(option)}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  dateRange === option
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {option === "7d" ? "7 Days" : option === "30d" ? "30 Days" : option === "90d" ? "90 Days" : "All Time"}
              </button>
            ))}
          </div>

          <Button
            onClick={handleExportCSV}
            disabled={filteredReviews.length === 0}
            variant="outline"
            className="h-9 px-3.5 text-xs font-semibold gap-1.5 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Reputation & Business Analytics"
        dataType="live"
        summary="Analytics are computed from verified reviews synchronized with your Google Business Profile. Date filters allow multi-period comparisons across 7, 30, and 90-day intervals."
        apiStatusNote="Google Performance API metrics (Search impressions, Maps views) require Performance API enablement in your Google Cloud project. NexRep never fabricates fake search metrics."
        proTips={[
          "Analyze 30-day period-over-period review velocity to measure the ROI of customer feedback campaigns.",
          "Use the CSV export button to download full review datasets for internal meetings or client reporting.",
        ]}
      />

      {isLoading ? (
        <div className="h-64 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span className="text-xs font-medium text-slate-600">
            Computing verified analytics...
          </span>
        </div>
      ) : !selectedLocation ? (
        <Card className="border-slate-200/90 bg-white shadow-sm p-10 text-center rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Select Business Profile</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Choose an active Google Business Profile to view reputation analytics.
          </p>
          <Link href="/dashboard/locations?select_profile=1" className="mt-4 inline-block">
            <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl">
              Select Profile
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Period-Over-Period KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Period Review Volume
              </span>
              <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-2">
                {totalReviews}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] font-semibold">
                {reviewGrowth >= 0 ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> +{reviewGrowth}% vs previous period
                  </span>
                ) : (
                  <span className="text-rose-600 flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" /> {reviewGrowth}% vs previous period
                  </span>
                )}
              </div>
            </Card>

            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Average Rating
              </span>
              <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-2 flex items-baseline gap-2">
                <span>{averageRating > 0 ? averageRating.toFixed(1) : "—"}</span>
                <span className="text-amber-400 text-sm font-bold">★</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] font-semibold">
                {ratingDiff >= 0 ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> +{ratingDiff} vs previous period
                  </span>
                ) : (
                  <span className="text-rose-600 flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" /> {ratingDiff} vs previous period
                  </span>
                )}
              </div>
            </Card>

            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Response Coverage
              </span>
              <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-2">
                {responseRate}%
              </div>
              <p className="text-[11px] text-slate-500 mt-2 font-medium">
                {answeredCount} of {totalReviews} reviews replied
              </p>
            </Card>

            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Positive Sentiment Ratio
              </span>
              <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-2">
                {totalReviews > 0 ? Math.round((sentimentCounts.positive / totalReviews) * 100) : 0}%
              </div>
              <p className="text-[11px] text-slate-500 mt-2 font-medium">
                {sentimentCounts.positive} positive submissions
              </p>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2 bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Review Acquisition Velocity
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Reviews received over the selected period ({dateRange})
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] font-semibold border-emerald-200 text-emerald-800 bg-emerald-50">
                  {filteredReviews.length} Data Points
                </Badge>
              </div>

              <AreaTrendChart data={trendData} height={230} valueSuffix=" reviews" lineColor="#059669" />
            </Card>

            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                Customer Sentiment
              </h3>
              <p className="text-[11px] text-slate-400 mb-5">
                Feedback tone distribution
              </p>

              <SentimentDonutChart
                positive={sentimentCounts.positive}
                neutral={sentimentCounts.neutral}
                negative={sentimentCounts.negative}
              />
            </Card>
          </div>

          {/* Rating Breakdown & Google Search Performance Status */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                Rating Distribution
              </h3>
              <p className="text-[11px] text-slate-400 mb-4">
                Star rating distribution in selected range
              </p>
              <RatingDistributionChart distribution={ratingDistribution} />
            </Card>

            {/* Google Business Profile Performance API Transparency Card */}
            <Card className="lg:col-span-2 bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-emerald-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Google Maps & Search Performance Metrics
                    </h3>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold border-amber-200 bg-amber-50 text-amber-800">
                    Integration Notice
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Search className="w-3 h-3 text-slate-400" /> Search Views
                    </span>
                    <p className="text-lg font-bold text-slate-700">Pending</p>
                    <p className="text-[10px] text-slate-400">Google Performance API</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Eye className="w-3 h-3 text-slate-400" /> Maps Views
                    </span>
                    <p className="text-lg font-bold text-slate-700">Pending</p>
                    <p className="text-[10px] text-slate-400">Google Performance API</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" /> Call Clicks
                    </span>
                    <p className="text-lg font-bold text-slate-700">Pending</p>
                    <p className="text-[10px] text-slate-400">Google Performance API</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Compass className="w-3 h-3 text-slate-400" /> Directions
                    </span>
                    <p className="text-lg font-bold text-slate-700">Pending</p>
                    <p className="text-[10px] text-slate-400">Google Performance API</p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70 text-xs text-emerald-950 flex items-start gap-2.5 mt-2">
                  <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="leading-relaxed text-[11px] space-y-1">
                    <p className="font-semibold text-emerald-900">
                      Truthful Data Guarantee:
                    </p>
                    <p className="text-emerald-800">
                      Review counts, customer ratings, response rates, and sentiment trends above are 100% verified live data from your connected Google Business Profile. Search impression timeseries require activating the Google Business Profile Performance API in Google Cloud Console. NexRep never fabricates fake search metrics.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500">Connected Location:</span>
                <span className="font-semibold text-slate-900">{selectedLocation.name}</span>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
