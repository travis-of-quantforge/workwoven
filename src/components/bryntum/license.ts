// Must execute before any dynamically loaded Bryntum component is constructed.
export function registerBryntumLicense() {
  const key = process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY;
  if (!key) throw new Error("Bryntum licence is not configured.");
  const runtime = globalThis as typeof globalThis & {
    bryntum?: { licenseKey?: string };
  };
  (runtime.bryntum ??= {}).licenseKey = key;
}
