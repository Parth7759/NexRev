"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTour } from "@/contexts/tour-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Info,
} from "lucide-react";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourPopover() {
  const {
    isTourActive,
    currentStep,
    currentStepIndex,
    totalSteps,
    nextStep,
    prevStep,
    skipTour,
    finishTour,
  } = useTour();

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [targetFound, setTargetFound] = useState<boolean>(true);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    if (!isTourActive) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        skipTour();
      } else if (e.key === "ArrowRight") {
        nextStep();
      } else if (e.key === "ArrowLeft" && currentStepIndex > 0) {
        prevStep();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTourActive, currentStepIndex, nextStep, prevStep, skipTour]);

  // Target element locator with polling & retry
  const locateTarget = useCallback(() => {
    if (!currentStep) return false;

    const el = document.getElementById(currentStep.targetId);
    if (el) {
      const rect = el.getBoundingClientRect();
      // Verify element is physically visible in layout
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        setTargetFound(true);

        // Smoothly scroll target into view if outside visible viewport
        if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return true;
      }
    }
    return false;
  }, [currentStep]);

  useEffect(() => {
    if (!isTourActive || !currentStep) {
      const t = setTimeout(() => {
        setTargetRect(null);
      }, 0);
      return () => clearTimeout(t);
    }

    // Schedule initial location
    const initialTimer = setTimeout(() => {
      locateTarget();
    }, 0);

    // Retry with interval for route transition hydration (up to 1.5s)
    let retries = 0;
    const interval = setInterval(() => {
      retries++;
      if (locateTarget() || retries > 15) {
        clearInterval(interval);
        if (retries > 15) {
          setTargetFound(false);
          setTargetRect(null);
        }
      }
    }, 100);

    const handleResizeOrScroll = () => {
      locateTarget();
    };

    window.addEventListener("resize", handleResizeOrScroll);
    window.addEventListener("scroll", handleResizeOrScroll, true);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
    };
  }, [isTourActive, currentStep, locateTarget]);

  // Compute Popover Position relative to target
  useEffect(() => {
    if (!targetRect || !popoverRef.current) return;

    if (window.innerWidth < 640) {
      // Mobile screen: fixed bottom placement
      const t = setTimeout(() => {
        setPopoverPos(null);
      }, 0);
      return () => clearTimeout(t);
    }

    const popoverWidth = 360;
    const popoverHeight = popoverRef.current.offsetHeight || 220;
    const padding = 14;

    const placement = currentStep?.placement || "bottom";
    let top = 0;
    let left = 0;

    switch (placement) {
      case "right":
        top = targetRect.top + targetRect.height / 2 - popoverHeight / 2;
        left = targetRect.left + targetRect.width + padding;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - popoverHeight / 2;
        left = targetRect.left - popoverWidth - padding;
        break;
      case "top":
        top = targetRect.top - popoverHeight - padding;
        left = targetRect.left + targetRect.width / 2 - popoverWidth / 2;
        break;
      case "bottom":
      default:
        top = targetRect.top + targetRect.height + padding;
        left = targetRect.left + targetRect.width / 2 - popoverWidth / 2;
        break;
    }

    // Boundary constraints: ensure popover stays within viewport
    left = Math.max(16, Math.min(left, window.innerWidth - popoverWidth - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - popoverHeight - 16));

    const setTimer = setTimeout(() => {
      setPopoverPos({ top, left });
    }, 0);

    return () => clearTimeout(setTimer);
  }, [targetRect, currentStep]);

  if (!isTourActive || !currentStep) return null;

  const isLastStep = currentStepIndex === totalSteps - 1;
  const progressPercent = Math.round(((currentStepIndex + 1) / totalSteps) * 100);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none font-sans">
      {/* 1. Backdrop Spotlight / Highlight Ring */}
      {targetRect && (
        <div
          className="absolute rounded-xl transition-all duration-300 ease-out pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            outline: "3px solid #10B981",
            boxShadow:
              "0 0 0 4px rgba(16, 185, 129, 0.25), 0 0 35px rgba(16, 185, 129, 0.35)",
          }}
        />
      )}

      {/* 2. Tour Card Popover */}
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-step-title"
        className={`pointer-events-auto bg-white rounded-2xl shadow-2xl border border-emerald-950/15 overflow-hidden transition-all duration-200 ${
          popoverPos
            ? "absolute w-[360px]"
            : "fixed bottom-5 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[380px] mx-auto"
        }`}
        style={popoverPos ? { top: popoverPos.top, left: popoverPos.left } : undefined}
      >
        {/* Progress Bar */}
        <div className="w-full bg-slate-100 h-1">
          <div
            className="bg-emerald-600 h-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Card Header */}
        <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-mono">
              {currentStepIndex + 1} of {totalSteps}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] font-semibold border-slate-200 text-slate-600 uppercase tracking-wider"
            >
              {currentStep.category}
            </Badge>
          </div>
          <button
            type="button"
            onClick={skipTour}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Skip product tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Card Body */}
        <div className="p-5 space-y-3">
          {!targetFound && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <span>Target element is located in the collapsed sidebar menu or on another tab.</span>
            </div>
          )}

          <div>
            <h3 id="tour-step-title" className="text-sm font-bold text-slate-900">
              {currentStep.title}
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {currentStep.description}
            </p>
          </div>

          {/* Navigation Controls */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-100 gap-2">
            <button
              type="button"
              onClick={skipTour}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-700 transition-colors"
            >
              Skip Tour
            </button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={prevStep}
                disabled={currentStepIndex === 0}
                className="h-8 text-xs px-2.5 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50 gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Back</span>
              </Button>

              {isLastStep ? (
                <Button
                  size="sm"
                  onClick={finishTour}
                  className="h-8 text-xs px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Finish Tour</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={nextStep}
                  className="h-8 text-xs px-3.5 rounded-lg bg-[#0A3022] hover:bg-[#0E3D2C] text-white font-semibold gap-1.5 shadow-xs"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
