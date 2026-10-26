"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sparkles,
  Star,
  Check,
  Copy,
  Save,
  Loader2,
  Building2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Bot,
  SlidersHorizontal,
  FileEdit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { ReplyTone } from "@/lib/ai";
import {
  getEligibleReviewsForAiAction,
  generateAiReplyAction,
  saveReviewReplyAction,
  getAiStatus,
} from "@/app/dashboard/reviews/actions";

interface AssistantReview {
  id: string;
  author: string;
  rating: number;
  content: string;
  date: string;
  status: string;
  location: string;
  locationId: string | null;
  reply?: string;
  replyStatus?: string;
  isDemo?: boolean;
}

const demoReviewsForTesting: AssistantReview[] = [
  {
    id: "demo-test-1",
    author: "Elena Rostova",
    rating: 5,
    content: "Outstanding service! The team was prompt, professional, and handled our request seamlessly.",
    date: "1 day ago",
    status: "unanswered",
    location: "Demo Business Location",
    locationId: null,
    isDemo: true,
  },
  {
    id: "demo-test-2",
    author: "David Miller",
    rating: 3,
    content: "The quality was good but the wait time was noticeably longer than expected during peak hours.",
    date: "3 days ago",
    status: "unanswered",
    location: "Demo Business Location",
    locationId: null,
    isDemo: true,
  },
  {
    id: "demo-test-3",
    author: "Samantha Hayes",
    rating: 1,
    content: "Disappointed with the billing dispute resolution. Took multiple follow-ups with no clear update.",
    date: "5 days ago",
    status: "unanswered",
    location: "Demo Business Location",
    locationId: null,
    isDemo: true,
  },
];

export default function AIPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocation } = useLocation();

  const [reviews, setReviews] = useState<AssistantReview[]>([]);
  const [selectedReview, setSelectedReview] = useState<AssistantReview | null>(null);
  const [tone, setTone] = useState<ReplyTone>("professional");
  const [draftContent, setDraftContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [aiProviderStatus, setAiProviderStatus] = useState<{ configured: boolean; model: string }>({
    configured: false,
    model: "gpt-4o-mini",
  });
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);

  // Load AI configuration status
  useEffect(() => {
    let isMounted = true;
    getAiStatus().then((status) => {
      if (isMounted) setAiProviderStatus(status);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch live reviews for workspace
  useEffect(() => {
    let isMounted = true;

    async function fetchReviews() {
      if (!activeWorkspaceId) {
        if (isMounted) {
          setReviews(demoReviewsForTesting);
          setSelectedReview(demoReviewsForTesting[0]);
          setDraftContent(demoReviewsForTesting[0].reply || "");
          setIsLoadingReviews(false);
        }
        return;
      }

      try {
        const res = await getEligibleReviewsForAiAction(activeWorkspaceId, selectedLocation?.id || null);
        if (!isMounted) return;

        if (res.success && res.reviews.length > 0) {
          setReviews(res.reviews);
          const firstUnanswered = res.reviews.find((r) => r.status === "unanswered") || res.reviews[0];
          setSelectedReview(firstUnanswered);
          setDraftContent(firstUnanswered.reply || "");
        } else {
          setReviews(demoReviewsForTesting);
          setSelectedReview(demoReviewsForTesting[0]);
          setDraftContent(demoReviewsForTesting[0].reply || "");
        }
      } catch (e) {
        if (!isMounted) return;
        console.error("Error loading reviews for assistant:", e);
        setReviews(demoReviewsForTesting);
        setSelectedReview(demoReviewsForTesting[0]);
      } finally {
        if (isMounted) {
          setIsLoadingReviews(false);
        }
      }
    }

    fetchReviews();

    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId, selectedLocation]);

  const handleSelectReview = (rev: AssistantReview) => {
    setSelectedReview(rev);
    setDraftContent(rev.reply || "");
    setStatusMsg(null);
  };

  const handleGenerateReply = async () => {
    if (!selectedReview) return;

    setIsGenerating(true);
    setStatusMsg(null);

    try {
      const res = await generateAiReplyAction({
        authorName: selectedReview.author,
        rating: selectedReview.rating,
        reviewContent: selectedReview.content,
        locationName: selectedReview.location,
        tone,
        workspaceId: activeWorkspaceId || undefined,
        reviewId: selectedReview.id,
      });

      if (res.reply) {
        setDraftContent(res.reply);
        const engineNotice = res.fallbackUsed
          ? "Generated context-aware response using built-in safety rules."
          : `Generated tailored response using ${aiProviderStatus.model}.`;
        setStatusMsg({
          type: "success",
          text: `Draft generated! ${engineNotice} Review and fine-tune below.`,
        });
      } else if (res.error) {
        setStatusMsg({ type: "error", text: res.error });
      }
    } catch (err: unknown) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to generate reply.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedReview || !draftContent.trim()) return;

    setIsSaving(true);
    setStatusMsg(null);

    try {
      const res = await saveReviewReplyAction({
        reviewId: selectedReview.id,
        workspaceId: activeWorkspaceId || undefined,
        content: draftContent,
        tone,
        isAiGenerated: true,
        isDemo: selectedReview.isDemo,
        publishToGoogle: false, // Explicitly safe: NEVER publish during assistant testing
      });

      if (res.success) {
        setStatusMsg({
          type: "success",
          text: res.message || "Draft saved to workspace! It is ready for approval.",
        });
        // Update local review state
        setReviews((prev) =>
          prev.map((r) =>
            r.id === selectedReview.id ? { ...r, reply: draftContent, replyStatus: "draft" } : r
          )
        );
      } else {
        setStatusMsg({ type: "error", text: res.error || "Failed to save draft." });
      }
    } catch (err: unknown) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving draft.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyClipboard = () => {
    if (!draftContent) return;
    navigator.clipboard.writeText(draftContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tones: Array<{ id: ReplyTone; label: string; desc: string }> = [
    { id: "professional", label: "Professional", desc: "Structured, polite, brand-safe" },
    { id: "friendly", label: "Friendly", desc: "Warm, welcoming, appreciative" },
    { id: "concise", label: "Concise", desc: "Direct, short, time-efficient" },
    { id: "empathetic", label: "Empathetic", desc: "Understanding, restorative" },
  ];

  return (
    <div className="space-y-6 max-w-7xl w-full font-sans">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">AI Reply Assistant</h2>
            <Badge className="bg-slate-900 text-white text-[10px] px-2 py-0.5">Interactive Studio</Badge>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Guided 4-step workflow to generate, fine-tune, and save context-aware responses to customer feedback.
          </p>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-2">
          {selectedLocation ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-semibold truncate max-w-[150px]">{selectedLocation.name}</span>
            </div>
          ) : (
            <Link
              href="/dashboard/locations"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 shadow-2xs"
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span>Connect Business Profile</span>
            </Link>
          )}

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-600 shadow-2xs">
            <Bot className="w-3.5 h-3.5 text-blue-600" />
            <span>{aiProviderStatus.configured ? `OpenAI (${aiProviderStatus.model})` : "Rule Engine"}</span>
          </div>
        </div>
      </div>

      {/* Guided 4-Step Interactive Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Review Selector (Step 1) */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                    1
                  </span>
                  <CardTitle className="text-sm font-semibold text-slate-900">Select Customer Review</CardTitle>
                </div>
                <CardDescription className="text-xs text-slate-500 mt-0.5">
                  Choose a review from your connected inbox or demo samples.
                </CardDescription>
              </div>
              <span className="text-[11px] font-mono font-medium text-slate-500">
                {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
              </span>
            </CardHeader>

            <CardContent className="p-3 space-y-2 max-h-[520px] overflow-y-auto">
              {isLoadingReviews ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-900" />
                  <p className="text-xs">Loading reviews...</p>
                </div>
              ) : reviews.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">No reviews found.</div>
              ) : (
                reviews.map((rev) => {
                  const isSelected = selectedReview?.id === rev.id;
                  return (
                    <div
                      key={rev.id}
                      onClick={() => handleSelectReview(rev)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                        isSelected
                          ? "border-slate-900 bg-slate-50/90 shadow-2xs"
                          : "border-slate-200 bg-white hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-900">{rev.author}</span>
                          {rev.isDemo && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              Demo
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-3 h-3 ${
                                star <= rev.rating ? "text-amber-400 fill-amber-400" : "text-slate-200"
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">&ldquo;{rev.content}&rdquo;</p>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                        <span>{rev.date}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium capitalize ${
                            rev.replyStatus === "draft"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : rev.status === "unanswered"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {rev.replyStatus === "draft" ? "Draft Ready" : rev.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Steps 2, 3, and 4 */}
        <div className="lg:col-span-7 space-y-5">
          {/* Step 2: Tone Selection */}
          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                  2
                </span>
                <CardTitle className="text-sm font-semibold text-slate-900">Choose Reply Tone & Strategy</CardTitle>
              </div>
              <CardDescription className="text-xs text-slate-500">
                The AI adapts its vocabulary, empathy level, and next-step resolution based on your selected tone.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {tones.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      tone === t.id
                        ? "border-slate-900 bg-slate-900 text-white shadow-2xs"
                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    <p className="text-xs font-bold capitalize">{t.label}</p>
                    <p className={`text-[10px] mt-0.5 ${tone === t.id ? "text-slate-300" : "text-slate-500"}`}>
                      {t.desc}
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Step 3 & 4: Generation and Fine-Tuning */}
          <Card className="border-slate-200 bg-white shadow-xs rounded-2xl">
            <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                    3 & 4
                  </span>
                  <CardTitle className="text-sm font-semibold text-slate-900">Generate & Fine-Tune Draft</CardTitle>
                </div>
                <CardDescription className="text-xs text-slate-500">
                  Review the proposed AI wording, make manual adjustments, and save as draft.
                </CardDescription>
              </div>

              <Button
                onClick={handleGenerateReply}
                disabled={isGenerating || !selectedReview}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-3.5 font-medium shadow-xs gap-1.5"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" /> Generate AI Reply
                  </>
                )}
              </Button>
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              {/* Feedback Alert */}
              {statusMsg && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                    statusMsg.type === "success"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                      : "bg-red-50 border-red-200 text-red-950"
                  }`}
                >
                  {statusMsg.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <span>{statusMsg.text}</span>
                </div>
              )}

              {/* Selected Review Summary Banner */}
              {selectedReview && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">Replying to {selectedReview.author}</span>
                    <span className="text-[11px] text-slate-500">{selectedReview.rating} Stars</span>
                  </div>
                  <p className="text-slate-600 italic leading-relaxed">&ldquo;{selectedReview.content}&rdquo;</p>
                </div>
              )}

              {/* Textarea Editor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="ai-draft-editor" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <FileEdit className="w-3.5 h-3.5" /> Response Draft Editor
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {draftContent.length} chars • {draftContent.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>

                <Textarea
                  id="ai-draft-editor"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="Click 'Generate AI Reply' above or type your customized reply here..."
                  rows={5}
                  className="text-xs leading-relaxed border-slate-200 rounded-xl focus:ring-slate-900"
                />
              </div>

              {/* Actions & Distinction Explanation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyClipboard}
                    disabled={!draftContent.trim()}
                    className="text-xs h-9 gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" /> Copy to Clipboard
                      </>
                    )}
                  </Button>

                  <Button
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={isSaving || !draftContent.trim()}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-3.5 font-medium shadow-xs gap-1.5"
                    title={
                      selectedReview?.isDemo
                        ? "Demo mode: draft is stored locally in-memory only and never published to Google."
                        : "Saves as a private draft in your workspace database. Never published to Google without approval."
                    }
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        {selectedReview?.isDemo ? "Update Demo Draft" : "Save as Draft"}
                      </>
                    )}
                  </Button>
                </div>

                <Link
                  href="/dashboard/settings"
                  className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 underline underline-offset-2"
                >
                  <SlidersHorizontal className="w-3 h-3" /> Auto-Publish Rules in Settings
                </Link>
              </div>

              {/* Safety & Publishing Notice */}
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-[11px] text-slate-500 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-700">Draft vs. Live Publishing Guarantee</p>
                  <p>
                    Saving here stores the response as a private draft in your NexRep database. Live replies are never
                    published to Google Business Profile unless explicitly confirmed by a team member or permitted by
                    your Auto-Publish settings.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
