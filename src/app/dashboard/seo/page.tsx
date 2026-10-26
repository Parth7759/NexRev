"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Building2,
  Copy,
  Check,
  Info,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "@/contexts/location-context";
import { ContextualHelp } from "@/components/ui/contextual-help";

interface KeywordItem {
  keyword: string;
  intent: "Near Me" | "Commercial" | "Transactional" | "Informational";
  relevance: "High" | "Medium";
  category: "Primary" | "Secondary";
  suggestedUsage: string;
}

export default function LocalSeoKeywordsPage() {
  const { selectedLocation } = useLocation();

  const [categoryInput, setCategoryInput] = useState("Technology & Software Consulting");
  const [locationInput, setLocationInput] = useState(
    selectedLocation?.address?.split(",")[1]?.trim() || "Ahmedabad"
  );
  const [copiedKeyword, setCopiedKeyword] = useState<string | null>(null);
  const [copiedDescription, setCopiedDescription] = useState(false);

  // Dynamic Keyword Generator based on Category & Location
  const keywords: KeywordItem[] = useMemo(() => {
    const loc = locationInput || "Local Area";
    const cat = categoryInput || "Services";

    return [
      {
        keyword: `${cat} near me`,
        intent: "Near Me",
        relevance: "High",
        category: "Primary",
        suggestedUsage: "Primary Category & First sentence of Business Description",
      },
      {
        keyword: `Best ${cat} in ${loc}`,
        intent: "Commercial",
        relevance: "High",
        category: "Primary",
        suggestedUsage: "Google Post headlines & Review reply mentions",
      },
      {
        keyword: `Top rated ${cat} ${loc}`,
        intent: "Commercial",
        relevance: "High",
        category: "Primary",
        suggestedUsage: "Website Landing Page meta description & Post copy",
      },
      {
        keyword: `Reputation management agency in ${loc}`,
        intent: "Transactional",
        relevance: "High",
        category: "Secondary",
        suggestedUsage: "Services list & Custom service attribute",
      },
      {
        keyword: `Google Business Profile optimization ${loc}`,
        intent: "Transactional",
        relevance: "High",
        category: "Secondary",
        suggestedUsage: "Google Post CTA & Weekly update post",
      },
      {
        keyword: `How to improve local customer reviews in ${loc}`,
        intent: "Informational",
        relevance: "Medium",
        category: "Secondary",
        suggestedUsage: "Educational Google Post or blog topic",
      },
      {
        keyword: `Affordable ${cat} consultation`,
        intent: "Commercial",
        relevance: "Medium",
        category: "Secondary",
        suggestedUsage: "Special Offer post promo copy",
      },
    ];
  }, [categoryInput, locationInput]);

  // Optimized 750-char Business Description
  const optimizedDescription = useMemo(() => {
    const bizName = selectedLocation?.name || "NexFlowOps Technologies";
    const loc = locationInput || "Ahmedabad";
    return `${bizName} is a top-rated technology and SaaS consulting firm based in ${loc}. We specialize in cloud infrastructure engineering, enterprise software development, and automated Google Business Profile reputation management. Our team helps local and global enterprises streamline customer review replies, improve search visibility on Google Maps, and enhance customer trust through automated AI assistance. Visit our office in ${loc} or contact us online to schedule your consultation.`;
  }, [selectedLocation, locationInput]);

  // Copy helper
  const handleCopy = (text: string, isDesc: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isDesc) {
      setCopiedDescription(true);
      setTimeout(() => setCopiedDescription(false), 2000);
    } else {
      setCopiedKeyword(text);
      setTimeout(() => setCopiedKeyword(null), 2000);
    }
  };

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Local SEO & Keyword Studio
            </h1>
            <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
              Search Intelligence
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {selectedLocation
              ? `Keyword optimization & local search ranking prompts for ${selectedLocation.name}`
              : "Generate local SEO keywords and Google Business Profile copy."}
          </p>
        </div>

        {selectedLocation && (
          <Badge className="bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1">
            Active: {selectedLocation.name}
          </Badge>
        )}
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Local SEO & Keyword Discovery"
        dataType="ai"
        summary="Discover localized search phrases and copy suggestions tailored to your primary category and neighborhood. Suggestions are AI-generated based on best practices, not measured rank tracker data."
        proTips={[
          "Sprinkling 'Near Me' and transactional keywords naturally across your business description improves map pack visibility.",
          "Keep your primary Google Business category exact; secondary categories should represent specialized sub-services.",
        ]}
      />

      {!selectedLocation ? (
        <Card className="border-slate-200/90 bg-white shadow-sm p-10 text-center rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Select Business Profile</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Choose an active Google Business Profile to generate targeted local keywords.
          </p>
          <Link href="/dashboard/locations?select_profile=1" className="mt-4 inline-block">
            <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl">
              Select Profile
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Transparent AI Disclosure */}
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-xs text-emerald-950 flex items-start gap-3">
            <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed text-[11px]">
              <p className="font-bold text-emerald-900">
                AI Suggestion Transparency & Truthful Data Notice:
              </p>
              <p className="text-emerald-800">
                The keyword clusters, intent tags, and business description below are algorithmic recommendations based on local semantic search intent for your category and region. NexRep strictly distinguishes search intent suggestions from measured third-party search volumes. We never invent fake ranking positions or competitor data.
              </p>
            </div>
          </div>

          {/* Configuration Inputs */}
          <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Primary Business Category
                </label>
                <Input
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  placeholder="e.g. Restaurant, Dental Clinic, IT Consulting"
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Target City or Service Area
                </label>
                <Input
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="e.g. Ahmedabad, Mumbai, New York"
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </Card>

          {/* Keywords Recommendations Grid */}
          <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Target Local Keywords & Intent Mapping
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  High-intent queries to incorporate into your review replies, posts, and profile
                </p>
              </div>
              <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
                {keywords.length} Suggested Queries
              </Badge>
            </div>

            <div className="divide-y divide-slate-100">
              {keywords.map((item, idx) => (
                <div key={idx} className="p-4 hover:bg-slate-50/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 font-mono text-xs">
                        {item.keyword}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] uppercase font-bold px-1.5 py-0 ${
                          item.intent === "Near Me"
                            ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                            : item.intent === "Commercial"
                            ? "border-blue-200 text-blue-700 bg-blue-50"
                            : item.intent === "Transactional"
                            ? "border-purple-200 text-purple-700 bg-purple-50"
                            : "border-slate-200 text-slate-600 bg-slate-50"
                        }`}
                      >
                        {item.intent}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[9px] font-semibold px-1.5 py-0 border-slate-200 text-slate-500"
                      >
                        {item.category}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      <strong>Best Used In:</strong> {item.suggestedUsage}
                    </p>
                  </div>

                  <Button
                    onClick={() => handleCopy(item.keyword)}
                    variant="outline"
                    className="h-8 text-[11px] font-semibold gap-1.5 shrink-0 border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    {copiedKeyword === item.keyword ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" /> Copy
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          {/* Business Description Optimizer & Post Topics */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Optimized Business Description */}
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Optimized Profile Description
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Keyword-rich draft tailored for Google Search
                  </p>
                </div>
                <Button
                  onClick={() => handleCopy(optimizedDescription, true)}
                  variant="outline"
                  className="h-8 text-[11px] font-semibold gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  {copiedDescription ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" /> Copy Description
                    </>
                  )}
                </Button>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 leading-relaxed font-sans select-text">
                {optimizedDescription}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Length: {optimizedDescription.length} / 750 max</span>
                <span className="text-emerald-700 font-semibold font-sans">Ready to paste into GBP</span>
              </div>
            </Card>

            {/* Local Google Post Topic Ideas */}
            <Card className="bg-white border border-slate-200/80 shadow-xs rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Local Post Topic Prompts
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Recommended themes to post this week
                  </p>
                </div>
                <Link href="/dashboard/posts">
                  <Button variant="outline" className="h-8 text-[11px] font-semibold gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50">
                    Create Post <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100/80 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Local Customer Milestone
                  </span>
                  <p className="font-semibold text-slate-900">
                    &ldquo;Thanking our {locationInput} customers for another 5-star week&rdquo;
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Highlight a recent positive customer quote and mention your service area.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100/80 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                    Service Highlight
                  </span>
                  <p className="font-semibold text-slate-900">
                    &ldquo;Why businesses in {locationInput} choose our {categoryInput}&rdquo;
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Focus on fast turnaround time and reliable client communication.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100/80 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800">
                    Behind-the-Scenes & Team
                  </span>
                  <p className="font-semibold text-slate-900">
                    &ldquo;Meet the team behind {selectedLocation.name}&rdquo;
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Humanize your brand with team photos to drive higher local engagement.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
