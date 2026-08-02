import { Capacitor } from "@capacitor/core";

export async function openProtectedBlob(blob: Blob, fileName: string): Promise<void> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "staff-file";
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (blob.size > 20 * 1024 * 1024) throw new Error("Files larger than 20 MB cannot be shared from Staff App.");
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  const path = `secure-share/${crypto.randomUUID()}-${safeName}`;
  const saved = await Filesystem.writeFile({ path, directory: Directory.Cache, data: btoa(binary), recursive: true });
  try { await Share.share({ title: safeName, files: [saved.uri] }); }
  finally { await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined); }
}
