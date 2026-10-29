import { Suspense } from "react";
import { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { getPublicQrLandingDataAction } from "@/app/dashboard/qr/actions";
import { PublicReviewClient } from "./review-client";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicQrLandingDataAction(slug);

  if (!result.success || !result.qrCode) {
    return {
      title: "Review Business | NexRep",
      description: "Leave a verified customer review.",
    };
  }

  const { businessName, title } = result.qrCode;

  return {
    title: `${title} - ${businessName} | Verified Google Review`,
    description: `Share your genuine feedback for ${businessName} on official Google Reviews.`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

async function PublicReviewContent({ params }: PageProps) {
  const { slug } = await params;
  const result = await getPublicQrLandingDataAction(slug);

  if (!result.success || !result.qrCode) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200/90 shadow-sm space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900">
              Review Page Unavailable
            </h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              {result.error || "This review QR link is inactive or no longer valid. If you were provided this code by a business, please inform them or search for the business directly on Google Maps."}
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center text-xs font-semibold text-emerald-800 hover:text-emerald-950"
            >
              Learn more about NexRep
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <PublicReviewClient qrData={result.qrCode} />;
}

export default function PublicReviewPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      }
    >
      <PublicReviewContent {...props} />
    </Suspense>
  );
}
