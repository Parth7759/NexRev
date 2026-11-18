import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowRight, BarChart, ShieldCheck, Star } from 'lucide-react';
import { NexRepLogo } from '@/components/brand/logo';

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="px-6 lg:px-12 h-20 flex items-center justify-between border-b border-slate-200 bg-white">
        <Link href="/" className="flex items-center">
          <NexRepLogo variant="light" showTagline={true} />
        </Link>
        <nav className="hidden md:flex gap-8 text-sm font-medium">
          <Link href="#features" className="hover:text-blue-600 transition-colors">Features</Link>
          <Link href="#workflow" className="hover:text-blue-600 transition-colors">Workflow</Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium hover:text-blue-600 transition-colors">
            Login
          </Link>
          <Link href="/signup" className={cn(buttonVariants({ variant: "default" }), "bg-blue-600 hover:bg-blue-700 text-white rounded-full px-6")}>
            Get Started <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="px-6 lg:px-12 py-24 md:py-32 text-center max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4" /> Introducing AI Reply Assistant
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 text-slate-900 leading-tight">
            Smarter Reviews. <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Stronger Reputation.</span>
          </h1>
          <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Manage your Google Business Profile reviews across all locations from one intelligent, unified dashboard. Powered by AI to help you respond faster and smarter.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup" className={cn(buttonVariants({ size: "lg", variant: "default" }), "bg-blue-600 hover:bg-blue-700 text-white rounded-full px-8 text-base")}>
              Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
            <Button size="lg" variant="outline" className="rounded-full px-8 text-base border-slate-300 text-slate-700 hover:bg-slate-100">
              Book a Demo
            </Button>
          </div>
        </section>

        <section id="features" className="px-6 lg:px-12 py-24 bg-white border-y border-slate-200">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-slate-900">Everything you need to dominate local search</h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">Powerful tools built for agencies and multi-location businesses.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: Star, title: "Review Aggregation", desc: "See all your reviews from every location in one unified inbox." },
                { icon: BarChart, title: "Advanced Analytics", desc: "Track average ratings, response times, and sentiment trends." },
                { icon: ShieldCheck, title: "AI-Powered Replies", desc: "Generate empathetic, professional, and on-brand responses in seconds." }
              ].map((feat, i) => (
                <div key={i} className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                  <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-6">
                    <feat.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-slate-900">{feat.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{feat.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-6 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-sm">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-block">
              <NexRepLogo variant="dark" showTagline={false} />
            </Link>
          </div>
          <p>© 2026 NexFlowOps. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs">
            <Link href="/privacy-policy" className="hover:text-white transition-colors">
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

function Sparkles(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
  )
}
