import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  ExternalLink,
  Mail,
  CheckCircle2,
  FileText,
  Database,
  Sparkles,
  RefreshCw,
  Download,
  AlertTriangle,
} from "lucide-react";
import { NexRepLogo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Privacy Policy | NexRep - AI Google Review Management",
  description:
    "NexRep Privacy Policy: How we collect, use, and protect your information, including Google API Services User Data Policy and Limited Use compliance.",
  alternates: {
    canonical: "https://nex-rev.vercel.app/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "November 5, 2026";

  const tableOfContents = [
    { id: "introduction", label: "1. Introduction & Scope" },
    { id: "information-we-collect", label: "2. Information We Collect" },
    { id: "google-api-services", label: "3. Google API Services & Limited Use" },
    { id: "ai-processing", label: "4. AI Processing & Third-Party LLM Disclosures" },
    { id: "how-we-use-information", label: "5. How We Use Information" },
    { id: "data-storage-and-security", label: "6. Data Storage & Security" },
    { id: "data-sharing", label: "7. Data Sharing & Service Providers" },
    { id: "data-retention", label: "8. Data Retention Policies" },
    { id: "google-disconnection", label: "9. Google Account Disconnection" },
    { id: "user-rights", label: "10. User Rights, Data Export & Deletion" },
    { id: "cookies", label: "11. Cookies & Authentication Sessions" },
    { id: "childrens-privacy", label: "12. Children's Privacy" },
    { id: "international-transfers", label: "13. International Data Transfers" },
    { id: "changes-to-policy", label: "14. Changes to This Privacy Policy" },
    { id: "contact-information", label: "15. Contact Information & Developer Details" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Public Header */}
      <header className="sticky top-0 z-40 px-6 lg:px-12 h-20 flex items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <Link href="/" className="flex items-center">
          <NexRepLogo variant="light" showTagline={true} />
        </Link>
        <nav className="hidden md:flex gap-8 text-sm font-medium">
          <Link href="/#features" className="hover:text-blue-600 transition-colors">
            Features
          </Link>
          <Link href="/#workflow" className="hover:text-blue-600 transition-colors">
            Workflow
          </Link>
          <Link href="/privacy-policy" className="text-blue-600 font-semibold">
            Privacy Policy
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium hover:text-blue-600 transition-colors">
            Login
          </Link>
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ variant: "default" }),
              "bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 text-sm"
            )}
          >
            Get Started <ArrowRight className="ml-1.5 w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="border-b border-slate-200 bg-white py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
            </Link>
            <span>/</span>
            <span className="text-slate-900 font-medium">Privacy Policy</span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold mb-4 border border-emerald-200/80">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Google API & Privacy Compliance
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            NexRep Privacy Policy
          </h1>
          <p className="text-base md:text-lg text-slate-600 max-w-3xl leading-relaxed">
            This Privacy Policy outlines how NexRep collects, uses, processes, and protects your information, including our strict compliance with Google API Services User Data Policy and Limited Use requirements.
          </p>
          <div className="mt-4 text-xs text-slate-500 font-medium flex items-center gap-3">
            <span>Last Updated: <strong className="text-slate-700">{lastUpdated}</strong></span>
            <span>•</span>
            <span>Applies to: <strong className="text-slate-700">NexRep Platform & Services</strong></span>
          </div>
        </div>
      </div>

      {/* Main Content Layout with Sticky Table of Contents */}
      <main className="flex-1 max-w-5xl mx-auto px-6 lg:px-8 py-12 md:py-16 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
          {/* Table of Contents Column */}
          <aside className="lg:col-span-1 hidden lg:block">
            <div className="sticky top-28 space-y-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-slate-500 mb-3">
                <FileText className="w-3.5 h-3.5" /> Table of Contents
              </div>
              <nav className="space-y-1.5 text-xs">
                {tableOfContents.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="block text-slate-600 hover:text-blue-600 hover:translate-x-0.5 transition-all py-1 font-medium leading-snug"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Policy Body */}
          <article className="lg:col-span-3 space-y-12 text-slate-700 leading-relaxed text-sm md:text-base">
            {/* 1. Introduction and Scope */}
            <section id="introduction" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">1</span>
                Introduction & Scope
              </h2>
              <p>
                NexRep (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;), operated by <strong>NexFlowOps</strong> and maintained by developer <strong>Parth Prajapati</strong>, provides an AI-assisted customer review management and response platform accessible via <strong>https://nex-rev.vercel.app</strong> (the &ldquo;Service&rdquo;). NexRep is designed for business owners, agency teams, and multi-location operators to monitor customer feedback, synchronize Google Business Profile reviews, and generate contextual, professional reply drafts.
              </p>
              <p>
                This Privacy Policy explains how we collect, use, store, disclose, and protect personal and business information when you visit our website, register for an account, create or participate in team workspaces, or connect third-party platforms such as Google Business Profile.
              </p>
              <p>
                By accessing or using NexRep, you agree to the collection and use of information in accordance with this Privacy Policy. If you do not agree with this policy, please do not access or use the Service.
              </p>
            </section>

            {/* 2. Information We Collect */}
            <section id="information-we-collect" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">2</span>
                Information We Collect
              </h2>
              <p>
                We collect information to provide, maintain, and improve our services. The categories of information we collect include:
              </p>

              <div className="space-y-4 pl-2">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    Account & Profile Information
                  </h3>
                  <p className="text-sm text-slate-600">
                    When you register for an account, we collect your name, email address, password hash (securely managed via Supabase Authentication), profile picture URL, and account preferences.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    Workspace & Team Member Data
                  </h3>
                  <p className="text-sm text-slate-600">
                    We collect workspace titles, invited colleague email addresses, role assignments (Owner, Admin, Member), invitation tokens, workspace settings, reply policies, and internal audit logs reflecting actions taken within the workspace.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    Google Business Profile Account & Location Data
                  </h3>
                  <p className="text-sm text-slate-600">
                    When you connect your Google Business Profile via OAuth 2.0, we collect the authorized Google account email address, Google account ID, location IDs, business titles, storefront addresses, phone numbers, and Google Place IDs.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    Customer Reviews, Ratings & Replies
                  </h3>
                  <p className="text-sm text-slate-600">
                    To deliver our review management features, we synchronize customer review IDs, reviewer public display names, reviewer public profile photo URLs, star ratings (1 to 5 stars), customer comment text, review submission/update timestamps, and existing published merchant replies.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    AI-Generated Reply Content & User Inputs
                  </h3>
                  <p className="text-sm text-slate-600">
                    We store user-selected reply tones (e.g., Empathetic, Professional, Friendly, Direct), custom business context descriptions, user feedback instructions, draft replies, and authorized published replies.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    Usage, Device & Technical Information
                  </h3>
                  <p className="text-sm text-slate-600">
                    When you access NexRep, our infrastructure automatically records standard technical information, including IP addresses, browser user agent, operating system, timestamped request logs, and referral URLs.
                  </p>
                </div>
              </div>
            </section>

            {/* 3. Google API Services */}
            <section id="google-api-services" className="scroll-mt-28 space-y-5">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-sm font-bold shrink-0">3</span>
                Google API Services & Limited Use Compliance
              </h2>
              <p>
                NexRep integrates with Google APIs—specifically the Google Business Profile API, My Business Business Information API, and My Business Account Management API—to provide automated and manual review synchronization, customer feedback monitoring, and review response publishing.
              </p>

              <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-3">
                <h3 className="text-base font-bold text-blue-950 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
                  Google OAuth 2.0 Authorization & Scope
                </h3>
                <p className="text-sm text-blue-900 leading-relaxed">
                  NexRep accesses your Google Business Profile data <strong>strictly after you provide explicit authorization</strong> through Google&rsquo;s standard OAuth 2.0 consent window. We request only the following scopes:
                </p>
                <ul className="list-disc list-inside text-sm text-blue-900 space-y-1.5 pl-2">
                  <li>
                    <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-xs">https://www.googleapis.com/auth/business.manage</code>: Used exclusively to list authorized business locations, fetch customer reviews, and submit authorized merchant replies.
                  </li>
                  <li>
                    <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-xs">openid</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-xs">email</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-xs">profile</code>: Used to verify the identity of the account connecting to the workspace.
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-bold text-slate-900">Encryption of OAuth Tokens</h3>
                <p>
                  Upon authorization, Google OAuth access tokens and refresh tokens are encrypted at rest using server-side <strong>AES-256-GCM encryption</strong> before being stored in our database. Encryption keys are stored in isolated server environment variables and are never exposed to browser clients or public code.
                </p>
              </div>

              {/* Callout: Google Limited Use Requirement */}
              <div className="p-6 rounded-2xl bg-emerald-50 border-2 border-emerald-300 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 text-emerald-950 font-bold text-base">
                  <Lock className="w-5 h-5 text-emerald-700 shrink-0" />
                  Google API Services User Data Policy — Limited Use Disclosure
                </div>
                <p className="text-sm text-emerald-900 leading-relaxed font-medium">
                  NexRep&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-emerald-950 hover:text-emerald-700 font-bold inline-flex items-center gap-0.5"
                  >
                    Google API Services User Data Policy <ExternalLink className="w-3.5 h-3.5 inline ml-0.5" />
                  </a>
                  , including the Limited Use requirements.
                </p>
                <ul className="list-disc list-inside text-xs text-emerald-900 space-y-1.5 pl-1">
                  <li><strong>No Data Sale:</strong> Google user data is NEVER sold, rented, leased, or disclosed to third-party data brokers.</li>
                  <li><strong>No Advertising:</strong> Google user data is NEVER used for personalized, retargeted, or interest-based advertising, and is never provided to advertising exchanges or data aggregators.</li>
                  <li><strong>Purpose-Bound:</strong> Google API data is used solely to provide and improve the review management, sentiment analysis, and response drafting capabilities explicitly requested by you.</li>
                  <li><strong>Human Inspection Limitations:</strong> NexRep personnel do not read Google user data unless you provide explicit consent for customer support, as required to resolve security incidents, or to comply with applicable law.</li>
                </ul>
              </div>
            </section>

            {/* 4. AI Processing & Third-Party LLM Disclosures */}
            <section id="ai-processing" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center text-sm font-bold shrink-0">4</span>
                AI Processing & Third-Party LLM Disclosures
              </h2>
              <p>
                NexRep incorporates generative artificial intelligence to assist merchants with drafting review replies. Here is an exact disclosure of how customer review content is processed:
              </p>
              <div className="space-y-3 pl-2">
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                    Data Sent to AI to Generate Suggested Replies
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    When reply generation is initiated (either manually by clicking &ldquo;Generate AI Reply&rdquo; or automatically via an enabled automation rule), the customer review text, reviewer public display name, star rating (1 to 5), location name, and your user-provided business context notes are transmitted to an external Large Language Model API over an encrypted TLS connection.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600 shrink-0" />
                    Third-Party AI Service Provider (OpenAI API)
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    NexRep utilizes OpenAI&rsquo;s commercial API platform (specifically model <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-xs">gpt-4o-mini</code>). In accordance with OpenAI&rsquo;s API data usage terms:
                  </p>
                  <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5 pl-1">
                    <li>
                      <strong>Model Training:</strong> API data is not used for model training unless the customer explicitly opts in.
                    </li>
                    <li>
                      <strong>Abuse-Monitoring Logs:</strong> Abuse-monitoring logs are retained for up to 30 days by default, subject to legal and safety exceptions.
                    </li>
                    <li>
                      <strong>Commercial API Controls:</strong> NexRep operates under OpenAI&rsquo;s standard commercial API terms and data controls, and does not claim custom zero-retention (ZDR) agreements or HIPAA Business Associate Agreements (BAAs).
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                    User Control & Approval Policies
                  </h3>
                  <p className="text-sm text-slate-600">
                    AI replies are created in draft status by default. No review reply is published to your live Google Business Profile without explicit merchant approval, unless your workspace administrator has explicitly opted into an automated publishing policy.
                  </p>
                </div>
              </div>
            </section>

            {/* 5. How We Use Information */}
            <section id="how-we-use-information" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">5</span>
                How We Use Information
              </h2>
              <p>We use the information we collect for specific operational purposes:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li><strong>Review Synchronization:</strong> To retrieve customer reviews and ratings from connected Google Business Profile locations and organize them into your unified workspace inbox.</li>
                <li><strong>Reply Drafting & Publishing:</strong> To generate contextual AI response drafts and publish approved replies directly to Google Business Profile.</li>
                <li><strong>Team Collaboration & Access Control:</strong> To authenticate team members, enforce workspace membership permissions (Owner, Admin, Member), and validate invitation links.</li>
                <li><strong>Audit Trails & Safety:</strong> To maintain tamper-evident audit logs of replies generated, modified, and published across team members.</li>
                <li><strong>Customer Support:</strong> To diagnose connection failures, investigate synchronization anomalies, and provide responsive customer service.</li>
                <li><strong>Security & Abuse Prevention:</strong> To protect our infrastructure against unauthorized access, fraudulent activity, and security breaches.</li>
              </ul>
            </section>

            {/* 6. Data Storage and Security */}
            <section id="data-storage-and-security" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">6</span>
                Data Storage & Security
              </h2>
              <p>
                We employ comprehensive technical and organizational measures to safeguard your personal data and business information:
              </p>
              <div className="grid sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-xl bg-white border border-slate-200">
                  <h4 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-blue-600" /> Managed Supabase Infrastructure
                  </h4>
                  <p className="text-xs text-slate-600">
                    Data is stored in managed PostgreSQL databases hosted by Supabase, protected by automated infrastructure backups and network isolation.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200">
                  <h4 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-blue-600" /> Row-Level Security (RLS)
                  </h4>
                  <p className="text-xs text-slate-600">
                    Strict database Row-Level Security policies guarantee multi-tenant isolation. Workspace members cannot view or modify data belonging to other workspaces.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200">
                  <h4 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-blue-600" /> AES-256-GCM Token Encryption
                  </h4>
                  <p className="text-xs text-slate-600">
                    Google OAuth refresh and access tokens are encrypted with authenticated AES-256-GCM encryption before database persistence.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200">
                  <h4 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4 text-blue-600" /> Encrypted In-Transit & At Rest
                  </h4>
                  <p className="text-xs text-slate-600">
                    All web communications between your browser, our servers, and third-party APIs are encrypted with industry-standard TLS 1.3 encryption.
                  </p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  While we implement rigorous technical safeguards adhering to recognized industry best practices, no method of transmission over the internet or method of electronic storage is 100% impenetrable; therefore, we cannot guarantee absolute security.
                </p>
              </div>
            </section>

            {/* 7. Data Sharing and Third-Party Service Providers */}
            <section id="data-sharing" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">7</span>
                Data Sharing & Third-Party Service Providers
              </h2>
              <p>
                We do not sell, rent, or trade your personal or Google user data. We share information only with trusted third-party service providers who assist in operating our platform, subject to strict confidentiality and security terms:
              </p>
              <div className="divide-y divide-slate-200 rounded-xl bg-white border border-slate-200 overflow-hidden text-sm">
                <div className="p-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                  <div>
                    <strong>Google Cloud & Google Business Profile APIs</strong>
                    <div className="text-xs text-slate-500">Google LLC</div>
                  </div>
                  <span className="text-xs bg-slate-100 px-2.5 py-1 rounded-md text-slate-700 font-medium self-start sm:self-auto">
                    Location synchronization & review replies
                  </span>
                </div>
                <div className="p-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                  <div>
                    <strong>Supabase Inc.</strong>
                    <div className="text-xs text-slate-500">Database & Authentication Hosting</div>
                  </div>
                  <span className="text-xs bg-slate-100 px-2.5 py-1 rounded-md text-slate-700 font-medium self-start sm:self-auto">
                    Secure PostgreSQL data storage & auth sessions
                  </span>
                </div>
                <div className="p-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                  <div>
                    <strong>OpenAI, LLC</strong>
                    <div className="text-xs text-slate-500">Commercial API Services</div>
                  </div>
                  <span className="text-xs bg-slate-100 px-2.5 py-1 rounded-md text-slate-700 font-medium self-start sm:self-auto">
                    Generative review response drafting
                  </span>
                </div>
                <div className="p-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                  <div>
                    <strong>Vercel Inc.</strong>
                    <div className="text-xs text-slate-500">Application Hosting & Edge Infrastructure</div>
                  </div>
                  <span className="text-xs bg-slate-100 px-2.5 py-1 rounded-md text-slate-700 font-medium self-start sm:self-auto">
                    Next.js application deployment & routing
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                We may also disclose information if required to do so by applicable law, regulation, valid legal subpoena, or governmental request.
              </p>
            </section>

            {/* 8. Data Retention */}
            <section id="data-retention" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">8</span>
                Data Retention Policies
              </h2>
              <p>
                We retain your information only as long as necessary to fulfill the operational purposes described in this Privacy Policy:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2 text-sm">
                <li>
                  <strong>Active Workspaces:</strong> Reviews, ratings, locations, and drafts are retained for as long as your workspace remains active.
                </li>
                <li>
                  <strong>Disconnected Locations:</strong> When you disconnect a Google Business Profile location in NexRep, the location is marked disconnected (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-xs">is_connected = false</code>). Synchronization and automated replies immediately cease for that location. Previously synchronized historical reviews remain stored in your workspace. Stored OAuth credentials remain associated with your workspace to allow reconnection unless access is revoked via Google Account Security or deleted upon support request.
                </li>
                <li>
                  <strong>Account & Workspace Deletion:</strong> Upon receiving a verified account or workspace deletion request, all associated personal profiles, workspace records, locations, reviews, and OAuth integration records are permanently purged from our active primary database within 30 days.
                </li>
                <li>
                  <strong>Database Backups & Disaster Recovery:</strong> Residual copies may temporarily persist in encrypted, automated database snapshots maintained by our database infrastructure provider (Supabase) for disaster recovery and operational continuity. These backups expire and are routinely overwritten according to Supabase&rsquo;s managed infrastructure retention cycles (which vary by project plan and tier; we do not independently promise an exact 30-day backup purge window). Once backup cycles rotate, all residual copies are permanently deleted.
                </li>
                <li>
                  <strong>Third-Party Logs:</strong> Log records maintained by third-party infrastructure providers (Vercel, Supabase, Google Cloud, OpenAI) are retained according to their own standard system retention schedules.
                </li>
              </ul>
            </section>

            {/* 9. Google Account Disconnection */}
            <section id="google-disconnection" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-sm font-bold shrink-0">9</span>
                Google Account Disconnection & Access Revocation
              </h2>
              <p>
                You retain full control over your Google Business Profile connection. You can disconnect or revoke NexRep&rsquo;s access at any time through the following mechanisms:
              </p>
              <div className="grid sm:grid-cols-2 gap-4 pt-1">
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold">A</span>
                    Within the NexRep Dashboard
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Navigate to <strong>Dashboard &gt; Locations</strong> and click <em>&ldquo;Disconnect Profile&rdquo;</em>. This action immediately updates the location status to inactive (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">is_connected = false</code>), stopping review synchronization and pausing automated replies. Previously imported reviews remain preserved in your workspace history, and the OAuth credentials remain stored in our encrypted database to allow seamless profile reconnection.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold">B</span>
                    Directly via Google Account Security
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    To completely invalidate and revoke NexRep&rsquo;s OAuth authorization tokens from Google&rsquo;s servers, visit your Google Account Third-Party Access dashboard at{" "}
                    <a
                      href="https://myaccount.google.com/permissions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      myaccount.google.com/permissions <ExternalLink className="w-3 h-3 inline" />
                    </a>
                    . Alternatively, you may contact our support desk to request manual deletion of your stored OAuth integration record from our database.
                  </p>
                </div>
              </div>
            </section>

            {/* 10. User Rights, Data Export and Deletion Requests */}
            <section id="user-rights" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">10</span>
                User Rights, Data Export & Deletion Requests
              </h2>
              <p>
                Depending on your jurisdiction and applicable data protection regulations (such as GDPR, CCPA/CPRA, and Google API Policies), you have the following rights:
              </p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-sm">
                <li>Access the personal information we hold about you.</li>
                <li>Correct inaccurate or incomplete profile or business details.</li>
                <li>Request deletion of your personal data and workspace history.</li>
                <li>Withdraw consent for Google OAuth integration at any time.</li>
                <li>Export your customer reviews and ratings in a structured, portable format.</li>
              </ul>

              {/* Data Export Box */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-600" /> In-App Review Dataset Export (CSV)
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  You can download your complete customer review datasets (including Review ID, Author Name, Star Rating, Review Date, Status, Sentiment, and Content) directly from the platform by clicking the <strong>&ldquo;Export CSV&rdquo;</strong> button on the <strong>Analytics</strong> (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-xs">/dashboard/analytics</code>) or <strong>Reports</strong> (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-xs">/dashboard/reports</code>) pages. For full workspace metadata exports beyond reviews, please contact our support desk.
                </p>
              </div>

              {/* Data Deletion Box */}
              <div className="p-5 rounded-2xl bg-slate-100/80 border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900 text-sm">How to Request Account & Data Deletion</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Because NexRep does not currently provide an automated self-serve account deletion button in the dashboard, users and workspace owners may request complete deletion of their account, workspace, and synchronized Google Business Profile records by emailing our verified support desk at{" "}
                  <a href="mailto:parthprajapati7759@gmail.com" className="text-blue-600 hover:underline font-bold">
                    parthprajapati7759@gmail.com
                  </a>{" "}
                  or{" "}
                  <a href="mailto:matrojatech@gmail.com" className="text-blue-600 hover:underline font-bold">
                    matrojatech@gmail.com
                  </a>{" "}
                  with the subject line <em>&ldquo;NexRep Data Deletion Request&rdquo;</em> from your registered account email. Verified deletion requests are executed in our primary database within 30 calendar days.
                </p>
              </div>
            </section>

            {/* 11. Cookies and Authentication Sessions */}
            <section id="cookies" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">11</span>
                Cookies & Authentication Sessions
              </h2>
              <p>
                NexRep uses only essential, functional cookies and session tokens necessary to operate the platform:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2 text-sm">
                <li><strong>Authentication Cookies:</strong> Secure, HTTP-only session cookies issued by Supabase to maintain your logged-in state across page navigations.</li>
                <li><strong>CSRF State Cookies:</strong> Temporary, encrypted cookies (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-xs">nexrep_google_oauth_state</code>) used during Google OAuth authorization to protect against Cross-Site Request Forgery attacks.</li>
              </ul>
              <p className="text-xs text-slate-500">
                NexRep does not use third-party advertising cookies, behavioral tracking scripts, or ad networks.
              </p>
            </section>

            {/* 12. Children's Privacy */}
            <section id="childrens-privacy" className="scroll-mt-28 space-y-3">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">12</span>
                Children&rsquo;s Privacy
              </h2>
              <p>
                NexRep is a business-to-business reputation management platform and is not directed to individuals under 18 years of age. We do not knowingly collect personal data from children. If you become aware that a child has provided us with personal information, please contact us immediately at{" "}
                <a href="mailto:parthprajapati7759@gmail.com" className="text-blue-600 hover:underline">
                  parthprajapati7759@gmail.com
                </a>{" "}
                so we can delete such records.
              </p>
            </section>

            {/* 13. International Data Transfers */}
            <section id="international-transfers" className="scroll-mt-28 space-y-3">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">13</span>
                International Data Transfers
              </h2>
              <p>
                Your information may be transferred to and maintained on servers located outside of your state, province, or country where data protection laws may differ. Our cloud providers (including Supabase, Vercel, Google Cloud, and OpenAI) operate enterprise data centers subject to strict contractual data protection agreements and security certifications.
              </p>
            </section>

            {/* 14. Changes to This Privacy Policy */}
            <section id="changes-to-policy" className="scroll-mt-28 space-y-3">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">14</span>
                Changes to This Privacy Policy
              </h2>
              <p>
                We may update this Privacy Policy from time to time to reflect operational, technological, or legal changes. When updates are published, we will update the &ldquo;Last Updated&rdquo; date at the top of this page. We encourage you to review this Privacy Policy periodically.
              </p>
            </section>

            {/* 15. Contact Information & Developer Details */}
            <section id="contact-information" className="scroll-mt-28 space-y-4">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">15</span>
                Contact Information & Developer Details
              </h2>
              <p>
                If you have questions, comments, or data rights inquiries regarding this Privacy Policy or our compliance with Google API Services policies, please contact our team directly:
              </p>

              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center gap-2.5 font-bold text-slate-900 text-base">
                  <Mail className="w-5 h-5 text-blue-600 shrink-0" />
                  NexRep Support & Privacy Contacts
                </div>
                <div className="space-y-1.5 text-sm text-slate-600">
                  <div>
                    <strong>Product:</strong> NexRep (by NexFlowOps)
                  </div>
                  <div>
                    <strong>Lead Developer & Project Maintainer:</strong> Parth Prajapati
                  </div>
                  <div>
                    <strong>Website:</strong>{" "}
                    <a
                      href="https://nex-rev.vercel.app"
                      className="text-blue-600 hover:underline"
                    >
                      https://nex-rev.vercel.app
                    </a>
                  </div>
                  <div>
                    <strong>Developer & Privacy Inquiries:</strong>{" "}
                    <a
                      href="mailto:parthprajapati7759@gmail.com?subject=NexRep%20Privacy%20Inquiry"
                      className="text-blue-600 font-bold hover:underline"
                    >
                      parthprajapati7759@gmail.com
                    </a>
                  </div>
                  <div>
                    <strong>Operations & Support Desk:</strong>{" "}
                    <a
                      href="mailto:matrojatech@gmail.com?subject=NexRep%20Support%20Inquiry"
                      className="text-blue-600 font-bold hover:underline"
                    >
                      matrojatech@gmail.com
                    </a>
                  </div>
                  <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                    Our team typically responds to verified inquiries within 1 to 2 business days.
                  </div>
                </div>
              </div>
            </section>
          </article>
        </div>
      </main>

      {/* Public Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6 text-sm">
          <div className="flex items-center gap-3">
            <Link href="/">
              <NexRepLogo variant="dark" showTagline={false} />
            </Link>
          </div>
          <p>© 2026 NexFlowOps. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs">
            <Link href="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/privacy-policy" className="text-white font-medium hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
