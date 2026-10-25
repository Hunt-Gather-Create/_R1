"use server";

/**
 * Approve and Dismiss for the review queue page. Both only mark the queue
 * row; an approved change reaches prod later through the data-integrity
 * pipeline, per D-10.
 */

import { revalidatePath } from "next/cache";
import { getRunwayDb } from "@/lib/db/runway";
import { requireRunwayGate } from "@/lib/runway/require-gate";
import { resolveReviewQueueRow, type ReviewQueueStatus } from "@/lib/runway/review-queue";

export type ReviewQueueActionState = { ok: boolean; message: string } | null;

// The password gate has no per-person login, so there is no signed-in name.
const RESOLVED_BY = "operator";

async function resolve(formData: FormData, status: ReviewQueueStatus): Promise<ReviewQueueActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id === "") {
    return { ok: false, message: "No queue row was named." };
  }

  const res = await resolveReviewQueueRow(getRunwayDb(), { id, status, resolvedBy: RESOLVED_BY });
  revalidatePath("/runway/review-queue");
  if (res.ok) {
    return { ok: true, message: status === "approved" ? "Approved. The change is waiting for the data pipeline." : "Dismissed." };
  }
  return {
    ok: false,
    message: res.reason === "already-resolved" ? "This row is already resolved." : "That queue row was not found.",
  };
}

export async function approveReviewQueueRowAction(
  _prev: ReviewQueueActionState,
  formData: FormData,
): Promise<ReviewQueueActionState> {
  await requireRunwayGate();
  return resolve(formData, "approved");
}

export async function dismissReviewQueueRowAction(
  _prev: ReviewQueueActionState,
  formData: FormData,
): Promise<ReviewQueueActionState> {
  await requireRunwayGate();
  return resolve(formData, "dismissed");
}
