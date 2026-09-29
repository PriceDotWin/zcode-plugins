import { lstat, opendir, realpath, stat, statfs } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CleanerError, LIMITS, type ScanSummary } from "#cleaner/contract.ts";
import type { Inspection, WalkInput } from "#cleaner/app/cleaner.ts";

const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const denied = (error: unknown) => code(error) === "EACCES" || code(error) === "EPERM";
type BigStats = Awaited<ReturnType<typeof lstatBig>>;
const lstatBig = (path: string) => lstat(path, { bigint: true });
/** bigint stat → 指纹；Windows 的 64 位文件 ID 与纳秒时间按字符串精确比较。 */
const fingerprintOf = (info: BigStats) => ({
  dev: info.dev.toString(),
  ino: info.ino.toString(),
  size: Number(info.size),
  mtimeNs: info.mtimeNs.toString(),
  ctimeNs: info.ctimeNs.toString(),
  nlink: Number(info.nlink),
});

export function createFileSystem(home: string) {
  return {
    parentOf: dirname,
    async resolveRoot(input: string) {
      const trimmed = input.trim();
      const expanded =
        trimmed === "~" ? home : /^~[\\/]/.test(trimmed) ? join(home, trimmed.slice(2)) : trimmed;
      if (!expanded || !isAbsolute(expanded))
        throw new CleanerError("invalid_input", "Use an absolute path or a path starting with ~");
      let real: string;
      try {
        real = await realpath(resolve(expanded));
      } catch (error) {
        if (denied(error)) throw new CleanerError("not_found", "Permission denied");
        throw new CleanerError("not_found", "Directory does not exist");
      }
      if (!(await stat(real)).isDirectory())
        throw new CleanerError("not_directory", "Path is not a directory");
      return real;
    },
    /** 有界、只读的迭代枚举：lstat 不跟随链接，跨设备与受保护目录不进入。 */
    async walk({ root, aggregator, protection, signal, deadline }: WalkInput) {
      const rootDev = (await lstatBig(root)).dev;
      const stack: Array<{ dir: string; segments: string[] }> = [{ dir: root, segments: [] }];
      let entries = 0;
      while (stack.length > 0) {
        const { dir, segments } = stack.pop()!;
        let handle;
        try {
          handle = await opendir(dir);
        } catch (error) {
          aggregator.skip(denied(error) ? "denied" : "error");
          if (denied(error)) aggregator.partial("denied");
          continue;
        }
        try {
          for await (const entry of handle) {
            if (signal.aborted) return;
            if (++entries > LIMITS.maxEntries) return aggregator.partial("entryLimit");
            if (Date.now() > deadline) return aggregator.partial("timeLimit");
            const path = join(dir, entry.name);
            let info;
            try {
              info = await lstatBig(path);
            } catch (error) {
              aggregator.skip(denied(error) ? "denied" : "error");
              continue;
            }
            if (info.isSymbolicLink()) {
              aggregator.skip("symlink");
              continue;
            }
            const isDirectory = info.isDirectory();
            if (!isDirectory && !info.isFile()) continue;
            const reason = protection.skipEntry(path, entry.name, isDirectory);
            if (reason) {
              aggregator.skip(reason);
              continue;
            }
            if (isDirectory) {
              if (info.dev !== rootDev) aggregator.skip("mount");
              else if (segments.length + 1 >= LIMITS.maxDepth) aggregator.partial("depthLimit");
              else stack.push({ dir: path, segments: [...segments, entry.name] });
              continue;
            }
            aggregator.add({
              path,
              name: entry.name,
              segments,
              mtimeMs: Number(info.mtimeMs),
              ...fingerprintOf(info),
            });
          }
        } catch (error) {
          // 枚举中途目录被删除或失去权限：记为部分结果，继续其余目录。
          aggregator.skip(denied(error) ? "denied" : "error");
          if (denied(error)) aggregator.partial("denied");
        }
      }
    },
    async volume(root: string): Promise<ScanSummary["volume"]> {
      const info = await statfs(root);
      return { totalBytes: info.blocks * info.bsize, freeBytes: info.bavail * info.bsize };
    },
    async inspect(path: string): Promise<Inspection | null> {
      try {
        const info = await lstatBig(path);
        return {
          parentReal: await realpath(dirname(path)),
          isFile: info.isFile() && !info.isSymbolicLink(),
          ...fingerprintOf(info),
        };
      } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return null;
        throw error;
      }
    },
  };
}
