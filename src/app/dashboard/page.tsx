"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Star,
  MessageSquare,
  AlertCircle,
  TrendingUp,
  Building2,
  ArrowRight,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { LocationSelector } from "@/components/location/location-selector";
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
  locations:
    | { id: string; name: string; is_connected?: boolean }
    | { id: string; name: string; is_connected?: boolean }[]
    | null;
}

export default function Dashboard() {
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocationId, selectedLocation } = useLocation();

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
          .select(`
            id,
            author_name,
            rating,
            content,
            review_date,
            status,
            sentiment,
            location_id,
            locations (id, name, is_connected)
          `)
          .eq("workspace_id", activeWorkspaceId)
          .order("review_date", { ascending: false });

        if (error) {
          console.error("Error fetching overview reviews:", error.message);
          setReviews([]);
        } else {
          // Only consider reviews belonging to the active connected business profile
          const allRows = (data as unknown as ReviewRow[]) || [];
          const activeRows = allRows.filter((r) => {
            const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
            return loc ? loc.is_connected === true : false;
          });
          setReviews(activeRows);
        }
      } catch (err) {
        console.error("Overview load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchReviews();
  }, [activeWorkspaceId]);

  // Compute review counts by location
  const countsByLocation = useMemo(() => {
    const map: Record<string, number> = {};
    reviews.forEach((r) => {
      const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
      const id = r.location_id || loc?.id;
      if (id) {
        map[id] = (map[id] || 0) + 1;
      }
    });
    return map;
  }, [reviews]);

  // Filter strictly by selected business profile
  const filteredReviews = useMemo(() => {
    if (!selectedLocationId) return [];
    return reviews.filter((r) => {
      const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
      const id = r.location_id || loc?.id;
      return id === selectedLocationId;
    });
  }, [reviews, selectedLocationId]);

  // Dynamic Metrics for the selected business location
  const totalReviews = filteredReviews.length;
  const unansweredCount = filteredReviews.filter((r) => r.status === "unanswered").length;
  const answeredCount = filteredReviews.filter((r) => r.status === "answered").length;
  const responseRate = totalReviews > 0 ? Math.round((answeredCount / totalReviews) * 100) : 0;

  const averageRating = useMemo(() => {
    if (totalReviews === 0) return 0;
    const sum = filteredReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return Number((sum / totalReviews).toFixed(1));
  }, [filteredReviews, totalReviews]);

  // Rating Distribution
  const ratingDistribution = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    filteredReviews.forEach((r) => {
      const star = r.rating as 1 | 2 | 3 | 4 | 5;
      if (counts[star] !== undefined) {
        counts[star]++;
      }
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

  // Review Volume Trend over months/weeks
  const trendData: TrendDataPoint[] = useMemo(() => {
    if (filteredReviews.length === 0) {
      return [
        { label: "W1", value: 0 },
        { label: "W2", value: 0 },
        { label: "W3", value: 0 },
        { label: "W4", value: 0 },
      ];
    }

    // Group reviews by month or 7-day windows
    const monthlyGroups: Record<string, number> = {};
    const sorted = [...filteredReviews].sort(
      (a, b) => new Date(a.review_date).getTime() - new Date(b.review_date).getTime()
    );

    sorted.forEach((r) => {
      const d = new Date(r.review_date);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      monthlyGroups[key] = (monthlyGroups[key] || 0) + 1;
    });

    const entries = Object.entries(monthlyGroups);
    if (entries.length < 5) {
      return entries.map(([label, value]) => ({ label, value }));
    }
    // Pick evenly spaced points
    const step = Math.max(1, Math.floor(entries.length / 6));
    return entries.filter((_, i) => i % step === 0 || i === entries.length - 1).map(([label, value]) => ({
      label,
      value,
    }));
  }, [filteredReviews]);

  // Recent Activity
  const recentActivity = useMemo(() => {
    return filteredReviews.slice(0, 4).map((r) => ({
      id: r.id,
      name: r.author_name,
      rating: r.rating,
      text: r.content || "(No comment text provided)",
      date: new Date(r.review_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      status: r.status,
    }));
  }, [filteredReviews]);

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header with Location Filter & Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-1">
        <div className="space-y-1 min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Overview Dashboard
            </h1>
            {selectedLocation && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 break-words leading-relaxed">
            {selectedLocation
              ? `Reputation intelligence & growth console for ${selectedLocation.name}`
              : "Select your Google Business Profile to view real-time reputation performance."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          <LocationSelector
            counts={countsByLocation}
            totalCount={filteredReviews.length}
            truncateName={false}
            className="w-full sm:w-auto min-w-[220px] max-w-full sm:max-w-md lg:max-w-xl"
          />
          <Link href="/dashboard/reviews" className="shrink-0">
            <Button className="w-full sm:w-auto bg-[#0B3024] hover:bg-[#0E3D2E] text-white shadow-xs h-9 px-4 text-xs font-semibold gap-1.5 rounded-xl transition-all">
              Review Inbox
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Overview Dashboard"
        dataType={selectedLocation ? "live" : "demo"}
        summary="This console computes live reputation health, review acquisition velocity, and unanswered response queues directly from your connected Google Business Profile."
        apiStatusNote={
          !selectedLocation
            ? "No Google Business Profile is currently connected. Showing onboarding demo layout."
            : undefined
        }
        proTips={[
          "Maintaining an average rating above 4.5 stars improves local pack rankings on Google Maps by up to 28%.",
          "Answering 100% of reviews within 24 hours triggers Google's 'responsive business' trust signal.",
          "Use the Priority Actions below to quickly address urgent or unanswered customer feedback.",
        ]}
      />

      {isLoading ? (
        <div className="h-64 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span className="text-xs font-medium text-slate-600">
            Synchronizing reputation metrics...
          </span>
        </div>
      ) : !selectedLocation ? (
        /* Empty State: Prompt user to connect or select profile */
        <Card id="tour-kpi-cards" className="border-slate-200/90 bg-white shadow-sm p-8 sm:p-14 text-center rounded-2xl">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-center mb-4 ring-8 ring-emerald-50/50">
            <Building2 className="w-7 h-7 text-emerald-700" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Select a Business Profile to Continue
          </h2>
          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            This workspace does not have an active Google Business Profile selected. Choose a profile to unlock AI reply automation, customer sentiment analytics, and live review synchronization.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link href="/dashboard/locations?select_profile=1">
              <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white shadow-xs gap-2 px-5 h-10 font-semibold rounded-xl text-xs">
                <Building2 className="w-4 h-4" />
                Select Business Profile
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* Top 4 KPI Cards */}
          <div id="tour-kpi-cards" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Reviews Card */}
            <Card className="bg-white border border-slate-200/80 shadow-xs hover:border-emerald-300/80 transition-all rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Total Reviews
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {totalReviews}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-emerald-700 font-medium">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Real Google customer reviews</span>
                </div>
              </div>
            </Card>

            {/* Average Rating Card */}
            <Card className="bg-white border border-slate-200/80 shadow-xs hover:border-emerald-300/80 transition-all rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Average Rating
                </span>
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                    {averageRating > 0 ? averageRating.toFixed(1) : "—"}
                  </span>
                  <div className="flex text-amber-400 text-xs">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i < Math.round(averageRating) ? "fill-amber-400" : "text-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 font-medium">
                  From {totalReviews} verified submissions
                </p>
              </div>
            </Card>

            {/* Unanswered Reviews Card */}
            <Card className="bg-white border border-slate-200/80 shadow-xs hover:border-emerald-300/80 transition-all rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Unanswered
                </span>
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                  <AlertCircle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {unansweredCount}
                </div>
                <div className="mt-1.5">
                  {unansweredCount > 0 ? (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-semibold px-2 py-0">
                      Needs Attention
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold px-2 py-0">
                      Inbox Zero
                    </Badge>
                  )}
                </div>
              </div>
            </Card>

            {/* Response Rate Card */}
            <Card className="bg-white border border-slate-200/80 shadow-xs hover:border-emerald-300/80 transition-all rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Response Rate
                </span>
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Clock className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {responseRate}%
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${responseRate}%` }}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Actionable Improvement Recommendations / Priority Tasks */}
          <Card className="border-emerald-900/10 bg-emerald-50/40 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                  Actionable Recommendations & Next Steps
                </h3>
              </div>
              <Badge className="bg-emerald-700 text-white text-[10px] px-2 py-0.5 font-semibold">
                Priority Actions
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                    Unanswered Reviews
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">P1</span>
                </div>
                <p className="text-xs font-bold text-slate-900">
                  {unansweredCount > 0
                    ? `Reply to ${unansweredCount} pending reviews`
                    : "Review inbox is fully updated"}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Replying within 24 hours boosts local Google search visibility and customer trust.
                </p>
                <div className="pt-1">
                  <Link href="/dashboard/reviews">
                    <Button variant="outline" className="w-full text-[11px] h-7 font-semibold text-emerald-800 hover:bg-emerald-50 border-emerald-200">
                      Open Inbox & AI Drafts
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    Google Local Posts
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">P2</span>
                </div>
                <p className="text-xs font-bold text-slate-900">Create a weekly Google Post</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Active profiles that post weekly get 35% more map interactions and direction clicks.
                </p>
                <div className="pt-1">
                  <Link href="/dashboard/posts">
                    <Button variant="outline" className="w-full text-[11px] h-7 font-semibold text-emerald-800 hover:bg-emerald-50 border-emerald-200">
                      Create Update / Offer Post
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                    Profile Audit
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">P3</span>
                </div>
                <p className="text-xs font-bold text-slate-900">Audit Profile Completeness</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Verify business hours, service categories, and description with NexRep Audit Engine.
                </p>
                <div className="pt-1">
                  <Link href="/dashboard/audit">
                    <Button variant="outline" className="w-full text-[11px] h-7 font-semibold text-emerald-800 hover:bg-emerald-50 border-emerald-200">
                      View Audit Scorecard
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </Card>

          {/* Charts Row: Review Volume Trends & Rating Breakdown */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Area Chart: Review Volume Trend */}
            <Card className="lg:col-span-2 bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Review Volume Trends
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Verified review acquisition rate over time
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] font-semibold border-emerald-200 text-emerald-800 bg-emerald-50">
                  Live Synced Data
                </Badge>
              </div>

              <AreaTrendChart data={trendData} height={220} valueSuffix=" reviews" lineColor="#059669" />
            </Card>

            {/* Rating Distribution Breakdown */}
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Rating Breakdown
                </h3>
                <p className="text-[11px] text-slate-400 mb-4">
                  Distribution of customer scores
                </p>
                <RatingDistributionChart distribution={ratingDistribution} />
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">5-Star Ratio</span>
                <span className="font-bold text-emerald-700 font-mono">
                  {ratingDistribution[0]?.percentage || 0}%
                </span>
              </div>
            </Card>
          </div>

          {/* Bottom Row: Sentiment Donut & Recent Review Queue */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Sentiment Donut Breakdown */}
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                Sentiment Breakdown
              </h3>
              <p className="text-[11px] text-slate-400 mb-4">
                AI sentiment analysis of customer feedback
              </p>

              <SentimentDonutChart
                positive={sentimentCounts.positive}
                neutral={sentimentCounts.neutral}
                negative={sentimentCounts.negative}
              />
            </Card>

            {/* Recent Reviews Table / Queue */}
            <Card className="lg:col-span-2 bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Recent Customer Feedback
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Latest submissions from Google Business Profile
                  </p>
                </div>
                <Link
                  href="/dashboard/reviews"
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
                >
                  View All <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="divide-y divide-slate-100">
                {recentActivity.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No recent reviews found for this profile.
                  </div>
                ) : (
                  recentActivity.map((r) => (
                    <div key={r.id} className="py-3 flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {r.name}
                          </span>
                          <div className="flex text-amber-400 text-[10px]">
                            {Array.from({ length: r.rating }).map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-amber-400" />
                            ))}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{r.date}</span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-1 leading-relaxed">
                          {r.text}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {r.status === "answered" ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold px-2 py-0.5">
                            Replied
                          </Badge>
                        ) : (
                          <Link href="/dashboard/reviews">
                            <Badge className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-[10px] font-semibold px-2 py-0.5 cursor-pointer">
                              Reply
                            </Badge>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
