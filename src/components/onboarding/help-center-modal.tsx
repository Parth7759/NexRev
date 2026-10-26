"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTour } from "@/contexts/tour-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  HelpCircle,
  BookOpen,
  LifeBuoy,
  X,
  Play,
  RotateCcw,
  Building2,
  ShieldCheck,
  Send,
  MessageSquare,
  Sparkles,
  ChevronRight,
  ExternalLink,
  Mail,
  FileBarChart,
} from "lucide-react";

export function HelpCenterModal() {
  const { isHelpOpen, closeHelpModal, helpTab, openHelpModal, restartTour, isCompleted } = useTour();

  // Support Form state
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const [supportSubmitted, setSupportSubmitted] = useState(false);

  if (!isHelpOpen) return null;

  const handleRestartTour = () => {
    closeHelpModal();
    restartTour();
  };

  const handleSupportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportSubject.trim() || !supportMessage.trim()) return;

    setIsSubmittingSupport(true);
    // Simulate real local dispatch
    setTimeout(() => {
      setIsSubmittingSupport(false);
      setSupportSubmitted(true);
      setSupportSubject("");
      setSupportMessage("");
    }, 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden font-sans text-slate-900 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-emerald-950/10 bg-[#0A3022] text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <LifeBuoy className="w-4 h-4" />
            </div>
            <div>
              <h3 id="help-modal-title" className="text-sm font-bold text-white">
                NexRep Help & Learning Center
              </h3>
              <p className="text-[11px] text-emerald-200/80">
                Documentation, guides, troubleshooting, and support
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeHelpModal}
            className="text-emerald-300/80 hover:text-white p-1 rounded-lg hover:bg-emerald-800/40 transition-colors"
            aria-label="Close help modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50/80 px-6 overflow-x-auto shrink-0 select-none">
          <button
            type="button"
            onClick={() => openHelpModal("tour")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              helpTab === "tour"
                ? "border-emerald-600 text-emerald-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Product Tour</span>
          </button>

          <button
            type="button"
            onClick={() => openHelpModal("setup")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              helpTab === "setup"
                ? "border-emerald-600 text-emerald-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Setup Guide</span>
          </button>

          <button
            type="button"
            onClick={() => openHelpModal("features")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              helpTab === "features"
                ? "border-emerald-600 text-emerald-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Feature Guide</span>
          </button>

          <button
            type="button"
            onClick={() => openHelpModal("faq")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              helpTab === "faq"
                ? "border-emerald-600 text-emerald-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>FAQ & Advice</span>
          </button>

          <button
            type="button"
            onClick={() => openHelpModal("support")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              helpTab === "support"
                ? "border-emerald-600 text-emerald-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Contact Support</span>
          </button>
        </div>

        {/* Tab Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* TAB 1: PRODUCT TOUR */}
          {helpTab === "tour" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 text-sm">Interactive Product Walkthrough</h4>
                    {isCompleted ? (
                      <Badge className="bg-emerald-600 text-white text-[10px] font-semibold">Completed</Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-300 text-slate-600 text-[10px]">Ready</Badge>
                    )}
                  </div>
                  <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                    Take a step-by-step tour highlighting all 11 core modules: Overview, Reviews & AI Replies, Profile Audit, Google Posts, Local SEO, and Account Settings.
                  </p>
                </div>
                <Button
                  onClick={handleRestartTour}
                  className="bg-[#0A3022] hover:bg-[#0E3D2C] text-white shrink-0 gap-2 h-9 text-xs font-semibold rounded-xl"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restart Tour</span>
                </Button>
              </div>

              <div className="space-y-2">
                <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  Tour Steps Included:
                </h5>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span className="font-medium text-slate-700">Google Profile Selector</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span className="font-medium text-slate-700">Reputation KPIs & Trends</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      3
                    </span>
                    <span className="font-medium text-slate-700">Analytics & CSV Export</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      4
                    </span>
                    <span className="font-medium text-slate-700">NexRep Profile Audit</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      5
                    </span>
                    <span className="font-medium text-slate-700">Reviews & AI Replies</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      6
                    </span>
                    <span className="font-medium text-slate-700">Google Posts Studio</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      7
                    </span>
                    <span className="font-medium text-slate-700">Local SEO & Keywords</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      8
                    </span>
                    <span className="font-medium text-slate-700">Executive Reports</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      9
                    </span>
                    <span className="font-medium text-slate-700">Plans & Billing</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      10
                    </span>
                    <span className="font-medium text-slate-700">Team & Roles</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-2 sm:col-span-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                      11
                    </span>
                    <span className="font-medium text-slate-700">Bottom Profile & Security Settings</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SETUP GUIDE */}
          {helpTab === "setup" && (
            <div className="space-y-4">
              <p className="text-slate-500 leading-relaxed">
                Follow these 4 essential steps to configure your NexRep workspace for automated local business growth:
              </p>

              <div className="space-y-3">
                {/* Step 1 */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                        1
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900">Connect Google Business Profile</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          Authorize Google OAuth to sync customer reviews, location details, and ratings in real time.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/dashboard/locations"
                      onClick={closeHelpModal}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 shrink-0 pt-1"
                    >
                      <span>Locations</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                        2
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900">Configure AI Reply Safety & Tone</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          Choose your default tone (Professional, Friendly, Concise, Empathetic) and enable Critical Review Locks.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      onClick={closeHelpModal}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 shrink-0 pt-1"
                    >
                      <span>Settings</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                        3
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900">Run Your Profile Audit</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          Check for missing phone numbers, opening hours, or category attributes with NexRep&apos;s 100-point audit score.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/dashboard/audit"
                      onClick={closeHelpModal}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 shrink-0 pt-1"
                    >
                      <span>Audit</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                        4
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900">Invite Team Collaborators</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          Add managers and staff to review customer feedback, approve AI drafts, and manage location updates.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/dashboard/team"
                      onClick={closeHelpModal}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 shrink-0 pt-1"
                    >
                      <span>Team</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: FEATURE GUIDE */}
          {helpTab === "features" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>AI Review Assistant</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Understands review sentiment and context. Generates polite, natural responses in seconds with 0% fabricated facts.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Audit Scorecard</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Evaluates 9 key Google Business dimensions with priority recommendations to enhance local search ranking.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <Send className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Google Posts Studio</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Create Offers, Announcements, and Events with CTA buttons and live Google Search knowledge panel previews.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Local SEO Engine</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Actionable keyword targets (Near Me, Transactional) and 750-character SEO description copywriter.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <FileBarChart className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Executive Reports</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Printable performance summaries with official Google sync attribution and complete CSV export archives.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Multi-Location Management</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Seamlessly switch between multiple branches and franchises with isolated metrics and team roles.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: FAQ & TROUBLESHOOTING */}
          {helpTab === "faq" && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs">
                  Why are Google Search and Maps impressions marked pending?
                </h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Review counts, ratings, and customer feedback are 100% verified from live Google data. Impression counters require the separate Google Business Profile Performance API to be enabled on your Google Cloud Console project. NexRep never fabricates fake search metrics.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs">
                  How do reply safety gates protect my brand?
                </h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  When the Critical Review Lock is enabled, negative customer feedback (1–3 stars) is always held in draft status, requiring an authorized team member to review and approve before publishing to Google.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs">
                  Can I publish Google Posts directly?
                </h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  NexRep includes a full Google Posts Studio for creating and previewing Offers and Announcements. Live publishing to Google requires enabling the Google Local Posts API in your linked Google Cloud project.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs">
                  How is the NexRep Profile Health Score calculated?
                </h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  The health score is a proprietary NexRep audit metric (not an official Google ranking score) based on 9 core profile elements: verified name, address, hours, category, phone, description, photos, attributes, and response rates.
                </p>
              </div>
            </div>
          )}

          {/* TAB 5: CONTACT SUPPORT */}
          {helpTab === "support" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 flex items-start gap-3">
                <Mail className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-emerald-950 text-xs">Direct Support Desk</h4>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    Have questions about Google OAuth, reply automation, or team roles? Our local business support team is available Monday through Friday.
                  </p>
                  <a
                    href="mailto:support@nexrep.app?subject=NexRep%20Support%20Inquiry"
                    className="inline-flex items-center gap-1.5 font-bold text-emerald-800 hover:text-emerald-950 text-xs pt-1"
                  >
                    <span>Email us directly at support@nexrep.app</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {supportSubmitted ? (
                <div className="p-6 rounded-2xl border border-emerald-200 bg-emerald-50 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h4 className="font-bold text-slate-900 text-xs">Support Request Dispatched</h4>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Your message has been received. Our support engineers respond to all verified workspace inquiries within 4 business hours.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSupportSubmitted(false)}
                    className="text-xs h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                  >
                    Send Another Message
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSupportSubmit} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="support-subject" className="text-xs font-semibold text-slate-700">
                      Subject
                    </Label>
                    <Input
                      id="support-subject"
                      placeholder="e.g. Question about Google Business OAuth sync"
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      className="text-xs h-9"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="support-message" className="text-xs font-semibold text-slate-700">
                      How can we help?
                    </Label>
                    <textarea
                      id="support-message"
                      rows={3}
                      placeholder="Describe the issue or feature you need assistance with..."
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmittingSupport || !supportSubject.trim() || !supportMessage.trim()}
                    className="w-full bg-[#0A3022] hover:bg-[#0E3D2C] text-white text-xs font-semibold h-9 rounded-xl shadow-xs gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSubmittingSupport ? "Sending..." : "Submit Support Request"}</span>
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
