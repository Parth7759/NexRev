"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Star, Loader2, CheckCircle2 } from "lucide-react";
import { useActionState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

const initialState = {
  error: "",
};

function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState);
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const urlMessage = searchParams.get("message");
  const displayError = state?.error || urlError;

  // Check if env vars are present (client-side check for UI warning)
  const isMissingConfig = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <div className="flex flex-1 flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <Star className="text-white w-6 h-6" />
              </div>
              <span className="font-bold text-3xl tracking-tight text-slate-900">NexRep</span>
            </Link>
          </div>
          
          <div className="bg-white py-8 px-10 shadow-xl rounded-2xl border border-slate-100">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 mb-6">
              Sign in to your account
            </h2>

            {isMissingConfig ? (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg mb-6 flex items-start text-sm">
                <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-blue-600" />
                <div>
                  <strong>Configuration Required</strong><br />
                  Please configure <code className="bg-white px-1 py-0.5 rounded text-xs border border-blue-100">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="bg-white px-1 py-0.5 rounded text-xs border border-blue-100">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code> to enable sign-in.
                </div>
              </div>
            ) : displayError ? (
              <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg mb-6 flex items-start text-sm">
                <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-red-600" />
                <div>{displayError}</div>
              </div>
            ) : urlMessage ? (
              <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg mb-6 flex items-start text-sm">
                <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-green-600" />
                <div>{urlMessage}</div>
              </div>
            ) : null}

            <form className="space-y-6" action={formAction}>
              <div>
                <Label htmlFor="email">Email address</Label>
                <div className="mt-2">
                  <Input id="email" name="email" type="email" autoComplete="email" required disabled={isPending} />
                </div>
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <div className="mt-2">
                  <Input id="password" name="password" type="password" autoComplete="current-password" required disabled={isPending} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <label htmlFor="remember-me" className="ml-3 block text-sm leading-6 text-slate-900">
                    Remember me
                  </label>
                </div>

                <div className="text-sm leading-6">
                  <a href="#" className="font-semibold text-blue-600 hover:text-blue-500">
                    Forgot password?
                  </a>
                </div>
              </div>

              <div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={isPending}>
                  {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Sign in
                </Button>
              </div>
            </form>

            <p className="mt-8 text-center text-sm text-slate-500">
              Not a member?{" "}
              <Link href="/signup" className="font-semibold leading-6 text-blue-600 hover:text-blue-500">
                Start a 14-day free trial
              </Link>
            </p>
          </div>
        </div>
      </div>
      <div className="hidden lg:block lg:flex-1 bg-slate-900 bg-[url('https://images.unsplash.com/photo-1557804506-669a67965ba0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80')] bg-cover bg-center">
        <div className="w-full h-full bg-slate-900/80 flex items-center justify-center p-12">
          <div className="max-w-lg text-white">
            <h2 className="text-4xl font-bold mb-6 leading-tight">Turn your online reviews into your biggest growth engine.</h2>
            <p className="text-lg text-slate-300">Join thousands of businesses managing their reputation with AI-powered insights and automated responses.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

