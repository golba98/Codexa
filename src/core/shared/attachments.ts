import { access, copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeDiagnosticPath } from "../workspace/workspaceGuard.js";

export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".svg",
]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveAttachmentDestPath(
  srcPath: string,
  attachmentsDir: string,
): Promise<string> {
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  let dest = path.join(attachmentsDir, `${base}${ext}`);
  let counter = 1;
  while (await fileExists(dest)) {
    dest = path.join(attachmentsDir, `${base}-${counter}${ext}`);
    counter++;
  }
  return dest;
}

export async function importExternalFile(
  srcPath: string,
  attachmentsDir: string,
): Promise<string | null> {
  const normalized = normalizeDiagnosticPath(srcPath);

  try {
    if (!existsSync(normalized)) {
      return null;
    }
    const s = await stat(normalized);
    if (!s.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  if (normalized.includes(".cargo/registry") || normalized.includes(".cargo" + path.sep + "registry")) {
    return null;
  }

  await mkdir(attachmentsDir, { recursive: true });
  const destPath = await resolveAttachmentDestPath(normalized, attachmentsDir);
  await copyFile(normalized, destPath);
  return destPath;
}

export function rewritePromptWithImportedPaths(
  prompt: string,
  replacements: Array<{ rawPath: string; workspaceRelativePath: string }>,
): string {
  let result = prompt;
  for (const { rawPath, workspaceRelativePath } of replacements) {
    const needsQuotes = /\s/.test(workspaceRelativePath);
    const quotedReplacement = needsQuotes
      ? `"${workspaceRelativePath}"`
      : workspaceRelativePath;
    // Replace quoted forms first so the unquoted pass doesn't double-replace
    result = result.split(`"${rawPath}"`).join(quotedReplacement);
    result = result.split(`'${rawPath}'`).join(quotedReplacement);
    // Replace any remaining unquoted occurrences
    result = result.split(rawPath).join(quotedReplacement);
  }
  return result;
}
