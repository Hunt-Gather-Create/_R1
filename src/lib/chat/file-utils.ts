/**
 * Supported media types that can be sent as file attachments to the AI.
 * Images and PDFs are sent as attachments; other files have their content read as text.
 */
export const SUPPORTED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

/**
 * Check if a file type is supported as a direct attachment
 */
export function isSupportedAttachmentType(mimeType: string): boolean {
  // Check for exact matches first (like application/pdf)
  if (SUPPORTED_ATTACHMENT_TYPES.includes(mimeType)) {
    return true;
  }
  // Check if it's an image type (any image/* is supported)
  return mimeType.startsWith("image/");
}

/**
 * Convert a File to a data URL string
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Prepare files for sending to the AI.
 * - Supported types (images, PDFs) are converted to FileUIPart format
 * - Text files have their content read and appended to the message
 */
export async function prepareFilesForSubmission(
  files: File[],
  inputText: string
): Promise<{
  messageText: string;
  fileAttachments: Array<{
    type: "file";
    filename: string;
    mediaType: string;
    url: string;
  }>;
}> {
  const imageFiles = files.filter((f) => isSupportedAttachmentType(f.type));
  const textFiles = files.filter((f) => !isSupportedAttachmentType(f.type));

  // Convert supported files to FileUIPart format
  const fileAttachments = await Promise.all(
    imageFiles.map(async (file) => ({
      type: "file" as const,
      filename: file.name,
      mediaType: file.type,
      url: await fileToDataUrl(file),
    }))
  );

  // Read text files and append their content to the message
  let messageText = inputText;
  if (textFiles.length > 0) {
    const textContents = await Promise.all(
      textFiles.map(async (file) => {
        const content = await file.text();
        return `\n\n--- ${file.name} ---\n${content}`;
      })
    );
    messageText = inputText + textContents.join("");
  }

  return { messageText, fileAttachments };
}
