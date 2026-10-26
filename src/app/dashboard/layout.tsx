import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { LocationProvider } from "@/contexts/location-context";
import { TourProvider } from "@/contexts/tour-context";
import { WorkspaceOnboardingModal } from "@/components/workspace/workspace-onboarding-modal";
import { MigrationPendingBanner } from "@/components/workspace/migration-pending-banner";
import { WelcomeModal } from "@/components/onboarding/welcome-modal";
import { TourPopover } from "@/components/onboarding/tour-popover";
import { HelpCenterModal } from "@/components/onboarding/help-center-modal";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <LocationProvider>
        <TourProvider>
          <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-12 px-4 sm:px-6 lg:px-8 flex flex-col">
                <MigrationPendingBanner />
                {children}
              </main>
            </div>
          </div>
          <WorkspaceOnboardingModal />
          <WelcomeModal />
          <TourPopover />
          <HelpCenterModal />
        </TourProvider>
      </LocationProvider>
    </WorkspaceProvider>
  );
}

