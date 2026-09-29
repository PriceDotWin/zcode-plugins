import type { SkipReason } from "#cleaner/contract.ts";

const POSIX_SYSTEM = ["/bin", "/sbin", "/usr", "/etc", "/var", "/dev", "/opt"];
const SYSTEM_ROOTS: Record<string, string[]> = {
  darwin: [...POSIX_SYSTEM, "/System", "/Library", "/private", "/cores", "/Applications"],
  linux: [
    ...POSIX_SYSTEM,
    "/boot",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    "/proc",
    "/run",
    "/sys",
    "/snap",
    "/srv",
    "/root",
    "/lost+found",
  ],
};
const WINDOWS_SYSTEM = [
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "recovery",
  "system volume information",
  "$recycle.bin",
];
/** 相对用户目录的应用数据、凭据与回收站。 */
const HOME_PROTECTED: Record<string, string[]> = {
  darwin: ["Library", ".Trash"],
  linux: [".local/share/Trash"],
  win32: ["AppData"],
};
/** 系统目录下由用户进程写入的临时目录，允许分析与移入回收站（优先于保护规则）。 */
const TEMP_ALLOWED: Record<string, string[]> = {
  darwin: ["/private/var/folders", "/var/folders", "/private/tmp"],
  linux: ["/var/tmp"],
};
const HOME_TEMP_ALLOWED: Record<string, string[]> = { win32: ["AppData/Local/Temp"] };
const HOME_CREDENTIALS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".password-store",
  ".zcode",
];
/** 任意层级出现即受保护：版本库元数据、凭据目录、回收站。 */
const PROTECTED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".bzr",
  ".ssh",
  ".gnupg",
  ".trash",
  ".trashes",
  "$recycle.bin",
]);
const MAC_PACKAGES = /\.(app|photoslibrary|framework|bundle|musiclibrary|tvlibrary)$/i;

export interface Protection {
  /** 规范绝对路径本身或任一祖先受保护；显式路径与执行复核共用。 */
  isProtected(path: string): boolean;
  /** 枚举时对单个目录项的跳过判断（符号链接与挂载点由 adapter 依据 lstat 判断）。 */
  skipEntry(path: string, name: string, isDirectory: boolean): SkipReason | null;
}

export function createProtection({
  platform,
  home,
}: {
  platform: string;
  home: string;
}): Protection {
  const windows = platform === "win32";
  const fold = (value: string) => (windows || platform === "darwin" ? value.toLowerCase() : value);
  const split = (path: string) =>
    fold(path)
      .split(/[\\/]+/)
      .filter(Boolean);
  const join = (base: string, rel: string) => [...split(base), ...split(rel)];
  const roots: string[][] = [
    ...(SYSTEM_ROOTS[platform] ?? []).map((root) => split(root)),
    ...(HOME_PROTECTED[platform] ?? []).map((rel) => join(home, rel)),
    ...HOME_CREDENTIALS.map((rel) => join(home, rel)),
  ];
  const allowed = [
    ...(TEMP_ALLOWED[platform] ?? []).map((root) => split(root)),
    ...(HOME_TEMP_ALLOWED[platform] ?? []).map((rel) => join(home, rel)),
  ];
  const startsWith = (segments: string[], prefix: string[]) =>
    prefix.length <= segments.length && prefix.every((part, i) => segments[i] === part);
  const blockedName = (name: string) =>
    PROTECTED_NAMES.has(name.toLowerCase()) || (platform === "darwin" && MAC_PACKAGES.test(name));
  const isProtected = (path: string) => {
    if (path.split(/[\\/]+/).some((name) => name && blockedName(name))) return true;
    const segments = split(path);
    if (allowed.some((root) => startsWith(segments, root))) return false;
    if (windows && segments.length > 1 && WINDOWS_SYSTEM.includes(segments[1]!)) return true;
    return roots.some((root) => startsWith(segments, root));
  };
  return {
    isProtected,
    skipEntry(path, name, isDirectory) {
      if (isDirectory && platform === "darwin" && MAC_PACKAGES.test(name)) return "package";
      return isProtected(path) ? "protected" : null;
    },
  };
}
