import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Banner, Button, Field, Input } from "./ui";

/** Product barcodes only -- restricting formats speeds up decoding a lot. */
const FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
];

/**
 * Camera barcode scanner with a typed-entry fallback. Cameras fail for many
 * mundane reasons -- denied permission, no HTTPS, an in-app browser, a laptop
 * with no rear camera -- so manual entry is always offered rather than being
 * a hidden last resort.
 */
export default function BarcodeScanner({
  onDetected, onCancel,
}: { onDetected: (code: string) => void; onCancel: () => void }) {
  const regionId = useId().replace(/:/g, "");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "failed">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode(regionId, { formatsToSupport: FORMATS, verbose: false });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.4 },
        (text) => {
          if (cancelled) return;
          cancelled = true;
          // Stop before handing off so the camera light goes out immediately.
          scanner.stop().catch(() => { /* already stopping */ });
          onDetected(text.trim());
        },
        () => { /* per-frame decode misses are normal; ignore */ },
      )
      .then(() => { if (!cancelled) setStatus("scanning"); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("failed");
        const name = (e as { name?: string })?.name ?? "";
        setMessage(
          name === "NotAllowedError"
            ? "Camera permission was denied. You can allow it in your browser settings, or type the barcode below."
            : name === "NotFoundError"
              ? "No camera was found on this device. Type the barcode below instead."
              : "The camera could not be started here. Type the barcode below instead.",
        );
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s?.isScanning) s.stop().catch(() => { /* ignore */ });
      scannerRef.current = null;
    };
  }, [regionId, onDetected]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl bg-slate-900">
        <div id={regionId} className="min-h-52 [&_video]:w-full [&_video]:object-cover" />
      </div>

      {status === "starting" && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Starting camera…</p>
      )}
      {status === "scanning" && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Hold the barcode inside the box.
        </p>
      )}
      {status === "failed" && message && <Banner tone="warn">{message}</Banner>}

      <form
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onDetected(manual.trim()); }}
        className="space-y-2"
      >
        <Field label="Or type the barcode number">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 038000138416"
            autoFocus={status === "failed"}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="button" full onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" full disabled={manual.trim().length < 6}>
            Look up
          </Button>
        </div>
      </form>
    </div>
  );
}
