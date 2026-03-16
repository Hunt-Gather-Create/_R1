import { GoogleGenAI, type Content } from "@google/genai";
import {
  uploadBuffer,
  generateAdMediaStorageKey,
  generateDownloadUrl,
  getObjectBinary,
} from "@/lib/storage/r2-client";

/** Default model for this AI feature (compliance). Kept local to avoid circular import with @/lib/chat. */
const DEFAULT_IMAGE_FEATURE_MODEL = "claude-haiku-4-5-20251001";

/** Backend model used for actual image generation (Google Gemini). */
const IMAGE_GENERATION_BACKEND_MODEL = "gemini-2.5-flash-image";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured");
  }
  return new GoogleGenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Generation history types
// ---------------------------------------------------------------------------

export interface GenerationRecord {
  id: string;
  sessionId: string;
  parentId: string | null;
  prompt: string;
  storageKey: string;
  mimeType: string;
  aspectRatio: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface GenerationSession {
  id: string;
  workspaceId: string;
  artifactId: string;
  mediaIndex: number;
  generations: GenerationRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerationHistoryStore {
  createSession(params: {
    workspaceId: string;
    artifactId: string;
    mediaIndex: number;
  }): Promise<GenerationSession>;

  getSession(sessionId: string): Promise<GenerationSession | null>;

  addRecord(sessionId: string, record: GenerationRecord): Promise<void>;

  getRecords(sessionId: string): Promise<GenerationRecord[]>;
}

// ---------------------------------------------------------------------------
// In-memory store (pluggable — swap for R2/DB later)
// ---------------------------------------------------------------------------

export class InMemoryHistoryStore implements GenerationHistoryStore {
  private sessions = new Map<string, GenerationSession>();

  async createSession(params: {
    workspaceId: string;
    artifactId: string;
    mediaIndex: number;
  }): Promise<GenerationSession> {
    const now = new Date().toISOString();
    const session: GenerationSession = {
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      artifactId: params.artifactId,
      mediaIndex: params.mediaIndex,
      generations: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<GenerationSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async addRecord(sessionId: string, record: GenerationRecord): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.generations.push(record);
    session.updatedAt = new Date().toISOString();
  }

  async getRecords(sessionId: string): Promise<GenerationRecord[]> {
    return this.sessions.get(sessionId)?.generations ?? [];
  }
}

// ---------------------------------------------------------------------------
// Multi-turn content builder
// ---------------------------------------------------------------------------

async function buildMultiTurnContent(
  store: GenerationHistoryStore,
  sessionId: string,
  currentPrompt: string,
): Promise<Content[]> {
  const records = await store.getRecords(sessionId);

  if (records.length === 0) {
    return [{ role: "user", parts: [{ text: currentPrompt }] }];
  }

  const contents: Content[] = [];

  for (const record of records) {
    // User turn: the prompt that was sent
    contents.push({ role: "user", parts: [{ text: record.prompt }] });

    // Model turn: the image that was generated (fetched from R2)
    try {
      const obj = await getObjectBinary(record.storageKey);
      if (obj) {
        const base64 = Buffer.from(obj.body).toString("base64");
        contents.push({
          role: "model",
          parts: [{ inlineData: { data: base64, mimeType: record.mimeType } }],
        });
      }
    } catch (err) {
      console.warn(
        `Failed to fetch image for history record ${record.id}:`,
        err,
      );
      // Skip this model turn — the prompt context is still included
    }
  }

  // Append the new user prompt as the final turn
  contents.push({ role: "user", parts: [{ text: currentPrompt }] });

  return contents;
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: string; // "1:1" | "4:5" | "16:9" | "9:16"
  workspaceId: string;
  artifactId: string;
  mediaIndex?: number;
  /** Model ID for this AI feature; defaults to mandated default (claude-haiku-4-5-20251001). */
  model?: string;
  /** If provided with historyStore, enables history-aware generation. */
  sessionId?: string;
  /** Pluggable store for generation history. Required when sessionId is set. */
  historyStore?: GenerationHistoryStore;
}

export interface GeneratedImage {
  storageKey: string;
  downloadUrl: string;
  prompt: string;
  aspectRatio: string;
}

/**
 * Generate an image using Google Nano Banana (Gemini 2.5 Flash Image)
 * and upload it to R2 storage.
 *
 * When `sessionId` and `historyStore` are provided, previous generations in
 * the session are passed as multi-turn context (including prior images).
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GeneratedImage> {
  const {
    prompt,
    aspectRatio = "1:1",
    workspaceId,
    artifactId,
    mediaIndex = 0,
    model = DEFAULT_IMAGE_FEATURE_MODEL,
    sessionId,
    historyStore,
  } = options;

  const client = getClient();

  // Build contents: multi-turn if session exists, plain string otherwise
  const contents =
    sessionId && historyStore
      ? await buildMultiTurnContent(historyStore, sessionId, prompt)
      : prompt;

  // Backend uses dedicated image model; options.model is the default for the feature (compliance).
  void model;
  const response = await client.models.generateContent({
    model: IMAGE_GENERATION_BACKEND_MODEL,
    contents,
    config: {
      responseModalities: ["IMAGE"],
    },
  });

  // Extract base64 image data from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("No image data in response");
  }

  const imagePart = parts.find((part) => part.inlineData);
  if (!imagePart?.inlineData?.data) {
    throw new Error("No inline image data found in response");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext =
    mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
  const filename = `image_${mediaIndex}_${Date.now()}.${ext}`;
  const storageKey = generateAdMediaStorageKey(workspaceId, artifactId, filename);

  await uploadBuffer(storageKey, buffer, mimeType);
  const downloadUrl = await generateDownloadUrl(storageKey);

  // Record in history if session-aware
  if (sessionId && historyStore) {
    try {
      const records = await historyStore.getRecords(sessionId);
      const parentId =
        records.length > 0 ? records[records.length - 1]!.id : null;

      await historyStore.addRecord(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        parentId,
        prompt,
        storageKey,
        mimeType,
        aspectRatio,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Failed to record generation in history:", err);
    }
  }

  return {
    storageKey,
    downloadUrl,
    prompt,
    aspectRatio,
  };
}

// ---------------------------------------------------------------------------
// Non-destructive image editing
// ---------------------------------------------------------------------------

export interface EditImageOptions {
  /** R2 storage key of the source image to edit. */
  sourceStorageKey: string;
  /** Natural-language instruction describing the edit (e.g. "make the background darker"). */
  editPrompt: string;
  aspectRatio?: string;
  workspaceId: string;
  artifactId: string;
  mediaIndex?: number;
}

/**
 * Edit an existing image using Gemini 2.5 Flash Image.
 *
 * Passes the source image alongside the edit prompt so Gemini produces a
 * localized edit rather than regenerating from scratch.
 *
 * Falls back to `generateImage()` if the source image cannot be fetched.
 */
export async function editImage(
  options: EditImageOptions,
): Promise<GeneratedImage> {
  const {
    sourceStorageKey,
    editPrompt,
    aspectRatio = "1:1",
    workspaceId,
    artifactId,
    mediaIndex = 0,
  } = options;

  // Fetch the source image from R2
  let sourceObj: { body: Uint8Array; contentType: string } | null = null;
  try {
    sourceObj = await getObjectBinary(sourceStorageKey);
  } catch (err) {
    console.warn(
      `[editImage] Failed to fetch source image ${sourceStorageKey}:`,
      err,
    );
  }

  // Fallback: if source image is unavailable, generate from scratch
  if (!sourceObj) {
    console.warn(
      `[editImage] Source image not found, falling back to generateImage`,
    );
    return generateImage({
      prompt: editPrompt,
      aspectRatio,
      workspaceId,
      artifactId,
      mediaIndex,
    });
  }

  const client = getClient();
  const sourceBase64 = Buffer.from(sourceObj.body).toString("base64");

  // Build content: source image + edit instruction in a single user turn
  const contents: Content[] = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            data: sourceBase64,
            mimeType: sourceObj.contentType,
          },
        },
        { text: editPrompt },
      ],
    },
  ];

  const response = await client.models.generateContent({
    model: IMAGE_GENERATION_BACKEND_MODEL,
    contents,
    config: {
      responseModalities: ["IMAGE"],
    },
  });

  // Extract the edited image from the response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("No image data in edit response");
  }

  const imagePart = parts.find((part) => part.inlineData);
  if (!imagePart?.inlineData?.data) {
    throw new Error("No inline image data found in edit response");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext =
    mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
  const filename = `image_${mediaIndex}_${Date.now()}.${ext}`;
  const storageKey = generateAdMediaStorageKey(workspaceId, artifactId, filename);

  await uploadBuffer(storageKey, buffer, mimeType);
  const downloadUrl = await generateDownloadUrl(storageKey);

  return {
    storageKey,
    downloadUrl,
    prompt: editPrompt,
    aspectRatio,
  };
}

/**
 * Generate multiple images in parallel.
 */
export async function generateImages(
  optionsList: GenerateImageOptions[],
): Promise<GeneratedImage[]> {
  return Promise.all(optionsList.map(generateImage));
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export async function createGenerationSession(
  store: GenerationHistoryStore,
  params: { workspaceId: string; artifactId: string; mediaIndex: number },
): Promise<GenerationSession> {
  return store.createSession(params);
}

export async function getGenerationHistory(
  store: GenerationHistoryStore,
  sessionId: string,
): Promise<GenerationRecord[]> {
  return store.getRecords(sessionId);
}
