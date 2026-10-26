"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Info,
  HelpCircle,
} from "lucide-react";
import { useTour } from "@/contexts/tour-context";

interface ContextualHelpProps {
  pageTitle: string;
  summary: string;
  dataType: "live" | "ai" | "demo" | "hybrid";
  apiStatusNote?: string;
  proTips: string[];
  className?: string;
}

export function ContextualHelp({
  pageTitle,
  summary,
  dataType,
  apiStatusNote,
  proTips,
  className = "",
}: ContextualHelpProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { openHelpModal } = useTour();

  const badgeConfig = {
    live: {
      label: "Verified Google Sync",
      variant: "outline" as const,
      className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    },
    ai: {
      label: "AI Generated Insights",
      variant: "outline" as const,
      className: "border-purple-300 bg-purple-50 text-purple-800",
    },
    demo: {
      label: "Demo Safe Sandbox",
      variant: "outline" as const,
      className: "border-amber-300 bg-amber-50 text-amber-800",
    },
    hybrid: {
      label: "Verified Live + AI Studio",
      variant: "outline" as const,
      className: "border-blue-300 bg-blue-50 text-blue-800",
    },
  }[dataType];

  return (
    <div
      className={`rounded-2xl border border-emerald-900/10 bg-emerald-50/30 overflow-hidden font-sans transition-all text-xs ${className}`}
    >
      <div
        onClick={() => setIsOpen((prev) => !prev)}
        className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-emerald-50/60 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-emerald-600/10 text-emerald-800 flex items-center justify-center shrink-0">
            <Lightbulb className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-slate-800 text-[11px]">
            {pageTitle} Guide & Tips
          </span>
          <Badge
            variant={badgeConfig.variant}
            className={`text-[9px] font-semibold px-2 py-0 ${badgeConfig.className}`}
          >
            {badgeConfig.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-medium">
            {isOpen ? "Hide details" : "Learn more"}
          </span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="px-4 pb-3.5 pt-1 border-t border-emerald-900/5 space-y-2.5 animate-in fade-in-50 duration-150">
          <p className="text-slate-600 leading-relaxed text-[11px]">{summary}</p>

          {apiStatusNote && (
            <div className="p-2 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-[11px] flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
              <span>{apiStatusNote}</span>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Pro Tips:
            </span>
            <ul className="space-y-1 list-disc list-inside text-slate-600 text-[11px]">
              {proTips.map((tip, idx) => (
                <li key={idx} className="leading-relaxed">
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => openHelpModal("faq")}
              className="text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1"
            >
              <HelpCircle className="w-3 h-3" />
              <span>View FAQ & troubleshooting</span>
            </button>
            <button
              type="button"
              onClick={() => openHelpModal("tour")}
              className="text-slate-500 hover:text-slate-800 font-medium"
            >
              Restart tour for this feature
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
