"use server";

import { db } from "../db";
import { webhooks } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireWorkspaceAccess } from "./workspace";
import type { Webhook, CreateWebhookInput, UpdateWebhookInput } from "../types";

/**
 * Generate a URL-safe slug from a name, with uniqueness check.
 */
async function generateWebhookSlug(
  workspaceId: string,
  name: string,
  excludeId?: string
): Promise<string> {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  if (!base) base = "webhook";

  let slug = base;
  let suffix = 0;

  for (;;) {
    const existing = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.slug, slug)))
      .get();

    if (!existing || (excludeId && existing.id === excludeId)) break;

    suffix++;
    slug = `${base}-${suffix}`;
  }

  return slug;
}

/**
 * Create a new webhook configuration.
 */
export async function createWebhook(
  workspaceId: string,
  input: CreateWebhookInput
): Promise<Webhook> {
  const { user } = await requireWorkspaceAccess(workspaceId, "admin");

  const slug = input.slug
    ? input.slug
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "")
    : await generateWebhookSlug(workspaceId, input.name);

  // Verify slug is unique within workspace
  const existing = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.slug, slug)))
    .get();

  if (existing) {
    throw new Error(`A webhook with slug "${slug}" already exists in this workspace`);
  }

  const now = new Date();
  const webhook: Webhook = {
    id: crypto.randomUUID(),
    workspaceId,
    name: input.name,
    slug,
    prompt: input.prompt,
    defaultStatus: input.defaultStatus ?? null,
    defaultPriority: input.defaultPriority ?? null,
    defaultLabelIds: input.defaultLabelIds
      ? JSON.stringify(input.defaultLabelIds)
      : null,
    isActive: true,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(webhooks).values(webhook);

  return webhook;
}

/**
 * List all webhooks for a workspace.
 */
export async function listWebhooks(workspaceId: string): Promise<Webhook[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(webhooks.createdAt);
}

/**
 * Update a webhook configuration.
 */
export async function updateWebhook(
  workspaceId: string,
  webhookId: string,
  input: UpdateWebhookInput
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  const updates: Partial<Webhook> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.prompt !== undefined) updates.prompt = input.prompt;
  if (input.defaultStatus !== undefined) updates.defaultStatus = input.defaultStatus;
  if (input.defaultPriority !== undefined) updates.defaultPriority = input.defaultPriority;
  if (input.defaultLabelIds !== undefined) {
    updates.defaultLabelIds = input.defaultLabelIds
      ? JSON.stringify(input.defaultLabelIds)
      : null;
  }
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await db
    .update(webhooks)
    .set(updates)
    .where(
      and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId))
    );
}

/**
 * Delete a webhook.
 */
export async function deleteWebhook(
  workspaceId: string,
  webhookId: string
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .delete(webhooks)
    .where(
      and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId))
    );
}
