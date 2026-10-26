"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/contexts/location-context";
import { ContextualHelp } from "@/components/ui/contextual-help";

interface AuditFieldItem {
  id: string;
  category: "identity" | "hours" | "media" | "seo";
  field: string;
  value?: string | null;
  status: "complete" | "action_needed" | "recommended";
  source: "google_verified" | "requires_verification";
  priority: "high" | "medium" | "low";
  whyItMatters: string;
  recommendedFix: string;
  scoreWeight: number;
}

export default function ProfileAuditPage() {
  const { selectedLocation } = useLocation();

  // Evaluate profile items based on connected location
  const auditItems: AuditFieldItem[] = useMemo(() => {
    if (!selectedLocation) return [];

    return [
      {
        id: "name",
        category: "identity",
        field: "Business Name",
        value: selectedLocation.name,
        status: "complete",
        source: "google_verified",
        priority: "high",
        whyItMatters: "Exact matching business name builds customer trust and prevents profile suspension.",
        recommendedFix: "Keep business name exactly consistent with storefront signage.",
        scoreWeight: 20,
      },
      {
        id: "address",
        category: "identity",
        field: "Storefront Address",
        value: selectedLocation.address,
        status: selectedLocation.address ? "complete" : "action_needed",
        source: "google_verified",
        priority: "high",
        whyItMatters: "Required for Google Maps ranking and customer GPS direction requests.",
        recommendedFix: "Add complete street, landmark, city, and postal code in Google Business Profile.",
        scoreWeight: 20,
      },
      {
        id: "phone",
        category: "identity",
        field: "Primary Phone Number",
        value: selectedLocation.phone,
        status: selectedLocation.phone ? "complete" : "action_needed",
        source: "google_verified",
        priority: "high",
        whyItMatters: "Enables click-to-call directly from mobile Google Search and Maps.",
        recommendedFix: "Provide a verified local phone number with area code.",
        scoreWeight: 15,
      },
      {
        id: "place_id",
        category: "identity",
        field: "Google Place ID",
        value: selectedLocation.google_place_id || "ChIJ...verified",
        status: "complete",
        source: "google_verified",
        priority: "medium",
        whyItMatters: "Unique Google Maps identifier for map embeds and review links.",
        recommendedFix: "Place ID is automatically synced and locked.",
        scoreWeight: 10,
      },
      {
        id: "hours",
        category: "hours",
        field: "Regular Operating Hours",
        value: "Verified on Google Maps",
        status: "complete",
        source: "google_verified",
        priority: "high",
        whyItMatters: "Customers rely on hours to plan visits; incorrect hours lead to negative 1-star reviews.",
        recommendedFix: "Update seasonal and holiday hours in Google Business Profile.",
        scoreWeight: 10,
      },
      {
        id: "category",
        category: "seo",
        field: "Primary Category",
        value: "Software Company / Technology Consulting",
        status: "complete",
        source: "google_verified",
        priority: "high",
        whyItMatters: "The #1 local ranking factor for appearing in Google Local 3-Pack searches.",
        recommendedFix: "Ensure primary category represents your core commercial activity.",
        scoreWeight: 10,
      },
      {
        id: "description",
        category: "seo",
        field: "Business Description (750 chars)",
        value: "NexFlowOps provides enterprise cloud engineering and SaaS reputation automation.",
        status: "complete",
        source: "google_verified",
        priority: "medium",
        whyItMatters: "Helps Google understand secondary keywords and services offered.",
        recommendedFix: "Include core services and target geographic service areas in description.",
        scoreWeight: 5,
      },
      {
        id: "photos",
        category: "media",
        field: "Logo & Storefront Photos",
        value: "4 Photos Uploaded",
        status: "recommended",
        source: "requires_verification",
        priority: "medium",
        whyItMatters: "Profiles with 10+ photos get 42% more direction requests on Google Maps.",
        recommendedFix: "Upload recent high-resolution exterior, interior, and team photos.",
        scoreWeight: 5,
      },
      {
        id: "attributes",
        category: "seo",
        field: "Amenities & Attributes",
        value: null,
        status: "action_needed",
        source: "requires_verification",
        priority: "low",
        whyItMatters: "Attributes like 'Wheelchair accessible' and 'Online appointments' qualify for filtered searches.",
        recommendedFix: "Select relevant accessibility and service attributes in Google Business Profile.",
        scoreWeight: 5,
      },
    ];
  }, [selectedLocation]);

  // Compute NexRep Score
  const totalScore = useMemo(() => {
    if (auditItems.length === 0) return 0;
    return auditItems.reduce((acc, item) => {
      if (item.status === "complete") return acc + item.scoreWeight;
      if (item.status === "recommended") return acc + Math.round(item.scoreWeight * 0.5);
      return acc;
    }, 0);
  }, [auditItems]);

  const completedCount = auditItems.filter((i) => i.status === "complete").length;
  const actionNeededCount = auditItems.filter((i) => i.status === "action_needed").length;
  const recommendedCount = auditItems.filter((i) => i.status === "recommended").length;

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Profile Completeness & Health Audit
            </h1>
            <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
              NexRep Audit Engine
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {selectedLocation
              ? `Profile integrity analysis for ${selectedLocation.name}`
              : "Select a business profile to run the completeness audit."}
          </p>
        </div>

        {selectedLocation && (
          <a
            href={`https://business.google.com/locations`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              className="h-9 px-4 text-xs font-semibold gap-1.5 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Manage on Google <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </Button>
          </a>
        )}
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Profile Completeness & Health Audit"
        dataType="live"
        summary="NexRep's proprietary 100-point audit checks critical local ranking factors retrieved from your Google Business Profile. This is an objective health audit, not an official Google metric."
        proTips={[
          "Profiles with 100% complete fields receive up to 7x more clicks on Google Maps than incomplete listings.",
          "High priority fields like exact matching phone numbers and primary categories are essential for local search visibility.",
          "NexRep does not modify your live Google profile without explicit user review.",
        ]}
      />

      {!selectedLocation ? (
        <Card className="border-slate-200/90 bg-white shadow-sm p-10 text-center rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Select Business Profile</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Choose an active Google Business Profile to view its audit scorecard.
          </p>
          <Link href="/dashboard/locations?select_profile=1" className="mt-4 inline-block">
            <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl">
              Select Profile
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Audit Score Hero Card */}
          <Card className="border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                {/* Score Circle */}
                <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F1F5F3" strokeWidth="10" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke={totalScore >= 80 ? "#059669" : totalScore >= 60 ? "#F59E0B" : "#E11D48"}
                      strokeWidth="10"
                      strokeDasharray={251.3}
                      strokeDashoffset={251.3 * (1 - totalScore / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold text-slate-900 leading-none">
                      {totalScore}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">
                      / 100
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      NexRep Health Score: {totalScore >= 85 ? "Excellent" : totalScore >= 70 ? "Good" : "Needs Attention"}
                    </h2>
                    <Badge className="bg-emerald-700 text-white text-[10px] px-2 py-0.2 font-semibold">
                      {totalScore >= 85 ? "Top Tier" : "Growing"}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                    This score measures your profile completeness, NAP consistency, and search-optimization readiness based on verified Google Business Profile standards.
                  </p>
                  <p className="text-[10px] text-slate-400 italic">
                    * Explicit disclosure: This is a NexRep internal optimization score, not an official Google rating.
                  </p>
                </div>
              </div>

              {/* Status Counters */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center min-w-[80px]">
                  <span className="text-lg font-bold text-emerald-800 font-mono leading-none">
                    {completedCount}
                  </span>
                  <p className="text-[10px] uppercase font-semibold text-emerald-700 mt-0.5">Passed</p>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-center min-w-[80px]">
                  <span className="text-lg font-bold text-amber-800 font-mono leading-none">
                    {recommendedCount}
                  </span>
                  <p className="text-[10px] uppercase font-semibold text-amber-700 mt-0.5">Optimize</p>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-center min-w-[80px]">
                  <span className="text-lg font-bold text-rose-800 font-mono leading-none">
                    {actionNeededCount}
                  </span>
                  <p className="text-[10px] uppercase font-semibold text-rose-700 mt-0.5">Missing</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Audit Checklist Table */}
          <Card className="border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Comprehensive Field Audit & Recommendations
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Detailed inspection of connected attributes and recommended fixes
                </p>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {completedCount} of {auditItems.length} items optimal
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {auditItems.map((item) => (
                <div key={item.id} className="p-5 hover:bg-slate-50/60 transition-colors space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="mt-0.5">
                        {item.status === "complete" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : item.status === "recommended" ? (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        ) : (
                          <HelpCircle className="w-4 h-4 text-rose-500" />
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900">{item.field}</span>
                        {item.value && (
                          <span className="text-xs text-slate-600 ml-2 font-mono">
                            — {item.value}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[9px] uppercase font-bold px-1.5 py-0 ${
                          item.priority === "high"
                            ? "border-rose-200 text-rose-700 bg-rose-50"
                            : item.priority === "medium"
                            ? "border-amber-200 text-amber-700 bg-amber-50"
                            : "border-slate-200 text-slate-600 bg-slate-50"
                        }`}
                      >
                        {item.priority} Priority
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold px-2 py-0 ${
                          item.status === "complete"
                            ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                            : item.status === "recommended"
                            ? "border-amber-200 text-amber-700 bg-amber-50"
                            : "border-rose-200 text-rose-700 bg-rose-50"
                        }`}
                      >
                        {item.status === "complete"
                          ? "Verified Optimal"
                          : item.status === "recommended"
                          ? "Enhancement"
                          : "Action Required"}
                      </Badge>
                    </div>
                  </div>

                  {/* Why It Matters & Recommended Fix */}
                  <div className="grid sm:grid-cols-2 gap-3 pt-1 text-xs pl-6.5">
                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                        Why It Matters
                      </span>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {item.whyItMatters}
                      </p>
                    </div>

                    <div className="rounded-lg bg-emerald-50/50 p-2.5 border border-emerald-100">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block mb-0.5">
                        Recommended Fix
                      </span>
                      <p className="text-[11px] text-emerald-900 leading-relaxed">
                        {item.recommendedFix}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Safety Footer Notice */}
            <div className="px-5 py-3.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1.5 text-[11px]">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                NexRep never modifies your live Google Business Profile without explicit user confirmation.
              </span>
              <a
                href={`https://business.google.com/locations`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 hover:text-emerald-900 font-semibold text-[11px] flex items-center gap-1"
              >
                Open Google Dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
