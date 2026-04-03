import { spawn } from "child_process";
import { platform } from "os";

function trySpawn(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const os = platform();

  if (os === "win32") return trySpawn("clip", [], text);
  if (os === "darwin") return trySpawn("pbcopy", [], text);

  // Linux: try xclip, fall back to xsel
  const ok = await trySpawn("xclip", ["-selection", "clipboard"], text);
  if (ok) return true;
  return trySpawn("xsel", ["--clipboard", "--input"], text);
}
