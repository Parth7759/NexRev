import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { LocationProvider } from "@/contexts/location-context";
import { WorkspaceOnboardingModal } from "@/components/workspace/workspace-onboarding-modal";
import { MigrationPendingBanner } from "@/components/workspace/migration-pending-banner";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <LocationProvider>
        <div className="flex h-screen overflow-hidden bg-slate-50">
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
      </LocationProvider>
    </WorkspaceProvider>
  );
}
