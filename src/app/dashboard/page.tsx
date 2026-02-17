import { getDashboardData } from "@/lib/actions/dashboard";
import { DashboardContent } from "./_components/DashboardContent";

export default async function DashboardPage() {
  // getDashboardData calls requireAuth() internally, which redirects to /login if unauthenticated
  const data = await getDashboardData("day");

  return <DashboardContent initialData={data} />;
}
