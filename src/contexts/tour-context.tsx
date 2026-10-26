"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspace } from "@/contexts/workspace-context";
import { getCurrentUserProfileAction } from "@/app/dashboard/actions";
import { TourStep, TOUR_STEPS } from "@/types/tour";

export type HelpTab = "tour" | "setup" | "features" | "faq" | "support";

interface TourContextType {
  isTourActive: boolean;
  currentStepIndex: number;
  currentStep: TourStep | null;
  totalSteps: number;
  isWelcomeOpen: boolean;
  isHelpOpen: boolean;
  helpTab: HelpTab;
  isCompleted: boolean;
  userId: string | null;
  startTour: (fromStep?: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  finishTour: () => void;
  restartTour: () => void;
  openHelpModal: (tab?: HelpTab) => void;
  closeHelpModal: () => void;
  closeWelcomeModal: (dontShowAgain?: boolean) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { activeWorkspaceId } = useWorkspace();

  const [userId, setUserId] = useState<string | null>(null);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<HelpTab>("tour");
  const [isCompleted, setIsCompleted] = useState(false);

  // Derive storage keys scoped to user and workspace
  const completedKey = useMemo(
    () =>
      userId && activeWorkspaceId
        ? `nexrep_tour_completed_${userId}_${activeWorkspaceId}`
        : null,
    [userId, activeWorkspaceId]
  );

  const dismissedKey = useMemo(
    () =>
      userId && activeWorkspaceId
        ? `nexrep_tour_dismissed_${userId}_${activeWorkspaceId}`
        : null,
    [userId, activeWorkspaceId]
  );

  // 1. Fetch current authenticated user ID
  useEffect(() => {
    let isMounted = true;
    getCurrentUserProfileAction(activeWorkspaceId).then((res) => {
      if (isMounted && res.success && res.user?.id) {
        setUserId(res.user.id);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [activeWorkspaceId]);

  // 2. Check first-login status asynchronously and evaluate whether to show the welcome modal
  useEffect(() => {
    if (!userId || !activeWorkspaceId || !completedKey || !dismissedKey) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const hasCompleted = localStorage.getItem(completedKey) === "true";
        const hasDismissed = localStorage.getItem(dismissedKey) === "true";

        setIsCompleted(hasCompleted);

        // Only prompt welcome modal on first login if neither completed nor dismissed
        if (!hasCompleted && !hasDismissed) {
          setIsWelcomeOpen(true);
        }
      } catch {
        // Ignore localStorage access restrictions in sandboxed iframes
      }
    }, 750);

    return () => clearTimeout(timer);
  }, [userId, activeWorkspaceId, completedKey, dismissedKey]);

  // Handle cross-route navigation when advancing steps in an active tour
  useEffect(() => {
    if (!isTourActive) return;

    const step = TOUR_STEPS[currentStepIndex];
    if (step?.route && pathname !== step.route) {
      router.push(step.route);
    }
  }, [isTourActive, currentStepIndex, pathname, router]);

  const finishTour = useCallback(() => {
    setIsTourActive(false);
    setIsCompleted(true);
    if (completedKey) {
      try {
        localStorage.setItem(completedKey, "true");
      } catch {
        // ignore localStorage error
      }
    }
  }, [completedKey]);

  const startTour = useCallback(
    (fromStep: number = 0) => {
      setIsWelcomeOpen(false);
      setCurrentStepIndex(fromStep);
      setIsTourActive(true);

      // Mark as dismissed so the welcome modal won't re-trigger on refresh
      if (dismissedKey) {
        try {
          localStorage.setItem(dismissedKey, "true");
        } catch {
          // ignore localStorage error
        }
      }
    },
    [dismissedKey]
  );

  const nextStep = useCallback(() => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      // Reached final step
      finishTour();
    }
  }, [currentStepIndex, finishTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const skipTour = useCallback(() => {
    setIsTourActive(false);
    if (dismissedKey) {
      try {
        localStorage.setItem(dismissedKey, "true");
      } catch {
        // ignore localStorage error
      }
    }
  }, [dismissedKey]);

  const restartTour = useCallback(() => {
    if (completedKey) {
      try {
        localStorage.removeItem(completedKey);
      } catch {
        // ignore localStorage error
      }
    }
    if (dismissedKey) {
      try {
        localStorage.removeItem(dismissedKey);
      } catch {
        // ignore localStorage error
      }
    }
    setIsCompleted(false);
    setIsHelpOpen(false);
    setIsWelcomeOpen(false);
    setCurrentStepIndex(0);
    setIsTourActive(true);

    if (pathname !== "/dashboard") {
      router.push("/dashboard");
    }
  }, [completedKey, dismissedKey, pathname, router]);

  const openHelpModal = useCallback((tab: HelpTab = "tour") => {
    setHelpTab(tab);
    setIsHelpOpen(true);
  }, []);

  const closeHelpModal = useCallback(() => {
    setIsHelpOpen(false);
  }, []);

  const closeWelcomeModal = useCallback(
    (dontShowAgain: boolean = true) => {
      setIsWelcomeOpen(false);
      if (dontShowAgain && dismissedKey) {
        try {
          localStorage.setItem(dismissedKey, "true");
        } catch {
          // ignore localStorage error
        }
      }
    },
    [dismissedKey]
  );

  const currentStep = useMemo(() => {
    if (!isTourActive) return null;
    return TOUR_STEPS[currentStepIndex] || null;
  }, [isTourActive, currentStepIndex]);

  const value = useMemo(
    () => ({
      isTourActive,
      currentStepIndex,
      currentStep,
      totalSteps: TOUR_STEPS.length,
      isWelcomeOpen,
      isHelpOpen,
      helpTab,
      isCompleted,
      userId,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      finishTour,
      restartTour,
      openHelpModal,
      closeHelpModal,
      closeWelcomeModal,
    }),
    [
      isTourActive,
      currentStepIndex,
      currentStep,
      isWelcomeOpen,
      isHelpOpen,
      helpTab,
      isCompleted,
      userId,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      finishTour,
      restartTour,
      openHelpModal,
      closeHelpModal,
      closeWelcomeModal,
    ]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}
