import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Activity, MessageSquare, ArrowRight, ShieldCheck, Key } from "lucide-react";

export default function AIPage() {
  const isConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== "");
  const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

  return (
    <div className="space-y-6 max-w-7xl w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">AI Reply Assistant</h2>
          <p className="text-slate-500">Monitor your AI integration and generation status.</p>
        </div>
        <Link href="/dashboard/reviews">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm h-9">
            Open Reviews Assistant <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Generated Replies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">1,248</div>
            <p className="text-xs text-slate-500 mt-1">This month across workspaces</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Time Saved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">41 hrs</div>
            <p className="text-xs text-slate-500 mt-1">Estimated response time saved</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Provider Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isConfigured ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                  <span className="font-semibold text-slate-900">Active</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">OpenAI ({modelName})</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                  <span className="font-semibold text-slate-900">Setup Required</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Missing OPENAI_API_KEY</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Security & Configuration Architecture */}
      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Server-Side AI Architecture
          </CardTitle>
          <CardDescription>
            Your AI credentials are never exposed to browser client code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <div className="flex items-start gap-3 bg-white p-4 rounded-lg border border-slate-200">
            <Key className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-slate-900">Secure Environment Configuration</p>
              <p className="text-xs text-slate-500 mt-1">
                The API key is securely retrieved from the server-only <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800">OPENAI_API_KEY</code> variable. No <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800">NEXT_PUBLIC_</code> prefixes are used.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-white p-4 rounded-lg border border-slate-200">
            <Activity className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-slate-900">Rate Limiting & Tenant Protection</p>
              <p className="text-xs text-slate-500 mt-1">
                Every generation request enforces user authentication, multi-tenant workspace membership verification, and a sliding-window rate limit (10 requests/min).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
          <CardDescription>Using the AI Reply Assistant in the Reviews tab.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="mt-1 bg-blue-100 text-blue-700 p-2 rounded-lg">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">1. Select a Review</h4>
              <p className="text-sm text-slate-600">
                Choose any customer feedback from your reviews inbox or use the provided sample demo reviews.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="mt-1 bg-blue-100 text-blue-700 p-2 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">2. Choose Tone & Generate Draft</h4>
              <p className="text-sm text-slate-600">
                Select between <strong>Professional</strong>, <strong>Friendly</strong>, <strong>Concise</strong>, or <strong>Empathetic</strong> tone. The AI evaluates the customer rating and specific feedback to draft a tailored response.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="mt-1 bg-blue-100 text-blue-700 p-2 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">3. Edit and Save</h4>
              <p className="text-sm text-slate-600">
                Fine-tune the draft in the interactive editor before saving. Verified replies are stored in your workspace&apos;s database table.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customer Review Assistant Architecture & Compliance */}
      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <CardTitle>Customer Review-Writing Assistant</CardTitle>
          </div>
          <CardDescription>
            Ethical review-writing support designed to help consumers put genuine experiences into words without manipulation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border border-slate-200 bg-white space-y-1">
              <h5 className="font-semibold text-sm text-slate-900">Genuine Experience Only</h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                The AI never fabricates visits, staff interactions, or events. It only synthesizes real customer notes and selected highlights.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-slate-200 bg-white space-y-1">
              <h5 className="font-semibold text-sm text-slate-900">Zero Rating Pressure</h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                Zero coercion to leave 5-star reviews. Critical feedback (1-3 stars) is fully supported with polite, constructive articulation.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-slate-200 bg-white space-y-1">
              <h5 className="font-semibold text-sm text-slate-900">Always Optional & Editable</h5>
              <p className="text-xs text-slate-600 leading-relaxed">
                Review drafts are strictly advisory. Customers retain 100% control to review, edit, or discard any suggested wording before posting.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
