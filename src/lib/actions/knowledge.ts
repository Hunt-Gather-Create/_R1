"use server";

import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import {
  knowledgeAssets,
  knowledgeDocumentLinks,
  knowledgeDocuments,
  knowledgeDocumentTags,
  knowledgeFolders,
  issueKnowledgeDocuments,
} from "../db/schema";
import type {
  KnowledgeAsset,
  KnowledgeDocument,
  KnowledgeDocumentWithContent,
  KnowledgeFolder,
} from "../types";
import {
  deleteObject,
  generateDownloadUrl,
  generateUploadUrl,
  generateKnowledgeDocumentStorageKey,
  generateKnowledgeImageStorageKey,
  getContent,
  uploadContent,
} from "../storage/r2-client";
import { getWorkspaceSlug, getWorkspaceIdFromIssue } from "./helpers";
import { requireWorkspaceAccess } from "./workspace";

const ROOT_FOLDER_NAME = "Knowledge Base";

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const regex = /(^|\s)#([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    tags.add(match[2].toLowerCase());
  }
  return [...tags];
}

function extractWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^[\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    links.add(match[1].trim());
  }
  return [...links];
}

async function getWorkspaceIdFromDocument(documentId: string): Promise<string | null> {
  const doc = await db
    .select({ workspaceId: knowledgeDocuments.workspaceId })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  return doc?.workspaceId ?? null;
}

async function getFolderPath(folderId: string | null): Promise<string | null> {
  if (!folderId) return null;

  const folder = await db
    .select({ path: knowledgeFolders.path })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, folderId))
    .get();

  return folder?.path ?? null;
}

function collectFolderIdsForDelete(
  folders: Array<{ id: string; parentFolderId: string | null }>,
  rootFolderId: string
): string[] {
  const folderIds = new Set<string>([rootFolderId]);
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const folder of folders) {
      if (folder.parentFolderId !== current || folderIds.has(folder.id)) continue;
      folderIds.add(folder.id);
      queue.push(folder.id);
    }
  }

  return [...folderIds];
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  const oldWithSlash = `${oldPrefix}/`;
  if (!path.startsWith(oldWithSlash)) return path;
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

async function deleteStorageKeys(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;

  const uniqueStorageKeys = [...new Set(storageKeys)];
  const results = await Promise.allSettled(
    uniqueStorageKeys.map((storageKey) => deleteObject(storageKey))
  );

  const failedCount = results.filter((result) => result.status === "rejected").length;
  if (failedCount > 0) {
    console.error(`Failed to delete ${failedCount} knowledge objects from R2`);
  }
}

async function syncDocumentTagsAndLinks(
  workspaceId: string,
  documentId: string,
  content: string
): Promise<void> {
  const tags = extractTags(content);
  const wikiLinks = extractWikiLinks(content);

  await db
    .delete(knowledgeDocumentTags)
    .where(eq(knowledgeDocumentTags.documentId, documentId));

  if (tags.length > 0) {
    await db.insert(knowledgeDocumentTags).values(
      tags.map((tag) => ({
        documentId,
        tag,
      }))
    );
  }

  await db
    .delete(knowledgeDocumentLinks)
    .where(eq(knowledgeDocumentLinks.sourceDocumentId, documentId));

  if (wikiLinks.length === 0) {
    return;
  }

  const targets: Array<{ id: string; title: string }> = [];
  for (const title of wikiLinks) {
    const target = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.workspaceId, workspaceId),
          sql`lower(${knowledgeDocuments.title}) = ${title.toLowerCase()}`
        )
      )
      .get();

    if (target && target.id !== documentId) {
      targets.push(target);
    }
  }

  const deduped = new Map<string, string>();
  for (const target of targets) {
    deduped.set(target.id, target.title);
  }

  if (deduped.size > 0) {
    await db.insert(knowledgeDocumentLinks).values(
      [...deduped.keys()].map((targetDocumentId) => ({
        sourceDocumentId: documentId,
        targetDocumentId,
        linkType: "wiki",
        createdAt: new Date(),
      }))
    );
  }
}

export async function ensureKnowledgeRootFolder(
  workspaceId: string
): Promise<KnowledgeFolder> {
  const { user } = await requireWorkspaceAccess(workspaceId, "member");

  const existingRoots = await db
    .select()
    .from(knowledgeFolders)
    .where(
      and(
        eq(knowledgeFolders.workspaceId, workspaceId),
        isNull(knowledgeFolders.parentFolderId),
        eq(knowledgeFolders.name, ROOT_FOLDER_NAME)
      )
    )
    .orderBy(knowledgeFolders.createdAt);

  if (existingRoots.length > 0) {
    const primaryRoot = existingRoots[0];

    // Repair legacy duplication bug by merging extra root folders.
    if (existingRoots.length > 1) {
      const duplicateIds = existingRoots.slice(1).map((folder) => folder.id);

      await db
        .update(knowledgeFolders)
        .set({ parentFolderId: primaryRoot.id, updatedAt: new Date() })
        .where(inArray(knowledgeFolders.parentFolderId, duplicateIds));

      await db
        .update(knowledgeDocuments)
        .set({ folderId: primaryRoot.id, updatedAt: new Date() })
        .where(inArray(knowledgeDocuments.folderId, duplicateIds));

      await db
        .delete(knowledgeFolders)
        .where(inArray(knowledgeFolders.id, duplicateIds));
    }

    return primaryRoot;
  }

  const now = new Date();
  const root: KnowledgeFolder = {
    id: crypto.randomUUID(),
    workspaceId,
    parentFolderId: null,
    name: ROOT_FOLDER_NAME,
    path: "knowledge-base",
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(knowledgeFolders).values(root);
  return root;
}

export async function getKnowledgeFolders(workspaceId: string): Promise<KnowledgeFolder[]> {
  await requireWorkspaceAccess(workspaceId, "member");
  await ensureKnowledgeRootFolder(workspaceId);

  return db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.workspaceId, workspaceId))
    .orderBy(knowledgeFolders.path);
}

export async function createKnowledgeFolder(input: {
  workspaceId: string;
  name: string;
  parentFolderId?: string | null;
}): Promise<KnowledgeFolder> {
  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");
  await ensureKnowledgeRootFolder(input.workspaceId);

  const name = input.name.trim();
  if (!name) {
    throw new Error("Folder name is required");
  }

  let parentPath: string | null = null;
  if (input.parentFolderId) {
    const parent = await db
      .select()
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.id, input.parentFolderId),
          eq(knowledgeFolders.workspaceId, input.workspaceId)
        )
      )
      .get();

    if (!parent) {
      throw new Error("Parent folder not found");
    }
    parentPath = parent.path;
  }

  const now = new Date();
  const folderPath = parentPath ? `${parentPath}/${slugify(name)}` : slugify(name);

  const folder: KnowledgeFolder = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    parentFolderId: input.parentFolderId ?? null,
    name,
    path: folderPath,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(knowledgeFolders).values(folder);

  const slug = await getWorkspaceSlug(input.workspaceId);
  revalidatePath(slug ? `/w/${slug}/knowledge` : "/");

  return folder;
}

export async function getKnowledgeDocuments(input: {
  workspaceId: string;
  folderId?: string | null;
  tag?: string | null;
  query?: string | null;
}): Promise<Array<KnowledgeDocument & { tags: string[] }>> {
  await requireWorkspaceAccess(input.workspaceId, "member");
  await ensureKnowledgeRootFolder(input.workspaceId);

  const conditions = [eq(knowledgeDocuments.workspaceId, input.workspaceId)];
  if (input.folderId) {
    conditions.push(eq(knowledgeDocuments.folderId, input.folderId));
  }
  if (input.query?.trim()) {
    conditions.push(like(knowledgeDocuments.title, `%${input.query.trim()}%`));
  }

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(and(...conditions))
    .orderBy(desc(knowledgeDocuments.updatedAt));

  if (docs.length === 0) return [];

  const tags = await db
    .select()
    .from(knowledgeDocumentTags)
    .where(inArray(knowledgeDocumentTags.documentId, docs.map((doc) => doc.id)));

  const tagMap = new Map<string, string[]>();
  for (const tag of tags) {
    const existing = tagMap.get(tag.documentId) ?? [];
    existing.push(tag.tag);
    tagMap.set(tag.documentId, existing);
  }

  let mapped = docs.map((doc) => ({
    ...doc,
    tags: tagMap.get(doc.id) ?? [],
  }));

  if (input.tag?.trim()) {
    const normalizedTag = input.tag.trim().toLowerCase();
    mapped = mapped.filter((doc) => doc.tags.includes(normalizedTag));
  }

  return mapped;
}

export async function getKnowledgeDocument(
  documentId: string
): Promise<KnowledgeDocumentWithContent | null> {
  const workspaceId = await getWorkspaceIdFromDocument(documentId);
  if (!workspaceId) return null;
  await requireWorkspaceAccess(workspaceId, "member");

  const doc = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  if (!doc) return null;

  const [content, tags, backlinkRows] = await Promise.all([
    getContent(doc.storageKey),
    db
      .select()
      .from(knowledgeDocumentTags)
      .where(eq(knowledgeDocumentTags.documentId, documentId)),
    db
      .select({
        id: knowledgeDocuments.id,
        workspaceId: knowledgeDocuments.workspaceId,
        folderId: knowledgeDocuments.folderId,
        title: knowledgeDocuments.title,
        slug: knowledgeDocuments.slug,
        storageKey: knowledgeDocuments.storageKey,
        contentHash: knowledgeDocuments.contentHash,
        summary: knowledgeDocuments.summary,
        createdBy: knowledgeDocuments.createdBy,
        updatedBy: knowledgeDocuments.updatedBy,
        createdAt: knowledgeDocuments.createdAt,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeDocumentLinks)
      .innerJoin(
        knowledgeDocuments,
        eq(knowledgeDocuments.id, knowledgeDocumentLinks.sourceDocumentId)
      )
      .where(eq(knowledgeDocumentLinks.targetDocumentId, documentId)),
  ]);

  return {
    ...doc,
    content: content ?? "",
    tags: tags.map((t) => t.tag),
    backlinks: backlinkRows,
  };
}

export async function createKnowledgeDocument(input: {
  workspaceId: string;
  title: string;
  content: string;
  folderId?: string | null;
}): Promise<KnowledgeDocument> {
  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");
  await ensureKnowledgeRootFolder(input.workspaceId);

  const title = input.title.trim();
  if (!title) throw new Error("Document title is required");

  const now = new Date();
  const id = crypto.randomUUID();
  const slug = slugify(title);
  const folderPath = await getFolderPath(input.folderId ?? null);
  const storageKey = generateKnowledgeDocumentStorageKey(
    input.workspaceId,
    folderPath,
    slug,
    id
  );
  const tags = extractTags(input.content);

  await uploadContent(storageKey, input.content, "text/markdown; charset=utf-8", {
    workspace_id: input.workspaceId,
    title,
    tags: tags.join(","),
    folder_path: folderPath ?? "",
  });

  const doc: KnowledgeDocument = {
    id,
    workspaceId: input.workspaceId,
    folderId: input.folderId ?? null,
    title,
    slug,
    storageKey,
    contentHash: null,
    summary: null,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(knowledgeDocuments).values(doc);
  await syncDocumentTagsAndLinks(input.workspaceId, id, input.content);

  const workspaceSlug = await getWorkspaceSlug(input.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return doc;
}

export async function updateKnowledgeDocument(input: {
  documentId: string;
  title: string;
  content: string;
  folderId?: string | null;
}): Promise<KnowledgeDocument> {
  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, input.documentId))
    .get();

  if (!existing) throw new Error("Document not found");
  const { user } = await requireWorkspaceAccess(existing.workspaceId, "member");

  const title = input.title.trim();
  if (!title) throw new Error("Document title is required");

  const slug = slugify(title);
  const folderId = input.folderId ?? existing.folderId;
  const folderPath = await getFolderPath(folderId);
  const nextStorageKey = generateKnowledgeDocumentStorageKey(
    existing.workspaceId,
    folderPath,
    slug,
    existing.id
  );
  const tags = extractTags(input.content);

  await uploadContent(nextStorageKey, input.content, "text/markdown; charset=utf-8", {
    workspace_id: existing.workspaceId,
    title,
    tags: tags.join(","),
    folder_path: folderPath ?? "",
  });

  if (nextStorageKey !== existing.storageKey) {
    try {
      await deleteObject(existing.storageKey);
    } catch (error) {
      console.error("Failed to delete old knowledge document from R2:", error);
    }
  }

  const now = new Date();
  await db
    .update(knowledgeDocuments)
    .set({
      title,
      slug,
      folderId,
      storageKey: nextStorageKey,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, existing.id));

  await syncDocumentTagsAndLinks(existing.workspaceId, existing.id, input.content);

  const updated = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, existing.id))
    .get();

  if (!updated) throw new Error("Document not found");

  const workspaceSlug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return updated;
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  if (!existing) return;

  await requireWorkspaceAccess(existing.workspaceId, "member");

  const assetRows = await db
    .select({ storageKey: knowledgeAssets.storageKey })
    .from(knowledgeAssets)
    .where(eq(knowledgeAssets.documentId, documentId));

  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));

  await deleteStorageKeys([existing.storageKey, ...assetRows.map((asset) => asset.storageKey)]);

  const workspaceSlug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");
}

export async function deleteKnowledgeFolder(folderId: string): Promise<void> {
  const folder = await db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, folderId))
    .get();

  if (!folder) return;

  await requireWorkspaceAccess(folder.workspaceId, "member");

  if (folder.parentFolderId === null) {
    throw new Error("Root folder cannot be deleted");
  }

  const workspaceFolders = await db
    .select({ id: knowledgeFolders.id, parentFolderId: knowledgeFolders.parentFolderId })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.workspaceId, folder.workspaceId));

  const folderIdsToDelete = collectFolderIdsForDelete(workspaceFolders, folder.id);
  const docs = await db
    .select({ id: knowledgeDocuments.id, storageKey: knowledgeDocuments.storageKey })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, folder.workspaceId),
        inArray(knowledgeDocuments.folderId, folderIdsToDelete)
      )
    );

  const documentIds = docs.map((doc) => doc.id);
  let assetRows: Array<{ storageKey: string }> = [];
  if (documentIds.length > 0) {
    assetRows = await db
      .select({ storageKey: knowledgeAssets.storageKey })
      .from(knowledgeAssets)
      .where(
        and(
          eq(knowledgeAssets.workspaceId, folder.workspaceId),
          inArray(knowledgeAssets.documentId, documentIds)
        )
      );

    await db.delete(knowledgeDocuments).where(inArray(knowledgeDocuments.id, documentIds));
  }

  await db.delete(knowledgeFolders).where(inArray(knowledgeFolders.id, folderIdsToDelete));

  await deleteStorageKeys([
    ...docs.map((doc) => doc.storageKey),
    ...assetRows.map((asset) => asset.storageKey),
  ]);

  const workspaceSlug = await getWorkspaceSlug(folder.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");
}

export async function moveKnowledgeDocument(input: {
  documentId: string;
  targetFolderId: string | null;
}): Promise<KnowledgeDocument> {
  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, input.documentId))
    .get();

  if (!existing) {
    throw new Error("Document not found");
  }

  const { user } = await requireWorkspaceAccess(existing.workspaceId, "member");
  const rootFolder = await ensureKnowledgeRootFolder(existing.workspaceId);
  const targetFolderId = input.targetFolderId ?? rootFolder.id;

  const targetFolder = await db
    .select()
    .from(knowledgeFolders)
    .where(
      and(
        eq(knowledgeFolders.id, targetFolderId),
        eq(knowledgeFolders.workspaceId, existing.workspaceId)
      )
    )
    .get();

  if (!targetFolder) {
    throw new Error("Target folder not found");
  }

  if (existing.folderId === targetFolderId) {
    return existing;
  }

  const nextStorageKey = generateKnowledgeDocumentStorageKey(
    existing.workspaceId,
    targetFolder.path,
    existing.slug,
    existing.id
  );

  if (nextStorageKey !== existing.storageKey) {
    const content = await getContent(existing.storageKey);
    if (content === null) {
      throw new Error("Document content missing in R2 storage");
    }

    const tags = extractTags(content);
    await uploadContent(nextStorageKey, content, "text/markdown; charset=utf-8", {
      workspace_id: existing.workspaceId,
      title: existing.title,
      tags: tags.join(","),
      folder_path: targetFolder.path,
    });
  }

  await db
    .update(knowledgeDocuments)
    .set({
      folderId: targetFolderId,
      storageKey: nextStorageKey,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, existing.id));

  const updated = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, existing.id))
    .get();

  if (!updated) {
    throw new Error("Document not found");
  }

  if (nextStorageKey !== existing.storageKey) {
    try {
      await deleteObject(existing.storageKey);
    } catch (error) {
      console.error("Failed to delete old knowledge document from R2:", error);
    }
  }

  const workspaceSlug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return updated;
}

export async function renameKnowledgeDocument(input: {
  documentId: string;
  title: string;
}): Promise<KnowledgeDocument> {
  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, input.documentId))
    .get();

  if (!existing) {
    throw new Error("Document not found");
  }

  const { user } = await requireWorkspaceAccess(existing.workspaceId, "member");

  const title = input.title.trim();
  if (!title) {
    throw new Error("Document title is required");
  }

  if (existing.title === title) {
    return existing;
  }

  const slug = slugify(title);
  const folderPath = await getFolderPath(existing.folderId);
  const nextStorageKey = generateKnowledgeDocumentStorageKey(
    existing.workspaceId,
    folderPath,
    slug,
    existing.id
  );

  if (nextStorageKey !== existing.storageKey) {
    const content = await getContent(existing.storageKey);
    if (content === null) {
      throw new Error("Document content missing in R2 storage");
    }

    const tags = extractTags(content);
    await uploadContent(nextStorageKey, content, "text/markdown; charset=utf-8", {
      workspace_id: existing.workspaceId,
      title,
      tags: tags.join(","),
      folder_path: folderPath ?? "",
    });

  }

  await db
    .update(knowledgeDocuments)
    .set({
      title,
      slug,
      storageKey: nextStorageKey,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, existing.id));

  const updated = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, existing.id))
    .get();

  if (!updated) {
    throw new Error("Document not found");
  }

  if (nextStorageKey !== existing.storageKey) {
    try {
      await deleteObject(existing.storageKey);
    } catch (error) {
      console.error("Failed to delete old knowledge document from R2:", error);
    }
  }

  const workspaceSlug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return updated;
}

export async function moveKnowledgeFolder(input: {
  folderId: string;
  targetParentFolderId: string | null;
}): Promise<KnowledgeFolder> {
  const folder = await db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, input.folderId))
    .get();

  if (!folder) {
    throw new Error("Folder not found");
  }

  const { user } = await requireWorkspaceAccess(folder.workspaceId, "member");
  const rootFolder = await ensureKnowledgeRootFolder(folder.workspaceId);

  if (folder.parentFolderId === null) {
    throw new Error("Root folder cannot be moved");
  }

  const targetParentFolderId = input.targetParentFolderId ?? rootFolder.id;
  const targetParent = await db
    .select()
    .from(knowledgeFolders)
    .where(
      and(
        eq(knowledgeFolders.id, targetParentFolderId),
        eq(knowledgeFolders.workspaceId, folder.workspaceId)
      )
    )
    .get();

  if (!targetParent) {
    throw new Error("Target folder not found");
  }

  if (targetParent.id === folder.id) {
    throw new Error("Folder cannot be moved into itself");
  }

  if (folder.parentFolderId === targetParent.id) {
    return folder;
  }

  const workspaceFolders = await db
    .select({
      id: knowledgeFolders.id,
      parentFolderId: knowledgeFolders.parentFolderId,
      path: knowledgeFolders.path,
    })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.workspaceId, folder.workspaceId));

  const folderIdsToMove = collectFolderIdsForDelete(workspaceFolders, folder.id);
  if (folderIdsToMove.includes(targetParent.id)) {
    throw new Error("Folder cannot be moved into its own child folder");
  }

  const oldPath = folder.path;
  const newPath = `${targetParent.path}/${slugify(folder.name)}`;
  const nextFolderPathById = new Map<string, string>();
  nextFolderPathById.set(folder.id, newPath);

  const now = new Date();
  await db
    .update(knowledgeFolders)
    .set({
      parentFolderId: targetParent.id,
      path: newPath,
      updatedAt: now,
    })
    .where(eq(knowledgeFolders.id, folder.id));

  const descendants = workspaceFolders.filter(
    (candidate) => candidate.id !== folder.id && folderIdsToMove.includes(candidate.id)
  );
  const oldDocumentStorageKeys: string[] = [];
  for (const descendant of descendants) {
    const descendantPath = replacePathPrefix(descendant.path, oldPath, newPath);
    nextFolderPathById.set(descendant.id, descendantPath);
    await db
      .update(knowledgeFolders)
      .set({
        path: descendantPath,
        updatedAt: now,
      })
      .where(eq(knowledgeFolders.id, descendant.id));
  }

  const docsInMovedFolders = await db
    .select({
      id: knowledgeDocuments.id,
      folderId: knowledgeDocuments.folderId,
      title: knowledgeDocuments.title,
      slug: knowledgeDocuments.slug,
      storageKey: knowledgeDocuments.storageKey,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, folder.workspaceId),
        inArray(knowledgeDocuments.folderId, folderIdsToMove)
      )
    );

  for (const doc of docsInMovedFolders) {
    if (!doc.folderId) continue;

    const nextFolderPath = nextFolderPathById.get(doc.folderId);
    if (!nextFolderPath) continue;

    const nextStorageKey = generateKnowledgeDocumentStorageKey(
      folder.workspaceId,
      nextFolderPath,
      doc.slug,
      doc.id
    );

    if (nextStorageKey === doc.storageKey) continue;

    const content = await getContent(doc.storageKey);
    if (content === null) {
      throw new Error(`Document content missing in R2 storage for ${doc.id}`);
    }

    const tags = extractTags(content);
    await uploadContent(nextStorageKey, content, "text/markdown; charset=utf-8", {
      workspace_id: folder.workspaceId,
      title: doc.title,
      tags: tags.join(","),
      folder_path: nextFolderPath,
    });

    await db
      .update(knowledgeDocuments)
      .set({
        storageKey: nextStorageKey,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, doc.id));

    oldDocumentStorageKeys.push(doc.storageKey);
  }

  await deleteStorageKeys(oldDocumentStorageKeys);

  const updated = await db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, folder.id))
    .get();

  if (!updated) {
    throw new Error("Folder not found");
  }

  const workspaceSlug = await getWorkspaceSlug(folder.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return updated;
}

export async function renameKnowledgeFolder(input: {
  folderId: string;
  name: string;
}): Promise<KnowledgeFolder> {
  const folder = await db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, input.folderId))
    .get();

  if (!folder) {
    throw new Error("Folder not found");
  }

  const { user } = await requireWorkspaceAccess(folder.workspaceId, "member");

  if (folder.parentFolderId === null) {
    throw new Error("Root folder cannot be renamed");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Folder name is required");
  }

  if (folder.name === name) {
    return folder;
  }

  const parentFolder = await db
    .select()
    .from(knowledgeFolders)
    .where(
      and(
        eq(knowledgeFolders.id, folder.parentFolderId),
        eq(knowledgeFolders.workspaceId, folder.workspaceId)
      )
    )
    .get();

  if (!parentFolder) {
    throw new Error("Parent folder not found");
  }

  const workspaceFolders = await db
    .select({
      id: knowledgeFolders.id,
      parentFolderId: knowledgeFolders.parentFolderId,
      path: knowledgeFolders.path,
    })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.workspaceId, folder.workspaceId));

  const folderIdsToRename = collectFolderIdsForDelete(workspaceFolders, folder.id);
  const oldPath = folder.path;
  const newPath = `${parentFolder.path}/${slugify(name)}`;
  const nextFolderPathById = new Map<string, string>();
  nextFolderPathById.set(folder.id, newPath);

  const now = new Date();
  await db
    .update(knowledgeFolders)
    .set({
      name,
      path: newPath,
      updatedAt: now,
    })
    .where(eq(knowledgeFolders.id, folder.id));

  const descendants = workspaceFolders.filter(
    (candidate) => candidate.id !== folder.id && folderIdsToRename.includes(candidate.id)
  );
  const oldDocumentStorageKeys: string[] = [];
  for (const descendant of descendants) {
    const descendantPath = replacePathPrefix(descendant.path, oldPath, newPath);
    nextFolderPathById.set(descendant.id, descendantPath);
    await db
      .update(knowledgeFolders)
      .set({
        path: descendantPath,
        updatedAt: now,
      })
      .where(eq(knowledgeFolders.id, descendant.id));
  }

  const docsInRenamedFolders = await db
    .select({
      id: knowledgeDocuments.id,
      folderId: knowledgeDocuments.folderId,
      title: knowledgeDocuments.title,
      slug: knowledgeDocuments.slug,
      storageKey: knowledgeDocuments.storageKey,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, folder.workspaceId),
        inArray(knowledgeDocuments.folderId, folderIdsToRename)
      )
    );

  for (const doc of docsInRenamedFolders) {
    if (!doc.folderId) continue;

    const nextFolderPath = nextFolderPathById.get(doc.folderId);
    if (!nextFolderPath) continue;

    const nextStorageKey = generateKnowledgeDocumentStorageKey(
      folder.workspaceId,
      nextFolderPath,
      doc.slug,
      doc.id
    );

    if (nextStorageKey === doc.storageKey) continue;

    const content = await getContent(doc.storageKey);
    if (content === null) {
      throw new Error(`Document content missing in R2 storage for ${doc.id}`);
    }

    const tags = extractTags(content);
    await uploadContent(nextStorageKey, content, "text/markdown; charset=utf-8", {
      workspace_id: folder.workspaceId,
      title: doc.title,
      tags: tags.join(","),
      folder_path: nextFolderPath,
    });

    await db
      .update(knowledgeDocuments)
      .set({
        storageKey: nextStorageKey,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, doc.id));

    oldDocumentStorageKeys.push(doc.storageKey);
  }

  await deleteStorageKeys(oldDocumentStorageKeys);

  const updated = await db
    .select()
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, folder.id))
    .get();

  if (!updated) {
    throw new Error("Folder not found");
  }

  const workspaceSlug = await getWorkspaceSlug(folder.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return updated;
}

export async function getIssueKnowledgeDocuments(issueId: string): Promise<KnowledgeDocument[]> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) return [];

  await requireWorkspaceAccess(workspaceId, "member");

  return db
    .select({
      id: knowledgeDocuments.id,
      workspaceId: knowledgeDocuments.workspaceId,
      folderId: knowledgeDocuments.folderId,
      title: knowledgeDocuments.title,
      slug: knowledgeDocuments.slug,
      storageKey: knowledgeDocuments.storageKey,
      contentHash: knowledgeDocuments.contentHash,
      summary: knowledgeDocuments.summary,
      createdBy: knowledgeDocuments.createdBy,
      updatedBy: knowledgeDocuments.updatedBy,
      createdAt: knowledgeDocuments.createdAt,
      updatedAt: knowledgeDocuments.updatedAt,
    })
    .from(issueKnowledgeDocuments)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, issueKnowledgeDocuments.documentId)
    )
    .where(eq(issueKnowledgeDocuments.issueId, issueId));
}

export async function linkKnowledgeDocumentToIssue(
  issueId: string,
  documentId: string
): Promise<void> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) throw new Error("Issue not found");
  const { user } = await requireWorkspaceAccess(workspaceId, "member");

  const doc = await db
    .select({ workspaceId: knowledgeDocuments.workspaceId })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  if (!doc || doc.workspaceId !== workspaceId) {
    throw new Error("Document not found in workspace");
  }

  await db
    .insert(issueKnowledgeDocuments)
    .values({
      issueId,
      documentId,
      linkedBy: user.id,
      linkedAt: new Date(),
    })
    .onConflictDoNothing();

  const workspaceSlug = await getWorkspaceSlug(workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}` : "/");
}

export async function unlinkKnowledgeDocumentFromIssue(
  issueId: string,
  documentId: string
): Promise<void> {
  const workspaceId = await getWorkspaceIdFromIssue(issueId);
  if (!workspaceId) return;
  await requireWorkspaceAccess(workspaceId, "member");

  await db
    .delete(issueKnowledgeDocuments)
    .where(
      and(
        eq(issueKnowledgeDocuments.issueId, issueId),
        eq(issueKnowledgeDocuments.documentId, documentId)
      )
    );

  const workspaceSlug = await getWorkspaceSlug(workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}` : "/");
}

export async function getKnowledgeTags(workspaceId: string): Promise<string[]> {
  await requireWorkspaceAccess(workspaceId, "member");

  const rows = await db
    .selectDistinct({ tag: knowledgeDocumentTags.tag })
    .from(knowledgeDocumentTags)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeDocumentTags.documentId)
    )
    .where(eq(knowledgeDocuments.workspaceId, workspaceId));

  return rows.map((row) => row.tag).sort();
}

export async function createKnowledgeImageUpload(input: {
  workspaceId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<{ uploadUrl: string; assetId: string; imageMarkdownUrl: string; storageKey: string }> {
  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");

  if (!input.mimeType.startsWith("image/")) {
    throw new Error("Only image uploads are supported");
  }
  if (input.size > 10 * 1024 * 1024) {
    throw new Error("Image size exceeds 10MB");
  }

  const doc = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, input.documentId))
    .get();
  if (!doc || doc.workspaceId !== input.workspaceId) {
    throw new Error("Document not found");
  }

  const storageKey = generateKnowledgeImageStorageKey(
    input.workspaceId,
    input.documentId,
    input.filename
  );
  const assetId = crypto.randomUUID();
  const uploadUrl = await generateUploadUrl(storageKey, input.mimeType);

  await db.insert(knowledgeAssets).values({
    id: assetId,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    storageKey,
    createdBy: user.id,
    createdAt: new Date(),
  });

  return {
    uploadUrl,
    assetId,
    storageKey,
    imageMarkdownUrl: `/api/knowledge/assets/${assetId}`,
  };
}

export async function getKnowledgeAsset(
  assetId: string,
  workspaceId: string
): Promise<(KnowledgeAsset & { url: string }) | null> {
  await requireWorkspaceAccess(workspaceId, "member");
  const asset = await db
    .select()
    .from(knowledgeAssets)
    .where(
      and(eq(knowledgeAssets.id, assetId), eq(knowledgeAssets.workspaceId, workspaceId))
    )
    .get();

  if (!asset) return null;
  const url = await generateDownloadUrl(asset.storageKey, 300);
  return { ...asset, url };
}
