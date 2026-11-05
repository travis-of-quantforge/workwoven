import { it, expect } from "vitest";
import { safeFilename, validateUpload } from "../src/lib/uploads";
it("removes path, control and bidi tricks from names", () => {
  expect(safeFilename("../private/report\u202etxt.pdf")).toBe("report_txt.pdf");
  expect(safeFilename("C:\\private\\report.csv")).toBe("report.csv");
});
it("rejects spoofed images and PDFs", () => {
  const html = new TextEncoder().encode("<script>bad()</script>");
  for (const mime of ["image/png", "image/jpeg", "application/pdf"])
    expect(validateUpload(html, mime)).not.toBeNull();
});
it("accepts supported signatures and UTF-8 text", () => {
  expect(
    validateUpload(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  ).toBeNull();
  expect(
    validateUpload(
      new TextEncoder().encode("region,revenue\nSouth,1200"),
      "text/csv",
    ),
  ).toBeNull();
});
it("rejects binary text, unsupported types and empty files", () => {
  expect(
    validateUpload(new Uint8Array([0, 1, 2]), "text/plain"),
  ).not.toBeNull();
  expect(validateUpload(new Uint8Array([255]), "text/csv")).not.toBeNull();
  expect(validateUpload(new Uint8Array([1]), "text/html")).not.toBeNull();
  expect(validateUpload(new Uint8Array(), "text/plain")).not.toBeNull();
});
