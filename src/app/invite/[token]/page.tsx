"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  UserCheck,
  Shield,
  ArrowRight,
  LogIn,
  UserPlus,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { validateInvitationTokenAction, acceptInvitationAction } from "@/app/dashboard/team/actions";
import { NexRepLogo } from "@/components/brand/logo";

interface InvitationData {
  email: string;
  role: "admin" | "member";
  workspaceName: string;
  workspaceId: string;
  expiresAt: string;
  isExpired: boolean;
  status?: string;
}

function InviteContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);

  // Authenticated user state
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptSuccess, setAcceptSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAuthAndInvite() {
      // 1. Check if user is signed in
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (isMounted) {
        setCurrentUserEmail(user?.email || null);
      }

      // 2. Validate token
      const res = await validateInvitationTokenAction(token);
      if (!isMounted) return;

      if (res.valid && res.invitation) {
        setIsValid(true);
        setInvitation(res.invitation);
      } else {
        setIsValid(false);
        setErrorMsg(res.error || "This invitation link is invalid or has expired.");
      }
      setIsLoading(false);
    }

    checkAuthAndInvite();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleAcceptInvite = async () => {
    if (!token) return;
    setIsAccepting(true);
    setErrorMsg(null);

    const res = await acceptInvitationAction(token);
    setIsAccepting(false);

    if (res.success) {
      setAcceptSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 1200);
    } else {
      setErrorMsg(res.error || "Failed to accept invitation. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Logo */}
        <div className="flex justify-center mb-6">
          <Link href="/" className="flex items-center group">
            <NexRepLogo variant="light" showTagline={true} />
          </Link>
        </div>

        <Card className="border-slate-200/80 bg-white shadow-xl rounded-2xl overflow-hidden">
          {isLoading ? (
            <CardContent className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-slate-900 mx-auto" />
              <p className="text-sm font-medium text-slate-600">Verifying invitation...</p>
            </CardContent>
          ) : !isValid ? (
            <div className="p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Invitation Expired or Invalid</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {errorMsg || "This invitation link has expired or has already been used."}
                </p>
              </div>
              <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                <Link href="/login">
                  <Button variant="outline" className="text-xs w-full">
                    Go to Login
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button className="bg-slate-900 hover:bg-slate-800 text-white text-xs w-full">
                    Open Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          ) : acceptSuccess ? (
            <div className="p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Welcome to the Team!</h3>
                <p className="text-xs text-slate-500 mt-1">
                  You have joined <strong>{invitation?.workspaceName}</strong>. Redirecting to your dashboard...
                </p>
              </div>
              <Loader2 className="w-5 h-5 animate-spin text-slate-900 mx-auto" />
            </div>
          ) : (
            <>
              <CardHeader className="text-center pb-4 pt-6 border-b border-slate-100">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center mx-auto mb-3">
                  <Building2 className="w-6 h-6" />
                </div>
                <CardTitle className="text-xl font-bold text-slate-900">Workspace Invitation</CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-1">
                  You&apos;ve been invited to collaborate on reputation management.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 space-y-5">
                {errorMsg && (
                  <div className="p-3 text-xs rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Workspace Details Card */}
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">Workspace</span>
                    <span className="text-xs font-bold text-slate-900 truncate max-w-[200px]">
                      {invitation?.workspaceName}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">Assigned Role</span>
                    <Badge
                      variant="outline"
                      className={`capitalize text-xs font-semibold px-2 py-0.5 ${
                        invitation?.role === "admin"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {invitation?.role === "admin" ? (
                        <Shield className="w-3 h-3 mr-1 text-blue-600" />
                      ) : (
                        <UserCheck className="w-3 h-3 mr-1 text-slate-600" />
                      )}
                      {invitation?.role}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">Invited Email</span>
                    <span className="text-xs font-mono text-slate-700">{invitation?.email}</span>
                  </div>
                </div>

                {/* Acceptance Decision Flow */}
                {currentUserEmail ? (
                  invitation && currentUserEmail.toLowerCase() !== invitation.email.toLowerCase() ? (
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
                        <div className="flex items-center gap-1.5 font-bold text-amber-950">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Account Mismatch</span>
                        </div>
                        <p className="leading-relaxed">
                          This invitation was sent to <strong className="font-semibold text-amber-950">{invitation.email}</strong>, but you are currently signed in as <strong className="font-semibold text-amber-950">{currentUserEmail}</strong>.
                        </p>
                      </div>

                      <div className="pt-1 flex flex-col gap-2">
                        <Link
                          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(
                            invitation.email
                          )}`}
                          className="w-full"
                        >
                          <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs h-10 shadow-xs gap-1.5">
                            <LogIn className="w-3.5 h-3.5" /> Switch Account to Accept
                          </Button>
                        </Link>
                        <Link href="/dashboard" className="w-full">
                          <Button variant="outline" className="w-full text-xs h-9">
                            Stay Signed In & Return to Dashboard
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200/70 text-xs text-blue-900">
                        Signed in as <strong className="font-semibold">{currentUserEmail}</strong>
                      </div>

                      <Button
                        onClick={handleAcceptInvite}
                        disabled={isAccepting}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs h-10 shadow-xs gap-1.5"
                      >
                        {isAccepting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Joining Workspace...
                          </>
                        ) : (
                          <>
                            Accept Invitation & Join <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-600 text-center">
                      Sign in with an existing account or register a new account to accept this invitation.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        href={`/login?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(
                          invitation?.email || ""
                        )}`}
                        className="w-full"
                      >
                        <Button variant="outline" className="w-full text-xs h-9 gap-1.5">
                          <LogIn className="w-3.5 h-3.5" /> Sign In
                        </Button>
                      </Link>
                      <Link
                        href={`/signup?email=${encodeURIComponent(invitation?.email || "")}`}
                        className="w-full"
                      >
                        <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 gap-1.5">
                          <UserPlus className="w-3.5 h-3.5" /> Register
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function InviteAcceptancePage(props: {
  params: Promise<{ token: string }>;
}) {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
        </div>
      }
    >
      <InviteContent {...props} />
    </React.Suspense>
  );
}
