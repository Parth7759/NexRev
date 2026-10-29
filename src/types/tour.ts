export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetId: string;
  route?: string;
  placement?: "bottom" | "top" | "left" | "right" | "center";
  category: "Overview" | "Reputation" | "Reporting" | "Account";
  badge?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "step-location-selector",
    title: "Google Business Profile Selector",
    description:
      "Select and switch between your verified Google Business Profiles. All reputation metrics, customer reviews, and local growth tools dynamically synchronize to your active business location.",
    targetId: "tour-location-selector",
    route: "/dashboard",
    placement: "bottom",
    category: "Overview",
    badge: "1 of 11",
  },
  {
    id: "step-kpi-cards",
    title: "Reputation KPIs & Growth Metrics",
    description:
      "Track your verified total reviews, live star rating, unanswered customer feedback count, and response rate. Period-over-period trends reflect real Google customer sentiment.",
    targetId: "tour-kpi-cards",
    route: "/dashboard",
    placement: "bottom",
    category: "Overview",
    badge: "2 of 11",
  },
  {
    id: "step-analytics",
    title: "Analytics & Trend Insights",
    description:
      "Analyze rating trajectories, review acquisition velocity, and period-over-period comparisons across 7, 30, and 90-day timeframes. Export verified review records directly to CSV.",
    targetId: "tour-nav-analytics",
    route: "/dashboard/analytics",
    placement: "right",
    category: "Overview",
    badge: "3 of 11",
  },
  {
    id: "step-audit",
    title: "NexRep Profile Audit",
    description:
      "Evaluate your Google Business Profile with NexRep's proprietary 100-point completeness score. Identify missing hours, categories, or contact info to maximize your local Google Maps ranking.",
    targetId: "tour-nav-audit",
    route: "/dashboard/audit",
    placement: "right",
    category: "Overview",
    badge: "4 of 11",
  },
  {
    id: "step-reviews",
    title: "Reviews & AI Reply Studio",
    description:
      "Manage all customer reviews with context-aware AI drafting across 4 distinct tones. Reply with one-click manual approval or configure automated publishing with critical-review safety gates.",
    targetId: "tour-nav-reviews",
    route: "/dashboard/reviews",
    placement: "right",
    category: "Reputation",
    badge: "5 of 11",
  },
  {
    id: "step-posts",
    title: "Google Posts Studio",
    description:
      "Craft Updates, Special Offers, and Events with call-to-action buttons. Live preview shows exactly how your post will render in Google Search and Google Maps knowledge panels.",
    targetId: "tour-nav-posts",
    route: "/dashboard/posts",
    placement: "right",
    category: "Reputation",
    badge: "6 of 11",
  },
  {
    id: "step-seo",
    title: "Local SEO & Keyword Discovery",
    description:
      "Discover high-intent local search keywords (Commercial, Transactional, Near Me) tailored to your industry, and generate optimized 750-character Google Business descriptions.",
    targetId: "tour-nav-seo",
    route: "/dashboard/seo",
    placement: "right",
    category: "Reputation",
    badge: "7 of 11",
  },
  {
    id: "step-reports",
    title: "Executive Reports & Exports",
    description:
      "Generate clean, print-ready executive performance reports with official Google sync timestamps. Download comprehensive review datasets in CSV format for stakeholder presentations.",
    targetId: "tour-nav-reports",
    route: "/dashboard/reports",
    placement: "right",
    category: "Reporting",
    badge: "8 of 11",
  },
  {
    id: "step-billing",
    title: "Plans & Subscription Billing",
    description:
      "Review your active location quota, plan entitlements, and proposed scaling tiers (Starter, Growth, Pro, Agency) designed to fit single-location shops up to regional multi-unit franchises.",
    targetId: "tour-nav-billing",
    route: "/dashboard/billing",
    placement: "right",
    category: "Reporting",
    badge: "9 of 11",
  },
  {
    id: "step-team",
    title: "Team Collaboration & Roles",
    description:
      "Invite team members, assign secure Owner, Admin, or Member roles with strict multi-tenant isolation, and manage real-time in-app dashboard review notifications.",
    targetId: "tour-nav-team",
    route: "/dashboard/team",
    placement: "right",
    category: "Reporting",
    badge: "10 of 11",
  },
  {
    id: "step-bottom-profile",
    title: "Account & Profile Center",
    description:
      "Manage your personal credentials, inspect Google OAuth connection health, review workspace security rules, and sign out—all conveniently located at the base of your sidebar.",
    targetId: "tour-bottom-profile",
    route: "/dashboard",
    placement: "top",
    category: "Account",
    badge: "11 of 11",
  },
];
