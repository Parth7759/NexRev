"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Star,
  Sparkles,
  Send,
  CheckCircle2,
  AlertCircle,
  Info,
  Loader2,
  Building2,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateAiReplyAction, saveReviewReplyAction, getAiStatus } from "./actions";
import { syncGoogleLocationsAction } from "@/app/dashboard/locations/actions";
import { ReplyTone } from "@/lib/ai";
import { createClient } from "@/utils/supabase/client";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { LocationSelector } from "@/components/location/location-selector";

export interface ReviewItem {
  id: string;
  author: string;
  authorPhotoUrl?: string | null;
  rating: number;
  date: string;
  location: string;
  locationId: string | null;
  content: string;
  status: "unanswered" | "answered";
  sentiment: "positive" | "negative" | "neutral";
  reply?: string;
  replyStatus?: "draft" | "published" | "failed";
  isDemo?: boolean;
  workspaceId?: string;
  source?: "google" | "manual" | "internal";
}

// Sample fallback demo reviews clearly identified for testing when no live data exists
const sampleDemoReviews: ReviewItem[] = [
  {
    id: "demo-1",
    author: "Sarah Jenkins",
    rating: 5,
    date: "2 days ago",
    location: "Demo Business",
    locationId: null,
    content: "Absolutely amazing experience. The staff was super friendly and the service was quick.",
    status: "unanswered",
    sentiment: "positive",
    isDemo: true,
    source: "manual",
  },
  {
    id: "demo-2",
    author: "Mike Thompson",
    rating: 2,
    date: "1 week ago",
    location: "Demo Business",
    locationId: null,
    content: "Waited for 30 minutes to get someone to help me. The product is okay but the service needs work.",
    status: "unanswered",
    sentiment: "negative",
    isDemo: true,
    source: "manual",
  },
  {
    id: "demo-3",
    author: "Emily Chen",
    rating: 4,
    date: "2 weeks ago",
    location: "Demo Business",
    locationId: null,
    content: "Great selection, though slightly overpriced. Would still recommend.",
    status: "answered",
    reply: "Hi Emily, thank you for the feedback! We're glad you enjoyed our selection.",
    sentiment: "neutral",
    isDemo: true,
    source: "manual",
  },
];

interface LiveReviewRow {
  id: string;
  author_name: string;
  author_photo_url: string | null;
  rating: number;
  content: string | null;
  review_date: string;
  status: string;
  sentiment: string;
  source: string;
  workspace_id: string;
  location_id: string | null;
  locations: { id: string; name: string; address: string | null } | { id: string; name: string; address: string | null }[] | null;
  review_replies: { id: string; content: string; status?: string; created_at: string }[] | null;
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [draftReplyText, setDraftReplyText] = useState<string | null>(null);
  const [tone, setTone] = useState<ReplyTone>("professional");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const { activeWorkspaceId: contextWsId } = useWorkspace();
  const { selectedLocationId, selectedLocation } = useLocation();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(undefined);
  const [ratingFilter, setRatingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all-status");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSyncingReviews, setIsSyncingReviews] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Load reviews scoped to workspace and location
  useEffect(() => {
    let isMounted = true;

    async function loadReviews() {
      try {
        setIsLoadingReviews(true);
        const status = await getAiStatus();
        if (isMounted) setAiConfigured(status.configured);

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        let wsId = contextWsId;

        if (user && !wsId) {
          const { data: memberData } = await supabase
            .from("workspace_members")
            .select("workspace_id")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();

          const member = memberData as { workspace_id: string } | null;
          if (member?.workspace_id) {
            wsId = member.workspace_id;
          }
        }

        if (wsId) {
          if (isMounted) setActiveWorkspaceId(wsId);

          // Fetch reviews strictly scoped to workspace with exact location relationships
          const { data: liveReviews, error: revError } = await supabase
            .from("reviews")
            .select(`
              id,
              author_name,
              author_photo_url,
              rating,
              content,
              review_date,
              status,
              sentiment,
              source,
              workspace_id,
              location_id,
              locations (id, name, address),
              review_replies (id, content, status, created_at)
            `)
            .eq("workspace_id", wsId)
            .order("review_date", { ascending: false });

          if (!isMounted) return;

          if (revError) {
            console.error("Error loading reviews:", revError.message);
          }

          if (liveReviews && liveReviews.length > 0) {
            const formatted: ReviewItem[] = (liveReviews as unknown as LiveReviewRow[]).map((r) => {
              const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
              const resolvedLocName = loc?.name || (r.source === "google" ? "Google Business" : "Unassigned");
              const resolvedLocId = r.location_id || loc?.id || null;
              const replies = Array.isArray(r.review_replies) ? r.review_replies : [];
              const primaryReply = replies[0];
              const isDemo = r.source === "manual" || r.id.startsWith("demo-");

              return {
                id: r.id,
                author: r.author_name,
                authorPhotoUrl: r.author_photo_url,
                rating: r.rating,
                date: new Date(r.review_date).toLocaleDateString(),
                location: resolvedLocName,
                locationId: resolvedLocId,
                content: r.content || "",
                status: r.status === "answered" ? "answered" : "unanswered",
                sentiment: (r.sentiment as ReviewItem["sentiment"]) || "neutral",
                reply: primaryReply?.content,
                replyStatus: (primaryReply?.status as ReviewItem["replyStatus"]) || (primaryReply?.content ? "draft" : undefined),
                isDemo: isDemo,
                workspaceId: r.workspace_id,
                source: (r.source as ReviewItem["source"]) || "google",
              };
            });

            setReviews(formatted);
          } else {
            setReviews(sampleDemoReviews);
          }
        } else if (isMounted) {
          setReviews(sampleDemoReviews);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        if (isMounted) setIsLoadingReviews(false);
      }
    }

    loadReviews();

    return () => {
      isMounted = false;
    };
  }, [contextWsId, refreshCounter]);

  const handleSyncReviews = async () => {
    if (!activeWorkspaceId) return;
    setIsSyncingReviews(true);
    setSyncNotice(null);
    setErrorMessage(null);
    try {
      const res = await syncGoogleLocationsAction(activeWorkspaceId);
      if (res.success) {
        setSyncNotice(`Successfully synced ${res.reviewsCount} reviews from Google Business Profile.`);
        setRefreshCounter((prev) => prev + 1);
      } else {
        setErrorMessage(res.error || "Failed to sync reviews from Google.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync error occurred.";
      setErrorMessage(msg);
    } finally {
      setIsSyncingReviews(false);
      setTimeout(() => setSyncNotice(null), 5000);
    }
  };

  // Compute counts per location for accurate selector labels
  const countsByLocation = useMemo(() => {
    const map: Record<string, number> = {};
    reviews.forEach((r) => {
      if (r.locationId) {
        map[r.locationId] = (map[r.locationId] || 0) + 1;
      }
    });
    return map;
  }, [reviews]);

  // Total unique reviews count
  const totalReviewsCount = useMemo(() => new Set(reviews.map((r) => r.id)).size, [reviews]);

  // Filter reviews strictly by location, rating, status, and search query
  const filteredReviews = useMemo(() => {
    return reviews.filter((review) => {
      // 1. Business Location filter:
      if (selectedLocationId !== "all") {
        // Enforce exact location ID matching
        if (review.locationId !== selectedLocationId) {
          return false;
        }
      }

      // 2. Rating filter:
      if (ratingFilter === "5" && review.rating !== 5) return false;
      if (ratingFilter === "4" && review.rating !== 4) return false;
      if (ratingFilter === "1-3" && review.rating > 3) return false;

      // 3. Status filter:
      if (statusFilter === "unanswered" && review.status !== "unanswered") return false;
      if (statusFilter === "answered" && review.status !== "answered") return false;

      // 4. Search query (matches author or content):
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchAuthor = review.author?.toLowerCase().includes(q);
        const matchContent = review.content?.toLowerCase().includes(q);
        if (!matchAuthor && !matchContent) return false;
      }

      return true;
    });
  }, [reviews, selectedLocationId, ratingFilter, statusFilter, searchQuery]);

  // Derive active review from filteredReviews and selectedReviewId (no useEffect setState)
  const activeReview = useMemo(() => {
    if (filteredReviews.length === 0) return null;
    return filteredReviews.find((r) => r.id === selectedReviewId) || filteredReviews[0];
  }, [filteredReviews, selectedReviewId]);

  // Reply text is either what user typed/generated, or the saved reply of the active review
  const replyText = draftReplyText ?? (activeReview?.reply || "");

  const handleSelectReview = (review: ReviewItem) => {
    setSelectedReviewId(review.id);
    setDraftReplyText(review.reply || null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleGenerateReply = async () => {
    if (!activeReview) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    setIsGenerating(true);

    try {
      const result = await generateAiReplyAction({
        authorName: activeReview.author,
        rating: activeReview.rating,
        reviewContent: activeReview.content || "",
        locationName: activeReview.location,
        tone: tone,
        workspaceId: activeWorkspaceId,
        reviewId: activeReview.id,
      });

      if (!result.success) {
        setErrorMessage(result.error || "Failed to generate AI reply.");
      } else if (result.reply) {
        setDraftReplyText(result.reply);
        setSuccessMessage("AI reply generated and saved as draft.");

        // Update local review state so the draft badge reflects immediately
        const updatedReview: ReviewItem = {
          ...activeReview,
          reply: result.reply.trim(),
          replyStatus: "draft",
        };
        setReviews((prev) => prev.map((r) => (r.id === updatedReview.id ? updatedReview : r)));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error during reply generation.";
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!activeReview) return;
    if (!replyText || replyText.trim() === "") {
      setErrorMessage("Please enter or generate a reply draft before saving.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(true);

    try {
      const result = await saveReviewReplyAction({
        reviewId: activeReview.isDemo ? undefined : activeReview.id,
        workspaceId: activeWorkspaceId,
        content: replyText,
        tone: tone,
        isAiGenerated: true,
        isDemo: activeReview.isDemo,
        publishToGoogle: false,
        manualApprovalConfirmed: false,
      });

      if (!result.success) {
        setErrorMessage(result.error || "Failed to save draft reply.");
      } else {
        setSuccessMessage(result.message || "Draft reply saved successfully.");
        const updatedReview: ReviewItem = {
          ...activeReview,
          reply: replyText.trim(),
          replyStatus: "draft",
        };

        setReviews((prev) => prev.map((r) => (r.id === updatedReview.id ? updatedReview : r)));
        setDraftReplyText(replyText.trim());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error while saving draft.";
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveReply = async () => {
    if (!activeReview) return;
    if (!replyText || replyText.trim() === "") {
      setErrorMessage("Please enter or generate a reply before posting.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(true);

    try {
      const result = await saveReviewReplyAction({
        reviewId: activeReview.isDemo ? undefined : activeReview.id,
        workspaceId: activeWorkspaceId,
        content: replyText,
        tone: tone,
        isAiGenerated: true,
        isDemo: activeReview.isDemo,
        publishToGoogle: true,
        manualApprovalConfirmed: true,
      });

      if (!result.success) {
        setErrorMessage(result.error || "Failed to save review reply.");
      } else {
        setSuccessMessage(result.message || "Reply saved successfully.");

        // Update local state so review shows as answered
        const updatedReview: ReviewItem = {
          ...activeReview,
          status: "answered",
          reply: replyText.trim(),
          replyStatus: "published",
        };

        setReviews((prev) => prev.map((r) => (r.id === updatedReview.id ? updatedReview : r)));
        setDraftReplyText(replyText.trim());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error while posting reply.";
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header with Title and Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Reviews Inbox</h2>
          <p className="text-slate-500 text-sm">
            {selectedLocation
              ? `Managing feedback for ${selectedLocation.name}`
              : "Showing reviews across all authorized business locations."}
          </p>
        </div>

        {/* Toolbar: Location Selector, Search, Rating, and Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Business / Location Selector */}
          <LocationSelector
            counts={countsByLocation}
            totalCount={totalReviewsCount}
            className="w-[200px]"
            showAllOption={true}
          />

          {/* Search Reviews */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder="Search author or text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 h-9 text-xs w-[170px] bg-white border-slate-200 shadow-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Rating Filter */}
          <Select value={ratingFilter} onValueChange={(val) => val && setRatingFilter(val)}>
            <SelectTrigger className="w-[125px] h-9 text-xs bg-white border-slate-200 shadow-sm">
              <SelectValue placeholder="Rating" />
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all">All Ratings</SelectItem>
              <SelectItem value="5">5 Stars</SelectItem>
              <SelectItem value="4">4 Stars</SelectItem>
              <SelectItem value="1-3">1-3 Stars</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(val) => val && setStatusFilter(val)}>
            <SelectTrigger className="w-[125px] h-9 text-xs bg-white border-slate-200 shadow-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all-status">All Status</SelectItem>
              <SelectItem value="unanswered">Unanswered</SelectItem>
              <SelectItem value="answered">Answered</SelectItem>
            </SelectContent>
          </Select>

          {/* Sync Reviews Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncReviews}
            disabled={isSyncingReviews || !activeWorkspaceId}
            className="h-9 px-3 text-xs bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm shrink-0"
            title="Sync latest reviews from Google Business Profile"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isSyncingReviews ? "animate-spin text-blue-600" : "text-slate-500"}`} />
            {isSyncingReviews ? "Syncing..." : "Sync Reviews"}
          </Button>
        </div>
      </div>

      {/* Sync Success Feedback Notice */}
      {syncNotice && (
        <div className="bg-green-50 border border-green-200 text-green-900 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs animate-in fade-in-0 duration-150">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <span>{syncNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncNotice(null)}
            className="text-green-600 hover:text-green-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Message Notice */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-900 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs animate-in fade-in-0 duration-150">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-600 hover:text-red-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* AI Key Status Notice */}
      {aiConfigured === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>AI Reply Assistant Configuration Required:</strong>
            <p className="mt-0.5 text-amber-800">
              Please add <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">OPENAI_API_KEY</code> to your <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">.env.local</code> file to enable AI-assisted responses.
            </p>
          </div>
        </div>
      )}

      {/* Main 2-Column Split: Inbox List + Selected Review/Reply Panel */}
      <div className="grid lg:grid-cols-3 gap-6 flex-1 min-h-0 lg:h-[calc(100vh-14rem)] lg:min-h-[580px]">
        {/* Left Column: Review Inbox List */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm max-h-[400px] sm:max-h-[460px] lg:max-h-full">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800 text-sm">Inbox</h3>
              {selectedLocation && (
                <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 font-medium">
                  {selectedLocation.name}
                </Badge>
              )}
            </div>
            <span className="text-xs text-slate-500 font-mono font-medium">
              {filteredReviews.length} {filteredReviews.length === 1 ? "review" : "reviews"}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {isLoadingReviews ? (
              <div className="text-center py-12 text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span>Loading reviews...</span>
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="text-center py-12 px-4 text-slate-400 text-sm space-y-2">
                <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-medium text-slate-600">No reviews found</p>
                <p className="text-xs text-slate-400">
                  {selectedLocation
                    ? `No reviews match this filter for ${selectedLocation.name}.`
                    : "No reviews match your selected filters."}
                </p>
              </div>
            ) : (
              filteredReviews.map((review) => {
                const isSelected = activeReview?.id === review.id;
                return (
                  <div
                    key={review.id}
                    onClick={() => handleSelectReview(review)}
                    className={`p-4 rounded-lg cursor-pointer border transition-colors ${
                      isSelected
                        ? "bg-blue-50/70 border-blue-300 shadow-sm"
                        : "bg-white border-transparent hover:bg-slate-50 border-b-slate-100"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-medium text-slate-900 text-sm truncate mr-2">{review.author}</span>
                      <span className="text-[11px] text-slate-400 shrink-0">{review.date}</span>
                    </div>

                    <div className="flex items-center gap-1 mb-2">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${
                            i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-slate-200"
                          }`}
                        />
                      ))}
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 mb-2.5 leading-relaxed">
                      {review.content || "(No comment text provided)"}
                    </p>

                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <div className="flex gap-1.5 items-center flex-wrap">
                        {/* Business Location Tag */}
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          <Building2 className="w-2.5 h-2.5 text-slate-500" />
                          {review.location}
                        </span>

                        {/* Sentiment Tag */}
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 border ${
                            review.sentiment === "positive"
                              ? "border-green-200 text-green-700 bg-green-50"
                              : review.sentiment === "negative"
                              ? "border-red-200 text-red-700 bg-red-50"
                              : "border-slate-200 text-slate-600 bg-slate-50"
                          }`}
                        >
                          {review.sentiment}
                        </Badge>

                        {/* Demo Badge */}
                        {review.isDemo && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 border-amber-300 text-amber-700 bg-amber-50"
                          >
                            Demo
                          </Badge>
                        )}
                      </div>

                      {/* Status Badge */}
                      {review.status === "answered" ? (
                        <Badge
                          variant="outline"
                          className="text-green-700 border-green-200 bg-green-50 text-[10px] px-1.5 py-0"
                        >
                          <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Answered
                        </Badge>
                      ) : review.replyStatus === "draft" || Boolean(review.reply) ? (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0"
                        >
                          Draft Saved
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-orange-100 text-orange-700 hover:bg-orange-100 text-[10px] px-2 py-0"
                        >
                          Unanswered
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Review & AI Reply Panel */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl flex flex-col shadow-sm overflow-hidden lg:max-h-full">
          {activeReview ? (
            <>
              {/* Review Details Header */}
              <div className="p-6 border-b border-slate-100 shrink-0">
                {activeReview.isDemo && (
                  <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                    <Info className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Sample Demo Review (Stored for preview testing; not synced from live Google profile)</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{activeReview.author}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-sm text-slate-500">
                      <span>{activeReview.date}</span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded text-xs">
                        <Building2 className="w-3 h-3 text-blue-600" />
                        {activeReview.location}
                      </span>
                      {activeReview.source === "google" && (
                        <span className="text-[11px] text-slate-400">Synced via Google Business Profile</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-5 h-5 ${
                          i < activeReview.rating ? "text-yellow-400 fill-yellow-400" : "text-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <p className="text-slate-700 text-base leading-relaxed bg-slate-50/50 p-4 rounded-lg border border-slate-100">
                  {activeReview.content || "(No comment text provided with this rating.)"}
                </p>
              </div>

              {/* Reply Section */}
              <div className="flex-1 p-6 bg-slate-50/50 flex flex-col justify-between overflow-y-auto">
                {activeReview.status === "answered" ? (
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                          YOU
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Published Reply</p>
                          <p className="text-xs text-slate-400">Response published to customer feedback</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Answered
                      </Badge>
                    </div>
                    <p className="text-slate-700 leading-relaxed border-t pt-3 border-slate-100 text-sm">
                      {activeReview.reply}
                    </p>
                  </div>
                ) : (
                  <div className="bg-white p-6 rounded-xl border border-blue-100 shadow-sm space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="font-semibold text-slate-900 flex items-center text-sm">
                        <Sparkles className="w-4 h-4 text-blue-600 mr-2" />
                        AI Reply Assistant
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">Tone:</span>
                        <Select value={tone} onValueChange={(val) => setTone(val as ReplyTone)}>
                          <SelectTrigger className="w-[130px] h-8 text-xs bg-slate-50">
                            <SelectValue placeholder="Tone" />
                          </SelectTrigger>
                          <SelectContent className="text-xs">
                            <SelectItem value="professional">Professional</SelectItem>
                            <SelectItem value="friendly">Friendly</SelectItem>
                            <SelectItem value="concise">Concise</SelectItem>
                            <SelectItem value="empathetic">Empathetic</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {errorMessage && (
                      <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <div>{errorMessage}</div>
                      </div>
                    )}

                    {successMessage && (
                      <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-lg text-xs flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        <div>{successMessage}</div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label htmlFor="reply-editor" className="text-xs font-medium text-slate-500">
                        Response Draft for {activeReview.location} (Editable):
                      </label>
                      <Textarea
                        id="reply-editor"
                        rows={4}
                        placeholder={
                          aiConfigured === false
                            ? "AI key not configured. You can type your response manually here..."
                            : "Click 'Generate AI Reply' or type your custom response here..."
                        }
                        value={replyText}
                        onChange={(e) => setDraftReplyText(e.target.value)}
                        className="resize-none text-sm bg-white border-slate-200 focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateReply}
                        disabled={isGenerating}
                        className="border-blue-200 text-blue-700 hover:bg-blue-50 text-xs"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            Generating with AI...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                            Generate AI Reply
                          </>
                        )}
                      </Button>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleSaveDraft}
                          disabled={isSaving || !replyText.trim()}
                          className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs shadow-sm"
                          title="Save this reply as a draft without publishing to Google"
                        >
                          Save Draft
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={handleSaveReply}
                          disabled={isSaving || !replyText.trim()}
                          className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm text-xs"
                          title="Approve and publish reply directly to Google Business Profile"
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Posting...
                            </>
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5 mr-1.5" />
                              Approve & Post to Google
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Building2 className="w-12 h-12 text-slate-200 mb-3" />
              <h3 className="text-base font-semibold text-slate-700">No Review Selected</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                {selectedLocation
                  ? `Select a review from the ${selectedLocation.name} inbox to inspect details and generate an AI reply.`
                  : "Select a review from the inbox to inspect feedback details and generate an AI reply."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
