import { NextResponse } from "next/server";
import JSZip from "jszip";
import matter from "gray-matter";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers, workspaceSkills } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth";
import {
  generateSkillAssetKey,
  uploadContent,
} from "@/lib/storage/r2-client";
import type { SkillAsset } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max for skill packages

interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  assets: Array<{
    filename: string;
    content: string | Uint8Array;
    mimeType: string;
  }>;
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    sh: "application/x-sh",
    bash: "application/x-sh",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

async function parseMarkdownFile(content: string): Promise<ParsedSkill> {
  const { data, content: markdownContent } = matter(content);

  if (!data.name || !data.description) {
    throw new Error(
      "Skill file must have 'name' and 'description' in frontmatter"
    );
  }

  return {
    name: data.name,
    description: data.description,
    content: markdownContent.trim(),
    assets: [],
  };
}

async function parseZipFile(buffer: ArrayBuffer): Promise<ParsedSkill> {
  const zip = await JSZip.loadAsync(buffer);

  // Find SKILL.md - could be at root or in a subdirectory
  let skillFile: JSZip.JSZipObject | null = null;
  let basePath = "";

  for (const [path, file] of Object.entries(zip.files)) {
    if (path.endsWith("SKILL.md") && !file.dir) {
      skillFile = file;
      // Get the base path (directory containing SKILL.md)
      basePath = path.replace("SKILL.md", "");
      break;
    }
  }

  if (!skillFile) {
    throw new Error("ZIP must contain a SKILL.md file");
  }

  const skillContent = await skillFile.async("string");
  const { data, content: markdownContent } = matter(skillContent);

  if (!data.name || !data.description) {
    throw new Error(
      "SKILL.md must have 'name' and 'description' in frontmatter"
    );
  }

  // Collect references and merge into content
  let fullContent = markdownContent.trim();
  const references: string[] = [];
  const referenceFiles: Array<{ path: string; content: string }> = [];

  // Look for references directory
  for (const [path, file] of Object.entries(zip.files)) {
    if (
      path.startsWith(basePath + "references/") &&
      !file.dir &&
      path.endsWith(".md")
    ) {
      const refContent = await file.async("string");
      const refName = path.replace(basePath + "references/", "");
      references.push(`\n\n---\n\n## Reference: ${refName}\n\n${refContent}`);
      referenceFiles.push({ path: path.replace(basePath, ""), content: refContent });
    }
  }

  if (references.length > 0) {
    fullContent += "\n\n# Reference Materials\n" + references.join("");
  }

  // Collect scripts, assets, and references for R2 upload
  const assets: ParsedSkill["assets"] = [];

  // Add reference files as downloadable assets
  for (const ref of referenceFiles) {
    assets.push({
      filename: ref.path,
      content: ref.content,
      mimeType: "text/markdown",
    });
  }

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (path === skillFile.name) continue; // Skip SKILL.md
    if (path.startsWith(basePath + "references/")) continue; // Already added above

    // Include scripts and assets
    if (
      path.startsWith(basePath + "scripts/") ||
      path.startsWith(basePath + "assets/")
    ) {
      const relativePath = path.replace(basePath, "");
      const mimeType = getMimeType(path);

      // For text files, get as string; for binary, get as uint8array
      const isTextFile = [
        "text/",
        "application/json",
        "application/x-sh",
        "text/yaml",
      ].some((t) => mimeType.startsWith(t));

      const content = isTextFile
        ? await file.async("string")
        : await file.async("uint8array");

      assets.push({
        filename: relativePath,
        content,
        mimeType,
      });
    }
  }

  return {
    name: data.name,
    description: data.description,
    content: fullContent,
    assets,
  };
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const workspaceId = formData.get("workspaceId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace ID required" },
        { status: 400 }
      );
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 50MB limit" },
        { status: 400 }
      );
    }

    // Verify workspace exists and user has admin access
    const workspace = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId)
        )
      )
      .get();

    if (!member || member.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Parse the file based on type
    const filename = file.name.toLowerCase();
    let parsed: ParsedSkill;

    if (filename.endsWith(".md")) {
      const text = await file.text();
      parsed = await parseMarkdownFile(text);
    } else if (filename.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      parsed = await parseZipFile(buffer);
    } else {
      return NextResponse.json(
        { error: "File must be .md or .zip" },
        { status: 400 }
      );
    }

    // Generate skill ID
    const skillId = crypto.randomUUID();
    const now = new Date();

    // Upload assets to R2
    const uploadedAssets: SkillAsset[] = [];

    for (const asset of parsed.assets) {
      const storageKey = generateSkillAssetKey(
        workspaceId,
        skillId,
        asset.filename
      );

      // Convert content to string for upload
      const contentToUpload =
        typeof asset.content === "string"
          ? asset.content
          : Buffer.from(asset.content).toString("base64");

      await uploadContent(storageKey, contentToUpload, asset.mimeType);

      uploadedAssets.push({
        filename: asset.filename,
        storageKey,
        mimeType: asset.mimeType,
      });
    }

    // Save skill to database
    const [skill] = await db
      .insert(workspaceSkills)
      .values({
        id: skillId,
        workspaceId,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        assets: uploadedAssets.length > 0 ? JSON.stringify(uploadedAssets) : null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        assetCount: uploadedAssets.length,
      },
    });
  } catch (error) {
    console.error("Skill import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import skill",
      },
      { status: 500 }
    );
  }
}
