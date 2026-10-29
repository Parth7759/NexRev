"use client";

import React, { useState } from "react";
import {
  Star,
  Sparkles,
  Copy,
  ExternalLink,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { recordPublicQrInteractionAction } from "@/app/dashboard/qr/actions";

export interface PublicQrLandingData {
  id: string;
  title: string;
  callToAction: string;
  businessName: string;
  address: string | null;
  googleReviewUrl: string;
  hasPlaceId: boolean;
}

const POSITIVE_TAGS = [
  "Friendly staff",
  "Quick service",
  "Clean & welcoming",
  "Great quality",
  "Helpful advice",
  "Fair pricing",
  "Exceeded expectations",
];

const CONSTRUCTIVE_TAGS = [
  "Wait time",
  "Staff communication",
  "Pricing transparency",
  "Product availability",
  "Facility cleanliness",
  "Customer follow-up",
];

export function PublicReviewClient({
  qrData,
}: {
  qrData: PublicQrLandingData;
}) {
  const [rating, setRating] = useState<number>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>(["Friendly staff", "Quick service"]);
  const [customerNotes, setCustomerNotes] = useState<string>("");
  const [reviewText, setReviewText] = useState<string>("");

  // AI Suggestion State
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{
    short: string;
    detailed: string;
    natural: string;
  } | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<"short" | "detailed" | "natural">("natural");

  // Interaction Feedback
  const [hasCopied, setHasCopied] = useState<boolean>(false);
  const [showPasteGuide, setShowPasteGuide] = useState<boolean>(false);

  // Available tags change based on rating (positive vs constructive)
  const availableTags = rating >= 4 ? POSITIVE_TAGS : CONSTRUCTIVE_TAGS;

  const handleRatingChange = (newRating: number) => {
    setRating(newRating);
    // Suggest appropriate default tag if none selected
    if (newRating <= 3) {
      setSelectedTags(["Staff communication"]);
    } else {
      setSelectedTags(["Friendly staff", "Quick service"]);
    }
  };

  const handleToggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleGenerateAiSuggestions = async () => {
    setIsGeneratingAi(true);
    setAiError(null);

    try {
      const response = await fetch("/api/ai/customer-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: qrData.businessName,
          rating,
          experienceTags: selectedTags,
          customerNotes: customerNotes.trim(),
          multiStyle: true,
        }),
      });

      const res = await response.json();

      if (!res.success || !res.suggestions) {
        setAiError(res.error || "Could not generate review draft. Please write your thoughts directly.");
      } else {
        setSuggestions(res.suggestions);
        // Pre-fill textarea with the selected style
        const activeDraft = res.suggestions[selectedStyle] || res.suggestions.natural;
        setReviewText(activeDraft);

        // Record suggestion generation telemetry (non-blocking)
        recordPublicQrInteractionAction(qrData.id, "suggestion_generated").catch(() => {});
      }
    } catch (err: unknown) {
      setAiError(
        err instanceof Error ? err.message : "Failed to connect to review assistant."
      );
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleSelectStyle = (style: "short" | "detailed" | "natural") => {
    setSelectedStyle(style);
    if (suggestions && suggestions[style]) {
      setReviewText(suggestions[style]);
    }
  };

  const handleContinueToGoogle = async () => {
    const textToCopy = reviewText.trim();

    // 1. Copy text to clipboard if provided
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        setHasCopied(true);
      } catch {
        // Fallback if clipboard API restricted
      }
    }

    // 2. Log interaction
    recordPublicQrInteractionAction(qrData.id, "google_click").catch(() => {});

    // 3. Show step-by-step guidance banner
    setShowPasteGuide(true);

    // 4. Open Google review link in new tab
    const targetUrl = qrData.googleReviewUrl;
    setTimeout(() => {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }, 400);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-emerald-50/20 to-slate-100 text-slate-900 font-sans p-4 sm:p-6 flex flex-col items-center justify-between">
      <div className="w-full max-w-lg mx-auto space-y-5 py-4">
        {/* Business Header Card */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="w-13 h-13 rounded-2xl bg-[#0B3B2C] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
              {qrData.businessName.slice(0, 2).toUpperCase()}
            </div>
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-slate-950 leading-tight truncate">
                  {qrData.businessName}
                </h1>
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border-emerald-200 gap-1 px-1.5 py-0"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  Verified
                </Badge>
              </div>

              {qrData.address && (
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{qrData.address}</span>
                </p>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-1 text-center sm:text-left">
            <h2 className="text-sm font-bold text-slate-900">{qrData.title}</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {qrData.callToAction}
            </p>
          </div>
        </div>

        {/* Step-by-Step Guidance Banner when user clicked Continue to Google */}
        {showPasteGuide && (
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-xs text-emerald-950 shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-emerald-950 text-sm">
                    {hasCopied ? "Review Draft Copied to Clipboard!" : "Opening Google Review Form..."}
                  </p>
                  <p className="text-emerald-900 leading-relaxed">
                    Google has opened in your browser. On Google&apos;s review screen:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 pl-1 text-[11px] font-medium text-emerald-950">
                    <li>Select your star rating on Google</li>
                    <li>Tap and hold the review text box, then tap <strong>Paste</strong></li>
                    <li>Tap <strong>Post</strong> to submit your review</li>
                  </ol>
                </div>
              </div>
              <button
                onClick={() => setShowPasteGuide(false)}
                className="text-emerald-700 hover:text-emerald-950 p-1"
                aria-label="Close message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 pt-2.5 border-t border-emerald-200 flex justify-end">
              <a
                href={qrData.googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-emerald-800 hover:text-emerald-950 text-xs"
              >
                Re-open Google Review Form <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Interactive Review Flow Card */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
          {/* 1. Rating Selector */}
          <div className="space-y-2 text-center">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              1. Tap Your Overall Rating
            </label>
            <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
              {[1, 2, 3, 4, 5].map((star) => {
                const isFilled = star <= rating;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleRatingChange(star)}
                    className="p-1 transition-transform active:scale-90 hover:scale-110 focus:outline-none"
                    aria-label={`Rate ${star} out of 5 stars`}
                  >
                    <Star
                      className={`w-9 h-9 sm:w-10 sm:h-10 transition-colors ${
                        isFilled
                          ? "fill-amber-400 text-amber-400 drop-shadow-xs"
                          : "fill-transparent text-slate-300 hover:text-amber-200"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-xs font-medium text-slate-600">
              {rating === 5 && "Outstanding Experience"}
              {rating === 4 && "Great Experience"}
              {rating === 3 && "Average / Room for Improvement"}
              {rating === 2 && "Disappointing Visit"}
              {rating === 1 && "Poor Experience"}
            </p>
          </div>

          {/* 2. Highlight Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                2. What Stood Out Most?
              </label>
              <span className="text-[11px] text-slate-400">Select any that apply</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleTag(tag)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                      isSelected
                        ? "bg-[#0B3B2C] text-white shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200/80 text-slate-700"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Optional Customer Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              3. Any Specific Notes? (Optional)
            </label>
            <input
              type="text"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              placeholder="e.g., Visited for lunch, great coffee, smooth checkout..."
              className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* 4. AI Suggestion Assistant Trigger */}
          <div className="pt-1 space-y-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateAiSuggestions}
              disabled={isGeneratingAi}
              className="w-full h-10 rounded-xl border-emerald-300 bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-900 text-xs font-semibold gap-1.5 shadow-2xs"
            >
              <Sparkles className={`w-4 h-4 text-emerald-700 ${isGeneratingAi ? "animate-spin" : ""}`} />
              {isGeneratingAi ? "Crafting authentic suggestions..." : "Suggest Review Draft with AI"}
            </Button>

            {aiError && (
              <p className="text-[11px] text-rose-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {aiError}
              </p>
            )}

            {/* Multi-Style Pill Tabs if suggestions are loaded */}
            {suggestions && (
              <div className="space-y-2 pt-2 animate-in fade-in duration-150">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Choose Draft Style:</span>
                  <span className="text-[11px] text-slate-500">Tap to populate below</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-medium text-center">
                  <button
                    type="button"
                    onClick={() => handleSelectStyle("short")}
                    className={`py-1.5 rounded-lg transition-all ${
                      selectedStyle === "short"
                        ? "bg-white text-emerald-900 font-bold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Short
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectStyle("detailed")}
                    className={`py-1.5 rounded-lg transition-all ${
                      selectedStyle === "detailed"
                        ? "bg-white text-emerald-900 font-bold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Detailed
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectStyle("natural")}
                    className={`py-1.5 rounded-lg transition-all ${
                      selectedStyle === "natural"
                        ? "bg-white text-emerald-900 font-bold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Natural
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Editable Review Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Your Review Text
              </label>
              <span className="text-[11px] text-slate-400">
                {reviewText.length > 0 ? `${reviewText.length} characters` : "Editable draft"}
              </span>
            </div>
            <Textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Write your genuine experience or use the AI suggestion button above..."
              className="min-h-[110px] text-xs resize-y rounded-xl border-slate-200 bg-white leading-relaxed p-3 focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-slate-500">
              You can edit, rewrite, or add any details to make this 100% your own.
            </p>
          </div>

          {/* 6. Primary Action: Copy & Continue to Google */}
          <div className="space-y-2 pt-2">
            <Button
              type="button"
              onClick={handleContinueToGoogle}
              className="w-full h-12 rounded-2xl bg-[#0B3B2C] hover:bg-[#082D22] text-white text-sm font-bold shadow-md gap-2"
            >
              <Copy className="w-4 h-4" />
              <span>Copy & Continue to Google</span>
              <ExternalLink className="w-4 h-4 ml-auto opacity-70" />
            </Button>

            {/* Direct Skip Link */}
            <div className="text-center pt-1">
              <a
                href={qrData.googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  recordPublicQrInteractionAction(qrData.id, "google_click").catch(() => {});
                }}
                className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-4 font-medium inline-flex items-center gap-1"
              >
                Skip directly to Google review form <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Informative Google Policy & Neutrality Disclosure */}
        <div className="rounded-2xl bg-white/70 border border-slate-200/80 p-4 text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
          <p className="font-semibold text-slate-700 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            How this works with Google Reviews
          </p>
          <p>
            Google requires all reviews to be submitted directly by you on their official platform. To keep your experience smooth, your selected review text is automatically copied to your clipboard so you can paste it into Google&apos;s review box in one tap.
          </p>
          <p className="text-slate-400 text-[10px]">
            NexRep provides neutral review access in compliance with FTC and Google guidelines. Reviews are not gated, filtered, or altered.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-4 text-[11px] text-slate-400">
        Powered by NexRep Review Engine
      </footer>
    </div>
  );
}
