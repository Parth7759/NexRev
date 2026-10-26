"use client";

import React, { useState } from "react";
import {
  CreditCard,
  Check,
  Info,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/contexts/location-context";
import { ContextualHelp } from "@/components/ui/contextual-help";

interface PlanTier {
  id: string;
  name: string;
  price: string;
  period: string;
  locationsAllowed: string;
  description: string;
  popular?: boolean;
  features: string[];
}

export default function PlansBillingPage() {
  const { selectedLocation } = useLocation();

  const [selectedPlan, setSelectedPlan] = useState("growth");
  const [upgradeRequested, setUpgradeRequested] = useState<string | null>(null);

  const proposedPlans: PlanTier[] = [
    {
      id: "starter",
      name: "Starter",
      price: "₹999",
      period: "/ month",
      locationsAllowed: "1 Location",
      description: "Essential AI review replies and Google reputation monitoring for single businesses.",
      features: [
        "1 Google Business Profile location",
        "Continuous Google review synchronization",
        "Context-aware AI review replies",
        "Manual & Auto-publish safety modes",
        "Standard Overview Dashboard",
      ],
    },
    {
      id: "growth",
      name: "Growth",
      price: "₹2,499",
      period: "/ month",
      locationsAllowed: "Up to 3 Locations",
      description: "Complete local business growth engine with keyword intelligence and profile audits.",
      popular: true,
      features: [
        "Up to 3 Google Business Profile locations",
        "Priority context-aware AI replies (4 tones)",
        "Reputation Analytics & CSV export",
        "NexRep Profile Completeness Audit",
        "Local SEO & Keyword Studio",
        "Persistent workspace notifications",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      price: "₹4,999",
      period: "/ month",
      locationsAllowed: "Up to 10 Locations",
      description: "Advanced multi-location reputation management and Google Posts scheduling.",
      features: [
        "Up to 10 Google Business Profile locations",
        "Google Posts Studio (Update, Offer, Event)",
        "Executive PDF / Print Reports Centre",
        "Team access with role permissions (Admin, Member)",
        "Negative review critical safety holds",
        "Priority email and ticket support",
      ],
    },
    {
      id: "agency",
      name: "Agency",
      price: "₹9,999",
      period: "starting / mo",
      locationsAllowed: "25+ Locations",
      description: "Enterprise and marketing agency scale with white-label reporting capabilities.",
      features: [
        "25+ Google Business Profile locations",
        "White-label branded executive reports",
        "Dedicated account manager",
        "Custom API integration endpoints",
        "Multi-workspace tenant administration",
        "Enterprise 99.9% uptime SLA",
      ],
    },
  ];

  const handleRequestPlan = (planId: string) => {
    setUpgradeRequested(planId);
    setTimeout(() => setUpgradeRequested(null), 5000);
  };

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Plans & Subscription Management
            </h1>
            <Badge variant="outline" className="border-amber-200 text-amber-800 bg-amber-50 text-[10px] font-semibold">
              Proposed Pricing Tier Matrix
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Transparent SaaS plans for local business growth. All prices are proposed and subject to business owner approval.
          </p>
        </div>

        <Badge className="bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1">
          Current Tier: Growth (Demo Trial)
        </Badge>
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Plans & Subscription Billing"
        dataType="demo"
        summary="Review location quotas and proposed scaling tiers (Starter, Growth, Pro, Agency). Gateway integration is in the proposal stage without real payment processing."
        proTips={[
          "Multi-location franchises can scale smoothly up to 25+ locations with isolated team access per branch.",
          "Billing changes do not execute real financial transactions during this audit phase.",
        ]}
      />

      {/* Gateway Notice Banner */}
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-xs text-amber-950 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed text-[11px]">
          <p className="font-bold text-amber-900">
            Payment Provider & Billing Gateway Notice:
          </p>
          <p className="text-amber-800">
            Payment gateway integration (Stripe / Razorpay) is currently in proposal stage. No real payment processing, card debits, or paid entitlements will occur during this pre-deployment audit. Prices below are proposed editable tiers.
          </p>
        </div>
      </div>

      {upgradeRequested && (
        <div className="p-3 text-xs rounded-xl bg-emerald-100/80 border border-emerald-300 text-emerald-900 flex items-center gap-2 font-medium animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>Plan change request for <strong>{upgradeRequested.toUpperCase()}</strong> recorded in local demo state. Pending gateway activation.</span>
        </div>
      )}

      {/* Current Subscription Status Card */}
      <Card className="border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Current Subscription
              </span>
              <Badge className="bg-emerald-700 text-white text-[10px] font-semibold">
                Active Demonstration
              </Badge>
            </div>
            <h3 className="text-xl font-bold text-slate-900">
              Growth Plan — ₹2,499 / month (Proposed)
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-lg">
              Active for <strong>{selectedLocation?.name || "Connected Google Profile"}</strong>. Full access to AI reply studio, reputation analytics, profile audit, and SEO keywords.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 shrink-0 text-center text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400">Locations Used</span>
              <p className="text-base font-bold text-slate-900 mt-0.5">1 / 3</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-400">Billing Cycle</span>
              <p className="text-base font-bold text-slate-900 mt-0.5">Monthly</p>
            </div>
          </div>
        </div>
      </Card>

      {/* 4 Proposed Tiers Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {proposedPlans.map((plan) => {
          const isSelected = selectedPlan === plan.id;
          return (
            <Card
              key={plan.id}
              className={`rounded-2xl p-5 flex flex-col justify-between transition-all relative ${
                isSelected
                  ? "bg-white border-2 border-emerald-600 shadow-md ring-4 ring-emerald-500/10"
                  : "bg-white border border-slate-200/80 shadow-xs hover:border-slate-300"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-xs">
                    Recommended
                  </span>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                <div className="pt-1">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-slate-900 font-mono">
                      {plan.price}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">{plan.period}</span>
                  </div>
                  <Badge variant="outline" className="mt-1.5 text-[10px] font-semibold border-emerald-200 bg-emerald-50 text-emerald-800">
                    {plan.locationsAllowed}
                  </Badge>
                </div>

                {/* Features List */}
                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                  {plan.features.map((f, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="text-[11px] text-slate-600 leading-snug">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-5 mt-4">
                <Button
                  onClick={() => {
                    setSelectedPlan(plan.id);
                    handleRequestPlan(plan.id);
                  }}
                  variant={isSelected ? "default" : "outline"}
                  className={`w-full text-xs font-semibold h-9 rounded-xl ${
                    isSelected
                      ? "bg-[#0B3024] hover:bg-[#0E3D2E] text-white shadow-xs"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {plan.id === "growth" ? "Current Plan" : `Select ${plan.name}`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Payment History Placeholder */}
      <Card className="border-slate-200/80 bg-white rounded-2xl shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Billing History & Invoices
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Verified records of invoices and payments
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-200">
            0 Invoices Issued
          </Badge>
        </div>

        <div className="py-8 text-center text-slate-400 text-xs space-y-1">
          <CreditCard className="w-6 h-6 mx-auto text-slate-300" />
          <p className="font-semibold text-slate-600">No payment history yet</p>
          <p className="text-[11px] text-slate-400">
            Payment transactions will appear here once live billing is approved and activated.
          </p>
        </div>
      </Card>
    </div>
  );
}
