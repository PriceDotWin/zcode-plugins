import { execFile } from "node:child_process";
import { access, constants, mkdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);
const PATH_ENV = "ZCODE_DISK_CLEANER_PATH";

/** 固定脚本，路径只经环境变量传入，不拼接进命令行。 */
const MAC_SCRIPT = `ObjC.import("Foundation");
const path = $.NSProcessInfo.processInfo.environment.objectForKey("${PATH_ENV}").js;
const error = Ref();
const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(path), null, error);
if (!ok) throw new Error(error[0] ? error[0].localizedDescription.js : "Move to Trash failed");`;
// SendToRecycleBin 在网络盘等没有回收站的卷上会直接永久删除，所以只允许本地固定盘。
const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
$path = $env:${PATH_ENV}
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($path))
if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { throw "Recycle Bin is only used on local fixed drives" }
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`;

export interface Trash {
  available: boolean;
  /** 移入系统回收站；失败时抛错，绝不降级为永久删除。 */
  trash(path: string): Promise<void>;
}

const withPath = (path: string) => ({
  env: { ...process.env, [PATH_ENV]: path },
  windowsHide: true,
});
const works = (promise: Promise<unknown>) =>
  promise.then(
    () => true,
    () => false,
  );

export async function createTrash(platform: string, testDir?: string): Promise<Trash> {
  if (testDir) {
    // 仅供自动化测试：移入隔离目录，永远不接触用户真实回收站。
    await mkdir(testDir, { recursive: true });
    return {
      available: true,
      trash: (path) => rename(path, join(testDir, `${randomUUID()}-${basename(path)}`)),
    };
  }
  if (platform === "darwin")
    return {
      available: await works(access("/usr/bin/osascript", constants.X_OK)),
      trash: async (path) => {
        await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_SCRIPT], withPath(path));
      },
    };
  if (platform === "win32")
    return {
      available: await works(
        run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
          windowsHide: true,
        }),
      ),
      trash: async (path) => {
        await run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
          withPath(path),
        );
      },
    };
  if (platform === "linux")
    return {
      available: await works(run("gio", ["--version"])),
      trash: async (path) => {
        await run("gio", ["trash", "--", path]);
      },
    };
  return {
    available: false,
    trash: async () => {
      throw new Error("Trash is not supported on this platform");
    },
  };
}
