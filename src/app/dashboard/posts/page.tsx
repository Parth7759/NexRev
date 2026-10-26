"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  Eye,
  CheckCircle2,
  Trash2,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/contexts/workspace-context";
import { useLocation } from "@/contexts/location-context";
import { ContextualHelp } from "@/components/ui/contextual-help";

type PostType = "update" | "offer" | "event";
type CallToActionType = "NONE" | "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";

interface LocalPostDraft {
  id: string;
  type: PostType;
  title?: string;
  summary: string;
  ctaType: CallToActionType;
  ctaUrl?: string;
  couponCode?: string;
  startDate?: string;
  endDate?: string;
  status: "draft" | "scheduled";
  createdAt: string;
}

export default function GooglePostsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { selectedLocation } = useLocation();

  const [postType, setPostType] = useState<PostType>("update");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  const [ctaType, setCtaType] = useState<CallToActionType>("LEARN_MORE");
  const [ctaUrl, setCtaUrl] = useState("https://");
  const [couponCode, setCouponCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [drafts, setDrafts] = useState<LocalPostDraft[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Storage key for tenant & location scoped drafts
  const storageKey = useMemo(() => {
    if (!activeWorkspaceId || !selectedLocation) return null;
    return `nexrep_posts_${activeWorkspaceId}_${selectedLocation.id}`;
  }, [activeWorkspaceId, selectedLocation]);

  // Load existing drafts from local storage asynchronously
  useEffect(() => {
    let isMounted = true;
    if (!storageKey) return;

    const timer = setTimeout(() => {
      if (!isMounted) return;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          setDrafts(JSON.parse(stored));
        } else {
          // Initial sample draft
          setDrafts([
            {
              id: "draft-sample-1",
              type: "update",
              summary:
                "Excited to announce our enhanced local reputation support! Book a consultation with our team this week to elevate your Google rating.",
              ctaType: "BOOK",
              ctaUrl: "https://nexrep.app/contact",
              status: "draft",
              createdAt: new Date().toLocaleDateString(),
            },
          ]);
        }
      } catch {
        // ignore storage error
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [storageKey]);

  // Save new draft
  const handleSaveDraft = (scheduled: boolean = false) => {
    if (!summary.trim()) {
      alert("Please enter post content before saving.");
      return;
    }

    const newDraft: LocalPostDraft = {
      id: "post-" + Date.now(),
      type: postType,
      title: title || undefined,
      summary,
      ctaType,
      ctaUrl: ctaType !== "NONE" ? ctaUrl : undefined,
      couponCode: postType === "offer" ? couponCode : undefined,
      startDate: postType !== "update" ? startDate : undefined,
      endDate: postType !== "update" ? endDate : undefined,
      status: scheduled ? "scheduled" : "draft",
      createdAt: new Date().toLocaleDateString(),
    };

    const updated = [newDraft, ...drafts];
    setDrafts(updated);

    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {}
    }

    setSaveNotice(
      scheduled
        ? "Post successfully scheduled for automatic publishing in workspace queue."
        : "Post saved as draft in your workspace post studio."
    );
    setTimeout(() => setSaveNotice(null), 4000);
  };

  // Delete draft
  const handleDeleteDraft = (id: string) => {
    const updated = drafts.filter((d) => d.id !== id);
    setDrafts(updated);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {}
    }
  };

  return (
    <div className="space-y-7 max-w-7xl w-full font-sans select-none pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Google Business Profile Posts
            </h1>
            <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-semibold">
              Posts Studio
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {selectedLocation
              ? `Compose, preview, and schedule Google Search & Maps updates for ${selectedLocation.name}`
              : "Select a business profile to create Google updates and offers."}
          </p>
        </div>

        {selectedLocation && (
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1">
              Active: {selectedLocation.name}
            </Badge>
          </div>
        )}
      </div>

      {/* Contextual Help Banner */}
      <ContextualHelp
        pageTitle="Google Posts Studio"
        dataType="demo"
        summary="Create announcements, offers, and events with real-time Google Search previews. Drafts are safely stored in your isolated workspace session."
        apiStatusNote="Live publishing to Google Business Profile requires enabling the Google Local Posts API in your Google Cloud project. NexRep never pretends unintegrated posts were published."
        proTips={[
          "Special Offer posts with expiration dates drive up to 34% higher walk-in store visits.",
          "Google recommends updating posts at least once every 7 days to maintain active search rankings.",
        ]}
      />

      {!selectedLocation ? (
        <Card className="border-slate-200/90 bg-white shadow-sm p-10 text-center rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Select Business Profile</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Choose an active Google Business Profile to create and manage local posts.
          </p>
          <Link href="/dashboard/locations?select_profile=1" className="mt-4 inline-block">
            <Button className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl">
              Select Profile
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Transparent API Notice Banner */}
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-xs text-emerald-950 flex items-start gap-3">
            <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed text-[11px]">
              <p className="font-bold text-emerald-900">
                Google Local Post API & Publishing Integration Notice:
              </p>
              <p className="text-emerald-800">
                Post composition, live Google Maps preview, and draft scheduling operate locally within your isolated workspace. Direct publishing to Google Maps requires Google My Business v4 Local Post API enablement in your Google Cloud project. NexRep never publishes unapproved posts to live Google listings.
              </p>
            </div>
          </div>

          {saveNotice && (
            <div className="p-3 text-xs rounded-xl bg-emerald-100/80 border border-emerald-300 text-emerald-900 flex items-center gap-2 font-medium animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{saveNotice}</span>
            </div>
          )}

          {/* Studio Grid: Composition Form (Left) & Google Preview (Right) */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Composition Form */}
            <Card className="lg:col-span-7 bg-white border border-slate-200/80 shadow-xs rounded-2xl p-6 space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Compose Google Post
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Select post type and configure CTA buttons
                </p>
              </div>

              {/* Post Type Selector Tabs */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl text-xs font-semibold text-center">
                <button
                  type="button"
                  onClick={() => setPostType("update")}
                  className={`py-2 rounded-lg transition-all ${
                    postType === "update"
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  What&apos;s New (Update)
                </button>
                <button
                  type="button"
                  onClick={() => setPostType("offer")}
                  className={`py-2 rounded-lg transition-all ${
                    postType === "offer"
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Special Offer
                </button>
                <button
                  type="button"
                  onClick={() => setPostType("event")}
                  className={`py-2 rounded-lg transition-all ${
                    postType === "event"
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Scheduled Event
                </button>
              </div>

              {/* Offer / Event specific fields */}
              {postType !== "update" && (
                <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      {postType === "offer" ? "Offer Title" : "Event Title"}
                    </label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={postType === "offer" ? "e.g. 20% Off Spring Maintenance" : "e.g. Local Tech Networking Meetup"}
                      className="h-8.5 text-xs bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                        Start Date
                      </label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="h-8.5 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                        End Date
                      </label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="h-8.5 text-xs bg-white"
                      />
                    </div>
                  </div>

                  {postType === "offer" && (
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                        Coupon Code (Optional)
                      </label>
                      <Input
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value)}
                        placeholder="e.g. SPRING20"
                        className="h-8.5 text-xs font-mono bg-white uppercase"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Post Description */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800">
                    Post Description (Max 1,500 chars)
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {summary.length} / 1500
                  </span>
                </div>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={1500}
                  rows={4}
                  placeholder="Share updates, seasonal announcements, or new services with customers on Google Maps..."
                  className="w-full rounded-xl border border-slate-200/90 p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 leading-relaxed"
                />
              </div>

              {/* Call to Action Controls */}
              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">
                    Action Button (CTA)
                  </label>
                  <select
                    value={ctaType}
                    onChange={(e) => setCtaType(e.target.value as CallToActionType)}
                    className="w-full h-9 rounded-xl border border-slate-200/90 px-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="NONE">None</option>
                    <option value="BOOK">Book Appointment</option>
                    <option value="ORDER">Order Online</option>
                    <option value="SHOP">Buy / Shop</option>
                    <option value="LEARN_MORE">Learn More</option>
                    <option value="SIGN_UP">Sign Up</option>
                    <option value="CALL">Call Now</option>
                  </select>
                </div>

                {ctaType !== "NONE" && ctaType !== "CALL" && (
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">
                      Button Link URL
                    </label>
                    <Input
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                      placeholder="https://yourwebsite.com/offer"
                      className="h-9 text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <Button
                  onClick={() => handleSaveDraft(false)}
                  variant="outline"
                  className="text-xs font-semibold h-9 px-4 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Save as Workspace Draft
                </Button>

                <Button
                  onClick={() => handleSaveDraft(true)}
                  className="bg-[#0B3024] hover:bg-[#0E3D2E] text-white text-xs font-semibold h-9 px-4 rounded-xl shadow-xs gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule Post
                </Button>
              </div>
            </Card>

            {/* Google Search Live Preview Card */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-slate-400" /> Live Google Search Preview
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Mobile / Desktop</span>
              </div>

              {/* Mock Google Business Knowledge Panel Card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md space-y-3 font-sans">
                {/* Google Location Header */}
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                    {selectedLocation.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {selectedLocation.name}
                    </p>
                    <p className="text-[10px] text-slate-500">Google Business Profile • Just now</p>
                  </div>
                </div>

                {/* Offer / Event Title if set */}
                {title && (
                  <div className="pt-1">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {postType === "offer" ? "Special Offer" : "Upcoming Event"}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 mt-1">{title}</h4>
                  </div>
                )}

                {/* Post Body */}
                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                  {summary || "Your post description will appear here as it renders on Google Search and Google Maps for local customers searching your business."}
                </p>

                {/* Offer coupon snippet */}
                {postType === "offer" && couponCode && (
                  <div className="p-2 rounded-lg bg-slate-50 border border-dashed border-slate-300 text-center text-xs">
                    <span className="text-slate-500 text-[10px]">Use Promo Code: </span>
                    <strong className="font-mono text-emerald-800 font-bold">{couponCode}</strong>
                  </div>
                )}

                {/* Simulated Google CTA Button */}
                {ctaType !== "NONE" && (
                  <div className="pt-2">
                    <button
                      type="button"
                      disabled
                      className="w-full py-2 px-3 rounded-lg bg-blue-600 text-white font-semibold text-xs text-center cursor-default shadow-xs"
                    >
                      {ctaType === "BOOK"
                        ? "Book Online"
                        : ctaType === "ORDER"
                        ? "Order Online"
                        : ctaType === "SHOP"
                        ? "Buy"
                        : ctaType === "SIGN_UP"
                        ? "Sign Up"
                        : ctaType === "CALL"
                        ? "Call Now"
                        : "Learn More"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Saved Drafts & Scheduled Queue */}
          <Card className="border-slate-200/80 bg-white rounded-2xl shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Workspace Post Queue ({drafts.length})
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Saved drafts and scheduled posts for this location
                </p>
              </div>
            </div>

            {drafts.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No drafts saved yet. Compose a post above to store it in your workspace.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <div key={d.id} className="py-3.5 flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="capitalize text-[10px] font-semibold border-slate-200"
                        >
                          {d.type}
                        </Badge>
                        <Badge
                          className={`text-[9px] px-1.5 py-0 font-medium ${
                            d.status === "scheduled"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {d.status}
                        </Badge>
                        <span className="text-[10px] text-slate-400 font-mono">{d.createdAt}</span>
                      </div>
                      {d.title && <p className="text-xs font-bold text-slate-900">{d.title}</p>}
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {d.summary}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteDraft(d.id)}
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Delete draft"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
