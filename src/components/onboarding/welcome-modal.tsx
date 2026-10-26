"use client";

import React, { useState } from "react";
import { useTour } from "@/contexts/tour-context";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  X,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
  MapPin,
} from "lucide-react";

import { NexRepIcon } from "@/components/brand/logo";

export function WelcomeModal() {
  const { isWelcomeOpen, startTour, closeWelcomeModal } = useTour();
  const [dontShowAgain, setDontShowAgain] = useState(true);

  if (!isWelcomeOpen) return null;

  const handleStart = () => {
    startTour(0);
  };

  const handleSkip = () => {
    closeWelcomeModal(dontShowAgain);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-emerald-950/10 overflow-hidden font-sans text-slate-900 animate-in zoom-in-95 duration-200">
        {/* Modal Banner Header */}
        <div className="relative bg-[#0A3022] text-white p-6 sm:p-7 border-b border-emerald-900/40">
          <button
            type="button"
            onClick={handleSkip}
            className="absolute top-4 right-4 text-emerald-300/80 hover:text-white p-1 rounded-xl hover:bg-emerald-800/40 transition-colors"
            aria-label="Skip welcome modal"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] font-semibold mb-3">
            <NexRepIcon size={16} />
            <span>Welcome to NexRep by NexFlowOps</span>
          </div>

          <h2
            id="welcome-modal-title"
            className="text-xl sm:text-2xl font-extrabold text-white tracking-tight"
          >
            Smarter Reviews. Stronger Reputation.
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/80 mt-1.5 leading-relaxed">
            Your centralized business console for Google Business Profile optimization, context-aware AI review replies, and local customer acquisition.
          </p>
        </div>

        {/* Modal Highlights Body */}
        <div className="p-6 sm:p-7 space-y-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            What you can achieve with NexRep:
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">Contextual AI Replies</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Tailored replies across 4 tones with human approval safeguards.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">Profile Audit Engine</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  100-point completeness score to maximize local Google ranking.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">Live Velocity & Trends</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Period-over-period sentiment and review growth comparisons.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">Google Posts & SEO</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Draft Updates, Offers, and local keywords tailored to your area.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-slate-500 text-[11px]">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Don&apos;t prompt on future visits</span>
            </label>
            <span className="text-[11px] text-slate-400">Takes ~2 minutes</span>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
            <Button
              onClick={handleStart}
              className="w-full sm:flex-1 bg-[#0A3022] hover:bg-[#0E3D2C] text-white h-10 rounded-xl text-xs font-semibold gap-2 shadow-sm transition-all"
            >
              <span>Take the Interactive Tour</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              onClick={handleSkip}
              className="w-full sm:w-auto border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 h-10 rounded-xl text-xs font-semibold px-4"
            >
              Skip for Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
