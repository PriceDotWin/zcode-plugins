import type { FileCategory } from "#cleaner/contract.ts";

const EXTENSIONS: Array<[FileCategory, string[]]> = [
  ["video", ["mp4", "mov", "mkv", "avi", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "3gp"]],
  [
    "image",
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "heic",
      "heif",
      "webp",
      "tiff",
      "tif",
      "bmp",
      "raw",
      "cr2",
      "nef",
      "arw",
      "psd",
    ],
  ],
  ["audio", ["mp3", "wav", "flac", "aac", "m4a", "ogg", "aiff", "wma"]],
  ["archive", ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "lz4"]],
  [
    "diskImage",
    ["iso", "img", "vmdk", "vdi", "qcow2", "vhd", "vhdx", "sparseimage", "sparsebundle"],
  ],
  ["installer", ["dmg", "pkg", "msi", "exe", "deb", "rpm", "appimage", "apk", "ipa", "xip"]],
  [
    "document",
    [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "key",
      "pages",
      "numbers",
      "txt",
      "csv",
      "epub",
    ],
  ],
  [
    "code",
    ["jar", "war", "whl", "node", "so", "dylib", "dll", "o", "a", "wasm", "pack", "sqlite", "db"],
  ],
  ["log", ["log", "trace", "dmp", "crash"]],
];
const BY_EXTENSION = new Map(
  EXTENSIONS.flatMap(([category, list]) => list.map((ext) => [ext, category] as const)),
);
const CACHE_SEGMENTS = new Set([
  "cache",
  "caches",
  ".cache",
  "__pycache__",
  ".gradle",
  ".npm",
  ".pnpm-store",
  "deriveddata",
  ".next",
  ".turbo",
  "node_modules",
]);

/** 仅按文件名与所在路径段分类，不读取内容。 */
export function categoryOf(name: string, segments: readonly string[]): FileCategory {
  if (segments.some((s) => CACHE_SEGMENTS.has(s.toLowerCase()))) return "cache";
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "other";
  const ext = lower.slice(dot + 1);
  if (/\.log\.\d+$/.test(lower)) return "log";
  return BY_EXTENSION.get(ext) ?? "other";
}
