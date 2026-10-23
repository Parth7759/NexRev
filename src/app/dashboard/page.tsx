"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, MessageSquare, AlertCircle, TrendingUp, Building2, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { LocationSelector } from "@/components/location/location-selector";
import { createClient } from "@/utils/supabase/client";

interface ReviewRow {
  id: string;
  author_name: string;
  rating: number;
  content: string | null;
  review_date: string;
  status: string;
  sentiment: string;
  location_id: string | null;
  locations: { id: string; name: string } | { id: string; name: string }[] | null;
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
            locations (id, name)
          `)
          .eq("workspace_id", activeWorkspaceId)
          .order("review_date", { ascending: false });

        if (error) {
          console.error("Error fetching overview reviews:", error.message);
          setReviews([]);
        } else {
          setReviews((data as unknown as ReviewRow[]) || []);
        }
      } catch (err) {
        console.error("Overview load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchReviews();
  }, [activeWorkspaceId]);

  // Compute counts per location
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

  // Unique review count across all locations
  const uniqueReviewsCount = useMemo(() => new Set(reviews.map((r) => r.id)).size, [reviews]);

  // Filter reviews by selected location
  const filteredReviews = useMemo(() => {
    if (selectedLocationId === "all") return reviews;
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
      const percent = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
      return { stars, count, percent };
    });
  }, [filteredReviews, totalReviews]);

  // Recent Activity (up to 4 reviews)
  const recentActivity = useMemo(() => {
    return filteredReviews.slice(0, 4).map((r) => {
      const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
      return {
        id: r.id,
        name: r.author_name,
        rating: r.rating,
        text: r.content || "(No comment text provided)",
        date: new Date(r.review_date).toLocaleDateString(),
        locationName: loc?.name || (selectedLocation ? selectedLocation.name : "Google Business"),
        status: r.status,
      };
    });
  }, [filteredReviews, selectedLocation]);

  return (
    <div className="space-y-8">
      {/* Top Header with Location Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard Overview</h2>
          <p className="text-slate-500 text-sm">
            {selectedLocation
              ? `Real-time analytics for ${selectedLocation.name}`
              : "Consolidated performance across all authorized business profiles."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LocationSelector
            counts={countsByLocation}
            totalCount={uniqueReviewsCount}
            className="w-[210px]"
            showAllOption={true}
          />
          <Link href="/dashboard/reviews">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs shadow-sm h-9">
              Manage Inbox <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 flex flex-col items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-sm">Loading performance metrics...</span>
        </div>
      ) : (
        <>
          {/* Top 4 KPI Metric Cards */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Reviews Card */}
            <Card className="border-slate-200 shadow-sm flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Reviews</CardTitle>
                <MessageSquare className="h-4 w-4 text-blue-600 shrink-0" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-slate-900 leading-none">{totalReviews}</div>
                <p className="text-xs text-slate-500 mt-2 truncate flex items-center h-4">
                  {selectedLocation ? selectedLocation.name : "All authorized locations"}
                </p>
              </CardContent>
            </Card>

            {/* Average Rating Card */}
            <Card className="border-slate-200 shadow-sm flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Average Rating</CardTitle>
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-slate-900 leading-none">
                  {totalReviews > 0 ? averageRating : "N/A"}
                </div>
                <div className="flex items-center gap-1 mt-2 h-4">
                  {[...Array(5)].map((_, idx) => (
                    <Star
                      key={idx}
                      className={`w-3 h-3 ${
                        idx < Math.round(averageRating)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-slate-200"
                      }`}
                    />
                  ))}
                  <span className="text-[11px] text-slate-400 ml-1">({totalReviews} total)</span>
                </div>
              </CardContent>
            </Card>

            {/* Unanswered Reviews Card */}
            <Card className="border-slate-200 shadow-sm flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Unanswered</CardTitle>
                <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-slate-900 leading-none">{unansweredCount}</div>
                <p className="text-xs text-orange-600 font-medium mt-2 truncate h-4">
                  {unansweredCount > 0 ? "Awaiting your AI response" : "Inbox fully addressed"}
                </p>
              </CardContent>
            </Card>

            {/* Response Rate Card */}
            <Card className="border-slate-200 shadow-sm flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Response Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600 shrink-0" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-slate-900 leading-none">
                  {totalReviews > 0 ? `${responseRate}%` : "100%"}
                </div>
                <p className="text-xs text-green-600 font-medium flex items-center mt-2 truncate h-4">
                  {answeredCount} of {totalReviews} addressed
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Lower Grid: Recent Activity + Rating Distribution */}
          <div className="grid gap-6 lg:grid-cols-7 mt-8">
            {/* Recent Activity List */}
            <Card className="lg:col-span-4 border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Recent Customer Reviews</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedLocation ? selectedLocation.name : "Latest reviews across all locations"}
                  </p>
                </div>
                <Link href="/dashboard/reviews" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                  View all
                </Link>
              </CardHeader>
              <CardContent className="pt-4">
                {recentActivity.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No recent reviews found for this business.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentActivity.map((review) => (
                      <div
                        key={review.id}
                        className="flex items-start justify-between border-b border-slate-100 pb-4 last:border-0 last:pb-0"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{review.name}</p>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-600 bg-slate-50"
                            >
                              <Building2 className="w-2.5 h-2.5 mr-1 text-slate-400" />
                              {review.locationName}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            {[...Array(5)].map((_, idx) => (
                              <Star
                                key={idx}
                                className={`w-3 h-3 ${
                                  idx < review.rating ? "text-yellow-400 fill-yellow-400" : "text-slate-200"
                                }`}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-slate-600 line-clamp-2 max-w-lg leading-relaxed">
                            {review.text}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-400 shrink-0 ml-4 font-mono">{review.date}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rating Distribution Breakdown */}
            <Card className="lg:col-span-3 border-slate-200 shadow-sm">
              <CardHeader className="pb-4 border-b border-slate-100">
                <CardTitle className="text-base font-semibold text-slate-900">Rating Distribution</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedLocation ? selectedLocation.name : "Across all locations"}
                </p>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {ratingDistribution.map((row) => (
                    <div key={row.stars} className="flex items-center text-xs">
                      <div className="w-12 text-slate-600 font-medium">{row.stars} Stars</div>
                      <div className="flex-1 ml-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            row.stars >= 4 ? "bg-green-500" : row.stars === 3 ? "bg-yellow-400" : "bg-red-500"
                          }`}
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                      <div className="w-14 text-right text-slate-500 font-mono text-[11px]">
                        {row.count} ({row.percent}%)
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-5 border-t border-slate-100 text-center">
                  <div className="text-3xl font-bold text-slate-900">
                    {totalReviews > 0 ? averageRating : "0.0"}
                  </div>
                  <div className="flex justify-center mt-1.5">
                    {[...Array(5)].map((_, idx) => (
                      <Star
                        key={idx}
                        className={`w-4 h-4 ${
                          idx < Math.round(averageRating)
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Based on {totalReviews} {totalReviews === 1 ? "review" : "reviews"} for{" "}
                    {selectedLocation ? selectedLocation.name : "all locations"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
