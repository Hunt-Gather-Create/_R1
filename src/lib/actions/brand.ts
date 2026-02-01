"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { brands, workspaces } from "../db/schema";
import { eq, and } from "drizzle-orm";
import type { Brand, CreateBrandInput, UpdateBrandInput, BrandGuidelines } from "../types";
import { getCurrentUserId } from "../auth";
import { requireWorkspaceAccess } from "./workspace";
import { processLogo, isR2Configured } from "../storage/logo-processor";
import { generateDownloadUrl, deleteObject } from "../storage/r2-client";
import { inngest } from "../inngest/client";

/**
 * Get all brands for the current user
 */
export async function getUserBrands(): Promise<Brand[]> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const userBrands = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, userId));

  return userBrands;
}

/**
 * Get a brand by ID
 */
export async function getBrandById(brandId: string): Promise<Brand | null> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const brand = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
    .get();

  return brand ?? null;
}

/**
 * Create a new brand for the current user
 */
export async function createBrand(input: CreateBrandInput): Promise<Brand> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Generate a brand ID first (needed for logo storage key)
  const brandId = crypto.randomUUID();

  // Process logo if URL provided and R2 is configured
  let logoStorageKey: string | null = null;
  let logoBackground: string | null = null;

  if (input.logoUrl && isR2Configured()) {
    const processed = await processLogo(input.logoUrl, userId, brandId);
    if (processed) {
      logoStorageKey = processed.storageKey;
      logoBackground = processed.background;
    }
  }

  const now = new Date();
  const newBrand = {
    id: brandId,
    userId,
    name: input.name,
    tagline: input.tagline ?? null,
    description: input.description ?? null,
    logoUrl: input.logoUrl ?? null,
    logoStorageKey,
    logoBackground,
    websiteUrl: input.websiteUrl ?? null,
    primaryColor: input.primaryColor ?? null,
    secondaryColor: input.secondaryColor ?? null,
    industry: input.industry ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.insert(brands).values(newBrand).returning();
  return result[0];
}

/**
 * Update an existing brand
 */
export async function updateBrand(
  brandId: string,
  input: UpdateBrandInput
): Promise<Brand> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Verify ownership
  const existing = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
    .get();

  if (!existing) {
    throw new Error("Brand not found or access denied");
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.tagline !== undefined) updateData.tagline = input.tagline;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.websiteUrl !== undefined) updateData.websiteUrl = input.websiteUrl;
  if (input.primaryColor !== undefined) updateData.primaryColor = input.primaryColor;
  if (input.secondaryColor !== undefined) updateData.secondaryColor = input.secondaryColor;
  if (input.industry !== undefined) updateData.industry = input.industry;

  // Handle logo URL changes - reprocess if URL changed
  if (input.logoUrl !== undefined && input.logoUrl !== existing.logoUrl) {
    updateData.logoUrl = input.logoUrl;

    if (input.logoUrl && isR2Configured()) {
      // Delete old logo from R2 if exists
      if (existing.logoStorageKey) {
        try {
          await deleteObject(existing.logoStorageKey);
        } catch (error) {
          console.error("Failed to delete old logo:", error);
        }
      }

      // Process new logo
      const processed = await processLogo(input.logoUrl, userId, brandId);
      if (processed) {
        updateData.logoStorageKey = processed.storageKey;
        updateData.logoBackground = processed.background;
      } else {
        // Clear storage fields if processing failed
        updateData.logoStorageKey = null;
        updateData.logoBackground = null;
      }
    } else if (!input.logoUrl) {
      // Logo URL cleared - clean up storage
      if (existing.logoStorageKey) {
        try {
          await deleteObject(existing.logoStorageKey);
        } catch (error) {
          console.error("Failed to delete logo:", error);
        }
      }
      updateData.logoStorageKey = null;
      updateData.logoBackground = null;
    }
  }

  const result = await db
    .update(brands)
    .set(updateData)
    .where(eq(brands.id, brandId))
    .returning();

  revalidatePath("/w");

  return result[0];
}

/**
 * Delete a brand (will unlink from workspaces via ON DELETE SET NULL)
 */
export async function deleteBrand(brandId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Verify ownership
  const existing = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
    .get();

  if (!existing) {
    throw new Error("Brand not found or access denied");
  }

  // Delete logo from R2 if exists
  if (existing.logoStorageKey) {
    try {
      await deleteObject(existing.logoStorageKey);
    } catch (error) {
      console.error("Failed to delete brand logo from R2:", error);
      // Continue with deletion even if R2 cleanup fails
    }
  }

  await db.delete(brands).where(eq(brands.id, brandId));

  revalidatePath("/w");
}

/**
 * Brand with resolved logo URL (from R2 or original)
 */
export type BrandWithLogoUrl = Brand & {
  resolvedLogoUrl: string | null;
};

/**
 * Get a signed URL for a brand's stored logo
 */
async function getLogoUrl(brand: Brand): Promise<string | null> {
  // Prefer R2-stored logo if available
  if (brand.logoStorageKey) {
    try {
      return await generateDownloadUrl(brand.logoStorageKey, 3600); // 1 hour expiry
    } catch (error) {
      console.error("Failed to generate logo URL:", error);
      // Fall back to original URL
    }
  }

  // Fall back to original URL
  return brand.logoUrl;
}

/**
 * Get the brand linked to a workspace with resolved logo URL
 */
export async function getWorkspaceBrand(
  workspaceId: string
): Promise<BrandWithLogoUrl | null> {
  await requireWorkspaceAccess(workspaceId);

  const workspace = await db
    .select({ brandId: workspaces.brandId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace?.brandId) {
    return null;
  }

  const brand = await db
    .select()
    .from(brands)
    .where(eq(brands.id, workspace.brandId))
    .get();

  if (!brand) {
    return null;
  }

  const resolvedLogoUrl = await getLogoUrl(brand);

  return {
    ...brand,
    resolvedLogoUrl,
  };
}

/**
 * Link a brand to a workspace
 */
export async function setWorkspaceBrand(
  workspaceId: string,
  brandId: string
): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Verify brand ownership
  const brand = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
    .get();

  if (!brand) {
    throw new Error("Brand not found or access denied");
  }

  await db
    .update(workspaces)
    .set({
      brandId,
      primaryColor: brand.primaryColor,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  // Trigger brand guidelines research if not already done/in-progress
  if (!brand.guidelines && brand.guidelinesStatus !== "processing") {
    await inngest.send({
      name: "brand/guidelines.research",
      data: {
        brandId: brand.id,
        brandName: brand.name,
        websiteUrl: brand.websiteUrl ?? undefined,
        workspaceId,
        metadata: { description: `Researching brand guidelines for ${brand.name}` },
      },
    });
  }

  revalidatePath("/w");
}

/**
 * Unlink a brand from a workspace
 */
export async function unlinkWorkspaceBrand(workspaceId: string): Promise<void> {
  await requireWorkspaceAccess(workspaceId, "admin");

  await db
    .update(workspaces)
    .set({
      brandId: null,
      primaryColor: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  revalidatePath("/w");
}

/**
 * Update brand guidelines
 */
export async function updateBrandGuidelines(
  brandId: string,
  guidelines: BrandGuidelines
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Verify ownership
  const existing = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
    .get();

  if (!existing) {
    throw new Error("Brand not found or access denied");
  }

  // Update lastUpdated timestamp in guidelines
  const updatedGuidelines: BrandGuidelines = {
    ...guidelines,
    lastUpdated: new Date().toISOString(),
  };

  await db
    .update(brands)
    .set({
      guidelines: JSON.stringify(updatedGuidelines),
      guidelinesUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(brands.id, brandId));

  revalidatePath("/w");
}
