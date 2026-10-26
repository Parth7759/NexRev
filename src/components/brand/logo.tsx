"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface NexRepIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

export function NexRepIcon({ className, size = 32, ...props }: NexRepIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-label="NexRep Icon"
      {...props}
    >
      <defs>
        <linearGradient id="nr-icon-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>
        <linearGradient id="nr-icon-star" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F0FDF4" />
        </linearGradient>
        <linearGradient id="nr-icon-accent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
      </defs>

      {/* 1. Green Rounded-Square Base (Squircle) */}
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="12"
        fill="url(#nr-icon-bg)"
        stroke="#34D399"
        strokeWidth="1.2"
        strokeOpacity="0.45"
      />

      {/* 2. Customer Review Speech Bubble */}
      <path
        d="M12.5 13C10.5 13 9 14.5 9 16.5V26.5C9 28.5 10.5 30 12.5 30H14.5V34.8C14.5 35.45 15.25 35.8 15.75 35.35L21 30.5C21.4 30.2 21.9 30 22.4 30H35.5C37.5 30 39 28.5 39 26.5V16.5C39 14.5 37.5 13 35.5 13H12.5Z"
        fill="#022C22"
        fillOpacity="0.45"
        stroke="#10B981"
        strokeWidth="0.8"
        strokeOpacity="0.25"
      />

      {/* 3. Rating Star Emblem (Customer Satisfaction) */}
      <path
        d="M19.5 16.5L21.1 20L24.8 20.3L22 22.8L22.8 26.5L19.5 24.5L16.2 26.5L17 22.8L14.2 20.3L17.9 20L19.5 16.5Z"
        fill="url(#nr-icon-star)"
      />

      {/* 4. Dynamic Upward Growth Arrow (Reputation & Growth) */}
      <path
        d="M23 26.5L31.5 18"
        stroke="url(#nr-icon-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M26.5 17.5H32V23"
        stroke="url(#nr-icon-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 5. Excellence Sparkle */}
      <path
        d="M37 9C37 10.5 35.5 11.5 34.5 11.5C35.5 11.5 37 12.5 37 14C37 12.5 38.5 11.5 39.5 11.5C38.5 11.5 37 10.5 37 9Z"
        fill="#A7F3D0"
      />
    </svg>
  );
}

interface NexRepLogoProps {
  variant?: "dark" | "light";
  showTagline?: boolean;
  className?: string;
  iconSize?: number;
}

export function NexRepLogo({
  variant = "dark",
  showTagline = true,
  className,
  iconSize = 34,
}: NexRepLogoProps) {
  const isDark = variant === "dark";

  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <NexRepIcon size={iconSize} className="shadow-xs" />
      <div className="flex flex-col justify-center">
        <span
          className={cn(
            "font-extrabold text-lg tracking-tight leading-none",
            isDark ? "text-white" : "text-slate-900"
          )}
        >
          Nex<span className={isDark ? "text-emerald-400" : "text-emerald-600"}>Rep</span>
        </span>
        {showTagline && (
          <span
            className={cn(
              "text-[9px] font-semibold tracking-wider uppercase mt-0.5",
              isDark ? "text-emerald-300/80" : "text-emerald-700/80"
            )}
          >
            by NexFlowOps
          </span>
        )}
      </div>
    </div>
  );
}
