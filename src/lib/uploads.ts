export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const allowed = new Set([
  "text/plain",
  "text/csv",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
export function safeFilename(name: string) {
  return (
    (name.split(/[\\/]/).at(-1) || "attachment")
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "_")
      .trim()
      .slice(0, 200) || "attachment"
  );
}
export function validateUpload(bytes: Uint8Array, mime: string) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES)
    return "Choose a file up to 20 MB.";
  if (!allowed.has(mime))
    return "Supported files are UTF-8 text/CSV, PDF, PNG and JPEG.";
  const starts = (signature: number[]) =>
    signature.every((b, i) => bytes[i] === b);
  if (mime === "image/png" && !starts([137, 80, 78, 71, 13, 10, 26, 10]))
    return "This file does not have a valid PNG signature.";
  if (mime === "image/jpeg" && !starts([255, 216, 255]))
    return "This file does not have a valid JPEG signature.";
  if (mime === "application/pdf" && !starts([37, 80, 68, 70, 45]))
    return "This file does not have a valid PDF signature.";
  if (mime === "text/plain" || mime === "text/csv") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return "Text and CSV files must use UTF-8 encoding.";
    }
    if (bytes.includes(0))
      return "Text files cannot contain binary null bytes.";
  }
  return null;
}
