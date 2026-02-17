import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/actions/dashboard";
import { DashboardContent } from "./_components/DashboardContent";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const data = await getDashboardData("day");

  return <DashboardContent initialData={data} />;
}
