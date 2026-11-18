import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  ShieldCheck,
  Mail,
} from "lucide-react";
import { NexRepLogo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Terms of Service | NexRep - AI Google Review Management",
  description:
    "NexRep Terms of Service governing access to our Google Business Profile review management, AI reply drafting, and automated publishing platform.",
  alternates: {
    canonical: "https://nex-rev.vercel.app/terms",
  },
};

export default function TermsOfServicePage() {
  const lastUpdated = "November 18, 2026";

  const sections = [
    { id: "acceptance", label: "1. Acceptance of Terms" },
    { id: "service-description", label: "2. Service Description" },
    { id: "google-api-authorization", label: "3. Google Business Profile Authorization" },
    { id: "ai-replies-and-responsibility", label: "4. AI-Generated Replies & Merchant Responsibility" },
    { id: "workspace-accounts", label: "5. Accounts, Workspaces & Acceptable Use" },
    { id: "data-and-privacy", label: "6. Data Privacy & Security" },
    { id: "disconnection-and-termination", label: "7. Disconnection & Termination" },
    { id: "disclaimers", label: "8. Disclaimers & Limitation of Liability" },
    { id: "changes", label: "9. Changes to These Terms" },
    { id: "contact", label: "10. Contact Information" },
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
          <Link href="/privacy-policy" className="hover:text-blue-600 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-blue-600 font-semibold">
            Terms of Service
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
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-100 mb-4">
            <FileText className="w-3.5 h-3.5" /> Legal & Service Terms
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
            Terms of Service
          </h1>
          <p className="mt-3 text-slate-600 max-w-2xl leading-relaxed">
            These Terms of Service govern your access to and use of NexRep (operated by NexFlowOps),
            including Google Business Profile integrations, AI review reply generation, and automated reply workflows.
          </p>
          <p className="mt-3 text-xs text-slate-500 font-medium">
            Last Updated: {lastUpdated}
          </p>
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 lg:px-8 py-12">
        <div className="grid lg:grid-cols-[240px_1fr] gap-10">
          {/* Table of Contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-28 p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Contents
              </div>
              <nav className="space-y-1.5">
                {sections.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="block text-xs text-slate-600 hover:text-blue-600 py-1 transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Clauses */}
          <article className="space-y-10 text-sm text-slate-700 leading-relaxed">
            <section id="acceptance" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">1. Acceptance of Terms</h2>
              <p>
                By creating an account, connecting a Google Business Profile, or using NexRep, you agree
                to be bound by these Terms of Service and our{" "}
                <Link href="/privacy-policy" className="text-blue-600 hover:underline font-medium">
                  Privacy Policy
                </Link>
                . If you are using NexRep on behalf of a business or organization, you represent that you
                have authority to bind that organization to these Terms.
              </p>
            </section>

            <section id="service-description" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">2. Service Description</h2>
              <p>
                NexRep provides business-to-business reputation management software that synchronizes
                customer reviews from connected Google Business Profile locations, drafts AI-assisted
                replies, enforces merchant-configured approval and delay policies, and publishes approved
                or policy-eligible replies back to Google Business Profile.
              </p>
            </section>

            <section id="google-api-authorization" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">3. Google Business Profile Authorization</h2>
              <p>
                Connecting a Google Business Profile requires explicit OAuth 2.0 authorization by an
                authorized workspace owner or administrator for the{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-xs">
                  https://www.googleapis.com/auth/business.manage
                </code>{" "}
                scope. You must hold valid management authority for every Google Business Profile
                location you connect. Your use of Google Business Profile features remains subject to
                Google&rsquo;s applicable terms and policies.
              </p>
            </section>

            <section id="ai-replies-and-responsibility" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">4. AI-Generated Replies &amp; Merchant Responsibility</h2>
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 leading-relaxed">
                  <strong>Recommended Safety Practice:</strong> NexRep recommends requiring manual human
                  approval for 1&ndash;3 star reviews and sensitive customer complaints before publishing
                  replies publicly on Google.
                </p>
              </div>
              <p>
                You are solely responsible for configuring your workspace&rsquo;s automation mode (Manual
                Approval, Auto-Publish 4&ndash;5 Stars, or Auto-Publish All), business context, and
                review reply policies, as well as for all replies published on behalf of your business
                locations. AI-generated outputs should be reviewed for legal, regulatory, and brand
                compliance—especially in regulated industries (such as healthcare, legal, or financial
                services).
              </p>
            </section>

            <section id="workspace-accounts" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">5. Accounts, Workspaces &amp; Acceptable Use</h2>
              <p>
                You agree to maintain the confidentiality of your account credentials, ensure accurate
                workspace role assignments, and not misuse NexRep to post spam, unlawful, deceptive,
                harassing, or policy-violating content to Google Business Profile or any third-party
                platform.
              </p>
            </section>

            <section id="data-and-privacy" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">6. Data Privacy &amp; Security</h2>
              <p>
                Our handling of workspace data, Google user data, OAuth tokens, and third-party AI API
                processing is governed by our{" "}
                <Link href="/privacy-policy" className="text-blue-600 hover:underline font-medium">
                  Privacy Policy
                </Link>
                , including our adherence to the Google API Services User Data Policy and Limited Use
                requirements.
              </p>
            </section>

            <section id="disconnection-and-termination" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">7. Disconnection &amp; Termination</h2>
              <p>
                You may pause automated publishing or disconnect your Google Business Profile at any time
                from your NexRep dashboard or by revoking access in your Google Account security settings.
                Upon disconnection or revocation, NexRep ceases publishing replies for that workspace.
              </p>
            </section>

            <section id="disclaimers" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">8. Disclaimers &amp; Limitation of Liability</h2>
              <p>
                NexRep is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. Because
                review delivery and reply publishing depend on third-party platforms (including Google
                Business Profile APIs and AI model providers), we do not guarantee uninterrupted or
                error-free third-party delivery. To the maximum extent permitted by law, NexFlowOps shall
                not be liable for indirect, incidental, special, or consequential damages arising from
                use of the service.
              </p>
            </section>

            <section id="changes" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">9. Changes to These Terms</h2>
              <p>
                We may update these Terms of Service periodically to reflect product or legal updates.
                Continued use of NexRep after the updated date constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section id="contact" className="scroll-mt-28 space-y-3">
              <h2 className="text-xl font-bold text-slate-900">10. Contact Information</h2>
              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Mail className="w-4 h-4 text-blue-600" />
                  NexRep Legal &amp; Support Contacts
                </div>
                <div className="text-sm text-slate-600 space-y-1">
                  <div><strong>Product:</strong> NexRep (by NexFlowOps)</div>
                  <div>
                    <strong>Developer Inquiries:</strong>{" "}
                    <a href="mailto:parthprajapati7759@gmail.com" className="text-blue-600 hover:underline font-medium">
                      parthprajapati7759@gmail.com
                    </a>
                  </div>
                  <div>
                    <strong>Support Desk:</strong>{" "}
                    <a href="mailto:matrojatech@gmail.com" className="text-blue-600 hover:underline font-medium">
                      matrojatech@gmail.com
                    </a>
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
          <Link href="/">
            <NexRepLogo variant="dark" showTagline={false} />
          </Link>
          <p>© 2026 NexFlowOps. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs">
            <Link href="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/privacy-policy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-white font-medium hover:underline">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

