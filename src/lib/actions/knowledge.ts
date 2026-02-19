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
  generateKnowledgeDocumentPreviewStorageKey,
  generateKnowledgeImageStorageKey,
  getContent,
  getObjectBinary,
  uploadBinaryContent,
  uploadContent,
} from "../storage/r2-client";
import {
  convertDocumentToPdf,
  isDocumentConverterConfigured,
} from "../document-conversion";
import { getWorkspaceSlug, getWorkspaceIdFromIssue } from "./helpers";
import { requireWorkspaceAccess } from "./workspace";

const ROOT_FOLDER_NAME = "Knowledge Base";
const MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_KNOWLEDGE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_KNOWLEDGE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const EXTENSION_TO_MIME_TYPE = new Map<string, string>([
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["txt", "text/plain"],
  ["csv", "text/csv"],
  ["pdf", "application/pdf"],
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);
const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const MARKDOWN_FILE_EXTENSIONS = new Set(["md", "markdown"]);
const DIRECT_PREVIEW_FILE_EXTENSIONS = new Set(["pdf", "csv", "txt"]);
const PDF_CONVERSION_FILE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);
let knowledgeSchemaInitPromise: Promise<void> | null = null;

type KnowledgePreviewStatus = "ready" | "pending" | "failed";

function hasSqliteMessage(error: unknown, fragment: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes(fragment.toLowerCase());
}

async function safeAddKnowledgeDocumentsColumn(sqlStatement: string): Promise<void> {
  try {
    await db.run(sql.raw(sqlStatement));
  } catch (error) {
    if (hasSqliteMessage(error, "duplicate column name")) {
      return;
    }
    throw error;
  }
}

async function ensureKnowledgeSchema(): Promise<void> {
  if (knowledgeSchemaInitPromise) {
    await knowledgeSchemaInitPromise;
    return;
  }

  knowledgeSchemaInitPromise = (async () => {
    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS knowledge_folders (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL,
        parent_folder_id text,
        name text NOT NULL,
        path text NOT NULL,
        created_by text,
        created_at integer,
        updated_at integer,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE set null
      )`)
    );

    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS knowledge_documents (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL,
        folder_id text,
        title text NOT NULL,
        slug text NOT NULL,
        mime_type text DEFAULT 'text/markdown' NOT NULL,
        file_extension text DEFAULT 'md' NOT NULL,
        size integer DEFAULT 0 NOT NULL,
        storage_key text NOT NULL,
        preview_storage_key text,
        preview_mime_type text,
        preview_status text DEFAULT 'ready' NOT NULL,
        preview_error text,
        content_hash text,
        summary text,
        created_by text,
        updated_by text,
        created_at integer,
        updated_at integer,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade,
        FOREIGN KEY (folder_id) REFERENCES knowledge_folders(id) ON DELETE set null,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE set null,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE set null
      )`)
    );

    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS knowledge_document_tags (
        document_id text NOT NULL,
        tag text NOT NULL,
        PRIMARY KEY(document_id, tag),
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE cascade
      )`)
    );

    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS knowledge_document_links (
        source_document_id text NOT NULL,
        target_document_id text NOT NULL,
        link_type text NOT NULL DEFAULT 'wiki',
        created_at integer,
        PRIMARY KEY(source_document_id, target_document_id, link_type),
        FOREIGN KEY (source_document_id) REFERENCES knowledge_documents(id) ON DELETE cascade,
        FOREIGN KEY (target_document_id) REFERENCES knowledge_documents(id) ON DELETE cascade
      )`)
    );

    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS issue_knowledge_documents (
        issue_id text NOT NULL,
        document_id text NOT NULL,
        linked_by text,
        linked_at integer,
        PRIMARY KEY(issue_id, document_id),
        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE cascade,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE cascade,
        FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE set null
      )`)
    );

    await db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS knowledge_assets (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL,
        document_id text,
        filename text NOT NULL,
        mime_type text NOT NULL,
        size integer NOT NULL,
        storage_key text NOT NULL,
        created_by text,
        created_at integer,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE cascade,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE set null
      )`)
    );

    const tableInfo = await db.run(sql.raw("PRAGMA table_info('knowledge_documents')"));
    const existingColumns = new Set(
      (tableInfo.rows as Array<Record<string, unknown>>)
        .map((row) => row.name)
        .filter((value): value is string => typeof value === "string")
    );

    if (!existingColumns.has("mime_type")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN mime_type text DEFAULT 'text/markdown' NOT NULL"
      );
    }
    if (!existingColumns.has("file_extension")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN file_extension text DEFAULT 'md' NOT NULL"
      );
    }
    if (!existingColumns.has("size")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN size integer DEFAULT 0 NOT NULL"
      );
    }
    if (!existingColumns.has("preview_storage_key")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN preview_storage_key text"
      );
    }
    if (!existingColumns.has("preview_mime_type")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN preview_mime_type text"
      );
    }
    if (!existingColumns.has("preview_status")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN preview_status text DEFAULT 'ready' NOT NULL"
      );
    }
    if (!existingColumns.has("preview_error")) {
      await safeAddKnowledgeDocumentsColumn(
        "ALTER TABLE knowledge_documents ADD COLUMN preview_error text"
      );
    }
  })();

  try {
    await knowledgeSchemaInitPromise;
  } catch (error) {
    knowledgeSchemaInitPromise = null;
    throw error;
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(";")[0] ?? "";
}

function normalizeFileExtension(extension: string): string {
  return extension
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "");
}

function getFilenameExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) {
    return "";
  }
  return normalizeFileExtension(filename.slice(dotIndex + 1));
}

function getFilenameBase(filename: string): string {
  const normalized = filename.split(/[\\/]/).pop()?.trim() ?? "";
  if (!normalized) return "document";
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) return normalized;
  return normalized.slice(0, dotIndex);
}

function hasDirectPreview(fileExtension: string): boolean {
  return DIRECT_PREVIEW_FILE_EXTENSIONS.has(normalizeFileExtension(fileExtension));
}

function requiresPdfConversion(fileExtension: string): boolean {
  return PDF_CONVERSION_FILE_EXTENSIONS.has(normalizeFileExtension(fileExtension));
}

function getInitialPreviewStatus(input: {
  mimeType: string;
  fileExtension: string;
}): KnowledgePreviewStatus {
  if (isMarkdownDocument(input) || hasDirectPreview(input.fileExtension)) {
    return "ready";
  }
  if (requiresPdfConversion(input.fileExtension)) {
    return "pending";
  }
  return "failed";
}

function coercePreviewStatus(
  value: string | null | undefined
): KnowledgePreviewStatus {
  if (value === "failed" || value === "pending" || value === "ready") {
    return value;
  }
  return "ready";
}

function isMarkdownDocument(input: { mimeType: string; fileExtension: string }): boolean {
  const normalizedMimeType = normalizeMimeType(input.mimeType);
  const normalizedExtension = normalizeFileExtension(input.fileExtension);
  return (
    MARKDOWN_MIME_TYPES.has(normalizedMimeType) ||
    MARKDOWN_FILE_EXTENSIONS.has(normalizedExtension)
  );
}

function resolveKnowledgeDocumentFormat(input: {
  filename: string;
  mimeType: string;
}): { mimeType: string; fileExtension: string } {
  const normalizedMimeType = normalizeMimeType(input.mimeType);
  const fileExtension = getFilenameExtension(input.filename);

  const resolvedMimeType =
    (ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPES.has(normalizedMimeType)
      ? normalizedMimeType
      : null) ??
    (fileExtension ? EXTENSION_TO_MIME_TYPE.get(fileExtension) ?? null : null);

  if (!resolvedMimeType) {
    throw new Error("Unsupported file type. Upload markdown, text, PDF, Word, Excel, or PowerPoint files.");
  }

  const resolvedExtension =
    fileExtension ||
    [...EXTENSION_TO_MIME_TYPE.entries()].find(([, mimeType]) => mimeType === resolvedMimeType)?.[0] ||
    "bin";

  return {
    mimeType: resolvedMimeType,
    fileExtension: resolvedExtension,
  };
}

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
  await ensureKnowledgeSchema();

  const doc = await db
    .select({ workspaceId: knowledgeDocuments.workspaceId })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  return doc?.workspaceId ?? null;
}

async function getFolderPath(folderId: string | null): Promise<string | null> {
  await ensureKnowledgeSchema();

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

async function copyKnowledgeDocumentStorageObject(input: {
  sourceStorageKey: string;
  targetStorageKey: string;
  mimeType: string;
  workspaceId: string;
  title: string;
  folderPath: string | null;
}): Promise<void> {
  const sourceObject = await getObjectBinary(input.sourceStorageKey);
  if (!sourceObject) {
    throw new Error("Document content missing in R2 storage");
  }

  await uploadBinaryContent(
    input.targetStorageKey,
    sourceObject.body,
    normalizeMimeType(input.mimeType) || sourceObject.contentType || "application/octet-stream",
    {
      workspace_id: input.workspaceId,
      title: input.title,
      folder_path: input.folderPath ?? "",
    }
  );
}

function normalizePreviewError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Document preview conversion failed";
  return message.slice(0, 500);
}

function getResolvedPreviewState(doc: KnowledgeDocument): {
  status: KnowledgePreviewStatus;
  previewStorageKey: string | null;
  previewMimeType: string | null;
  previewError: string | null;
} {
  if (isMarkdownDocument(doc) || hasDirectPreview(doc.fileExtension)) {
    return {
      status: "ready",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: null,
    };
  }

  if (!requiresPdfConversion(doc.fileExtension)) {
    return {
      status: "failed",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: "Preview unavailable for this file type",
    };
  }

  if (doc.previewStorageKey && coercePreviewStatus(doc.previewStatus) === "ready") {
    return {
      status: "ready",
      previewStorageKey: doc.previewStorageKey,
      previewMimeType: doc.previewMimeType ?? "application/pdf",
      previewError: null,
    };
  }

  const status = coercePreviewStatus(doc.previewStatus);
  if (status === "failed") {
    return {
      status: "failed",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: doc.previewError || "Preview conversion failed",
    };
  }

  return {
    status: "pending",
    previewStorageKey: null,
    previewMimeType: null,
    previewError: null,
  };
}

async function setKnowledgeDocumentPreviewState(input: {
  documentId: string;
  previewStatus: KnowledgePreviewStatus;
  previewStorageKey?: string | null;
  previewMimeType?: string | null;
  previewError?: string | null;
}): Promise<void> {
  await db
    .update(knowledgeDocuments)
    .set({
      previewStatus: input.previewStatus,
      previewStorageKey: input.previewStorageKey ?? null,
      previewMimeType: input.previewMimeType ?? null,
      previewError: input.previewError ?? null,
    })
    .where(eq(knowledgeDocuments.id, input.documentId));
}

async function finalizeKnowledgeDocumentPreview(input: {
  document: KnowledgeDocument;
}): Promise<{ status: KnowledgePreviewStatus; error: string | null }> {
  const resolved = getResolvedPreviewState(input.document);
  if (resolved.status === "ready") {
    if (
      input.document.previewStatus !== "ready" ||
      input.document.previewStorageKey !== resolved.previewStorageKey ||
      input.document.previewMimeType !== resolved.previewMimeType ||
      input.document.previewError !== null
    ) {
      await setKnowledgeDocumentPreviewState({
        documentId: input.document.id,
        previewStatus: "ready",
        previewStorageKey: resolved.previewStorageKey,
        previewMimeType: resolved.previewMimeType,
        previewError: null,
      });
    }

    return { status: "ready", error: null };
  }

  if (resolved.status === "failed" && !requiresPdfConversion(input.document.fileExtension)) {
    await setKnowledgeDocumentPreviewState({
      documentId: input.document.id,
      previewStatus: "failed",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: resolved.previewError,
    });
    return { status: "failed", error: resolved.previewError };
  }

  if (!isDocumentConverterConfigured()) {
    const errorMessage =
      "Preview conversion is not configured. Set CLOUDFLARE_DOC_CONVERTER_URL.";
    await setKnowledgeDocumentPreviewState({
      documentId: input.document.id,
      previewStatus: "failed",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: errorMessage,
    });
    return { status: "failed", error: errorMessage };
  }

  try {
    await setKnowledgeDocumentPreviewState({
      documentId: input.document.id,
      previewStatus: "pending",
      previewStorageKey: null,
      previewMimeType: null,
      previewError: null,
    });

    const source = await getObjectBinary(input.document.storageKey);
    if (!source) {
      throw new Error("Uploaded file is missing from storage");
    }

    const previewStorageKey = generateKnowledgeDocumentPreviewStorageKey(
      input.document.workspaceId,
      input.document.id
    );
    const convertedPdf = await convertDocumentToPdf({
      filename: input.document.title,
      mimeType: input.document.mimeType || source.contentType,
      content: source.body,
    });

    await uploadBinaryContent(previewStorageKey, convertedPdf, "application/pdf", {
      workspace_id: input.document.workspaceId,
      document_id: input.document.id,
      source_storage_key: input.document.storageKey,
    });

    await setKnowledgeDocumentPreviewState({
      documentId: input.document.id,
      previewStatus: "ready",
      previewStorageKey,
      previewMimeType: "application/pdf",
      previewError: null,
    });

    return { status: "ready", error: null };
  } catch (error) {
    const previewError = normalizePreviewError(error);
    await setKnowledgeDocumentPreviewState({
      documentId: input.document.id,
      previewStatus: "failed",
      previewStorageKey: null,
      previewMimeType: null,
      previewError,
    });
    return { status: "failed", error: previewError };
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

  const linkTitles = wikiLinks.map((title) => title.toLowerCase());
  const matchingTargets =
    linkTitles.length > 0
      ? await db
          .select({
            id: knowledgeDocuments.id,
            title: knowledgeDocuments.title,
            lowerTitle: sql<string>`lower(${knowledgeDocuments.title})`,
          })
          .from(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.workspaceId, workspaceId),
              inArray(sql<string>`lower(${knowledgeDocuments.title})`, linkTitles)
            )
          )
      : [];

  const targetsByTitle = new Map<string, Array<{ id: string; title: string }>>();
  for (const target of matchingTargets) {
    const current = targetsByTitle.get(target.lowerTitle) ?? [];
    current.push({ id: target.id, title: target.title });
    targetsByTitle.set(target.lowerTitle, current);
  }

  const targets: Array<{ id: string; title: string }> = [];
  for (const linkTitle of linkTitles) {
    const candidates = targetsByTitle.get(linkTitle) ?? [];
    if (candidates.length !== 1) continue;

    const candidate = candidates[0];
    if (candidate.id === documentId) continue;
    targets.push(candidate);
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
  await ensureKnowledgeSchema();

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
  await ensureKnowledgeSchema();

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
  await ensureKnowledgeSchema();

  const workspaceId = await getWorkspaceIdFromDocument(documentId);
  if (!workspaceId) return null;
  await requireWorkspaceAccess(workspaceId, "member");

  const doc = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  if (!doc) return null;

  const markdownDocument = isMarkdownDocument(doc);
  const previewState = getResolvedPreviewState(doc);
  const previewStorageKey = markdownDocument
    ? doc.storageKey
    : hasDirectPreview(doc.fileExtension)
      ? doc.storageKey
      : previewState.previewStorageKey;

  const [content, tags, backlinkRows, downloadUrl, previewUrl] = await Promise.all([
    markdownDocument ? getContent(doc.storageKey) : Promise.resolve(null),
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
        mimeType: knowledgeDocuments.mimeType,
        fileExtension: knowledgeDocuments.fileExtension,
        size: knowledgeDocuments.size,
        storageKey: knowledgeDocuments.storageKey,
        previewStorageKey: knowledgeDocuments.previewStorageKey,
        previewMimeType: knowledgeDocuments.previewMimeType,
        previewStatus: knowledgeDocuments.previewStatus,
        previewError: knowledgeDocuments.previewError,
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
    generateDownloadUrl(doc.storageKey, 3600),
    previewStorageKey ? generateDownloadUrl(previewStorageKey, 3600) : Promise.resolve(null),
  ]);

  return {
    ...doc,
    content: content ?? null,
    isMarkdown: markdownDocument,
    downloadUrl,
    previewUrl,
    previewStatus: previewState.status,
    previewError: previewState.previewError,
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
  await ensureKnowledgeSchema();

  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");
  await ensureKnowledgeRootFolder(input.workspaceId);

  const title = input.title.trim();
  if (!title) throw new Error("Document title is required");

  const now = new Date();
  const id = crypto.randomUUID();
  const slug = slugify(title);
  const mimeType = "text/markdown";
  const fileExtension = "md";
  const folderPath = await getFolderPath(input.folderId ?? null);
  const storageKey = generateKnowledgeDocumentStorageKey(
    input.workspaceId,
    folderPath,
    slug,
    id,
    fileExtension
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
    mimeType,
    fileExtension,
    size: Buffer.byteLength(input.content, "utf-8"),
    storageKey,
    previewStorageKey: null,
    previewMimeType: null,
    previewStatus: "ready",
    previewError: null,
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

export async function createKnowledgeDocumentUpload(input: {
  workspaceId: string;
  filename: string;
  mimeType: string;
  size: number;
  folderId?: string | null;
}): Promise<{ document: KnowledgeDocument; uploadUrl: string }> {
  await ensureKnowledgeSchema();

  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");
  await ensureKnowledgeRootFolder(input.workspaceId);

  const filename = input.filename.split(/[\\/]/).pop()?.trim() ?? "";
  if (!filename) {
    throw new Error("Filename is required");
  }
  if (input.size <= 0 || input.size > MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES) {
    throw new Error("File size must be between 1 byte and 25MB");
  }

  const { mimeType, fileExtension } = resolveKnowledgeDocumentFormat({
    filename,
    mimeType: input.mimeType,
  });
  if (!ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported file type");
  }

  const now = new Date();
  const id = crypto.randomUUID();
  const title = filename;
  const slug = slugify(getFilenameBase(filename));
  const folderPath = await getFolderPath(input.folderId ?? null);
  const storageKey = generateKnowledgeDocumentStorageKey(
    input.workspaceId,
    folderPath,
    slug,
    id,
    fileExtension
  );

  const document: KnowledgeDocument = {
    id,
    workspaceId: input.workspaceId,
    folderId: input.folderId ?? null,
    title,
    slug,
    mimeType,
    fileExtension,
    size: input.size,
    storageKey,
    previewStorageKey: null,
    previewMimeType: null,
    previewStatus: getInitialPreviewStatus({ mimeType, fileExtension }),
    previewError: null,
    contentHash: null,
    summary: null,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(knowledgeDocuments).values(document);

  const uploadUrl = await generateUploadUrl(storageKey, mimeType);
  const workspaceSlug = await getWorkspaceSlug(input.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");

  return {
    document,
    uploadUrl,
  };
}

export async function finalizeKnowledgeDocumentUpload(documentId: string): Promise<{
  documentId: string;
  previewStatus: KnowledgePreviewStatus;
  previewError: string | null;
}> {
  await ensureKnowledgeSchema();

  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .get();

  if (!existing) {
    throw new Error("Document not found");
  }

  await requireWorkspaceAccess(existing.workspaceId, "member");
  const finalized = await finalizeKnowledgeDocumentPreview({ document: existing });

  return {
    documentId: existing.id,
    previewStatus: finalized.status,
    previewError: finalized.error,
  };
}

export async function updateKnowledgeDocument(input: {
  documentId: string;
  title: string;
  content: string;
  folderId?: string | null;
}): Promise<KnowledgeDocument> {
  await ensureKnowledgeSchema();

  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, input.documentId))
    .get();

  if (!existing) throw new Error("Document not found");
  const { user } = await requireWorkspaceAccess(existing.workspaceId, "member");
  if (!isMarkdownDocument(existing)) {
    throw new Error("Only markdown files can be edited inline");
  }

  const title = input.title.trim();
  if (!title) throw new Error("Document title is required");

  const slug = slugify(title);
  const folderId = input.folderId ?? existing.folderId;
  const folderPath = await getFolderPath(folderId);
  const nextStorageKey = generateKnowledgeDocumentStorageKey(
    existing.workspaceId,
    folderPath,
    slug,
    existing.id,
    existing.fileExtension
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
      size: Buffer.byteLength(input.content, "utf-8"),
      previewStorageKey: null,
      previewMimeType: null,
      previewStatus: "ready",
      previewError: null,
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
  await ensureKnowledgeSchema();

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

  await deleteStorageKeys(
    [
      existing.storageKey,
      existing.previewStorageKey,
      ...assetRows.map((asset) => asset.storageKey),
    ].filter((value): value is string => Boolean(value))
  );

  const workspaceSlug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");
}

export async function deleteKnowledgeFolder(folderId: string): Promise<void> {
  await ensureKnowledgeSchema();

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
    .select({
      id: knowledgeDocuments.id,
      storageKey: knowledgeDocuments.storageKey,
      previewStorageKey: knowledgeDocuments.previewStorageKey,
    })
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
    ...docs
      .map((doc) => doc.previewStorageKey)
      .filter((value): value is string => Boolean(value)),
    ...assetRows.map((asset) => asset.storageKey),
  ]);

  const workspaceSlug = await getWorkspaceSlug(folder.workspaceId);
  revalidatePath(workspaceSlug ? `/w/${workspaceSlug}/knowledge` : "/");
}

export async function moveKnowledgeDocument(input: {
  documentId: string;
  targetFolderId: string | null;
}): Promise<KnowledgeDocument> {
  await ensureKnowledgeSchema();

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
    existing.id,
    existing.fileExtension
  );

  if (nextStorageKey !== existing.storageKey) {
    await copyKnowledgeDocumentStorageObject({
      sourceStorageKey: existing.storageKey,
      targetStorageKey: nextStorageKey,
      mimeType: existing.mimeType,
      workspaceId: existing.workspaceId,
      title: existing.title,
      folderPath: targetFolder.path,
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
  await ensureKnowledgeSchema();

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
    existing.id,
    existing.fileExtension
  );

  if (nextStorageKey !== existing.storageKey) {
    await copyKnowledgeDocumentStorageObject({
      sourceStorageKey: existing.storageKey,
      targetStorageKey: nextStorageKey,
      mimeType: existing.mimeType,
      workspaceId: existing.workspaceId,
      title,
      folderPath,
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
  await ensureKnowledgeSchema();

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
      mimeType: knowledgeDocuments.mimeType,
      fileExtension: knowledgeDocuments.fileExtension,
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
      doc.id,
      doc.fileExtension
    );

    if (nextStorageKey === doc.storageKey) continue;

    await copyKnowledgeDocumentStorageObject({
      sourceStorageKey: doc.storageKey,
      targetStorageKey: nextStorageKey,
      mimeType: doc.mimeType,
      workspaceId: folder.workspaceId,
      title: doc.title,
      folderPath: nextFolderPath,
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
  await ensureKnowledgeSchema();

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
      mimeType: knowledgeDocuments.mimeType,
      fileExtension: knowledgeDocuments.fileExtension,
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
      doc.id,
      doc.fileExtension
    );

    if (nextStorageKey === doc.storageKey) continue;

    await copyKnowledgeDocumentStorageObject({
      sourceStorageKey: doc.storageKey,
      targetStorageKey: nextStorageKey,
      mimeType: doc.mimeType,
      workspaceId: folder.workspaceId,
      title: doc.title,
      folderPath: nextFolderPath,
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
  await ensureKnowledgeSchema();

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
      mimeType: knowledgeDocuments.mimeType,
      fileExtension: knowledgeDocuments.fileExtension,
      size: knowledgeDocuments.size,
      storageKey: knowledgeDocuments.storageKey,
      previewStorageKey: knowledgeDocuments.previewStorageKey,
      previewMimeType: knowledgeDocuments.previewMimeType,
      previewStatus: knowledgeDocuments.previewStatus,
      previewError: knowledgeDocuments.previewError,
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
  await ensureKnowledgeSchema();

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
  await ensureKnowledgeSchema();

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
  await ensureKnowledgeSchema();

  await requireWorkspaceAccess(workspaceId, "member");

  const rows = await db
    .selectDistinct({ tag: knowledgeDocumentTags.tag })
    .from(knowledgeDocumentTags)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeDocumentTags.documentId)
    )
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, workspaceId),
        inArray(knowledgeDocuments.mimeType, [...MARKDOWN_MIME_TYPES])
      )
    );

  return rows.map((row) => row.tag).sort();
}

export async function createKnowledgeImageUpload(input: {
  workspaceId: string;
  documentId?: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<{ uploadUrl: string; assetId: string; imageMarkdownUrl: string; storageKey: string }> {
  await ensureKnowledgeSchema();

  const { user } = await requireWorkspaceAccess(input.workspaceId, "member");
  const mimeType = normalizeMimeType(input.mimeType);

  if (!ALLOWED_KNOWLEDGE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Only image uploads are supported");
  }
  if (input.size <= 0 || input.size > MAX_KNOWLEDGE_IMAGE_SIZE_BYTES) {
    throw new Error("Image size must be between 1 byte and 10MB");
  }

  if (input.documentId) {
    const doc = await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, input.documentId))
      .get();
    if (!doc || doc.workspaceId !== input.workspaceId) {
      throw new Error("Document not found");
    }
    if (!isMarkdownDocument(doc)) {
      throw new Error("Images can only be uploaded for markdown files");
    }
  }

  const storageKey = generateKnowledgeImageStorageKey(
    input.workspaceId,
    input.documentId,
    input.filename
  );
  const assetId = crypto.randomUUID();
  const uploadUrl = await generateUploadUrl(storageKey, mimeType);

  await db.insert(knowledgeAssets).values({
    id: assetId,
    workspaceId: input.workspaceId,
    documentId: input.documentId ?? null,
    filename: input.filename,
    mimeType,
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
  await ensureKnowledgeSchema();

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
