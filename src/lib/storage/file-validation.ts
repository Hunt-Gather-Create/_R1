// Maximum file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed MIME types
export const ALLOWED_MIME_TYPES = {
  // Images
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  // PDF
  "application/pdf": [".pdf"],
  // Office documents
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MIME_TYPES;

// Image types for preview purposes
const IMAGE_TYPES: AllowedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// PDF type
const PDF_TYPES: AllowedMimeType[] = ["application/pdf"];

/**
 * Check if a MIME type is allowed
 */
export function isAllowedMimeType(
  mimeType: string
): mimeType is AllowedMimeType {
  return mimeType in ALLOWED_MIME_TYPES;
}

/**
 * Check if a MIME type is an image
 */
export function isImageType(mimeType: string): boolean {
  return IMAGE_TYPES.includes(mimeType as AllowedMimeType);
}

/**
 * Check if a MIME type is a PDF
 */
export function isPdfType(mimeType: string): boolean {
  return PDF_TYPES.includes(mimeType as AllowedMimeType);
}

/**
 * Check if a MIME type is a document (Word/Excel)
 */
export function isDocumentType(mimeType: string): boolean {
  return (
    isAllowedMimeType(mimeType) && !isImageType(mimeType) && !isPdfType(mimeType)
  );
}

/**
 * Get allowed extensions as a string for file input accept attribute
 */
export function getAllowedExtensions(): string {
  const extensions = Object.values(ALLOWED_MIME_TYPES).flat();
  return extensions.join(",");
}

/**
 * Get allowed MIME types as a string for file input accept attribute
 */
export function getAllowedMimeTypesString(): string {
  return Object.keys(ALLOWED_MIME_TYPES).join(",");
}

/**
 * Validate a file for upload
 * Returns an error message if invalid, null if valid
 */
export function validateFile(file: {
  type: string;
  size: number;
  name: string;
}): string | null {
  // Check MIME type
  if (!isAllowedMimeType(file.type)) {
    return `File type "${file.type}" is not allowed. Allowed types: images, PDFs, and Office documents.`;
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const maxMB = MAX_FILE_SIZE / (1024 * 1024);
    const fileMB = (file.size / (1024 * 1024)).toFixed(1);
    return `File size (${fileMB}MB) exceeds the maximum allowed size of ${maxMB}MB.`;
  }

  return null;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}
