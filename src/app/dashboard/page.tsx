import { requireActiveUser } from "@/lib/actions/workspace";
import { getDashboardData } from "@/lib/actions/dashboard";
import { DashboardContent } from "./_components/DashboardContent";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireActiveUser();
  const data = await getDashboardData("day");

  return <DashboardContent initialData={data} />;
}
