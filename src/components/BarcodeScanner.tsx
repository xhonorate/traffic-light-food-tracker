import { useCallback, useEffect, useRef, useState } from "react";
import { prepareZXingModule } from "zxing-wasm/reader";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { scanPhoto, scanVideoFrame } from "../lib/barcode";
import { Banner, Button, Field, Input, Spinner } from "./ui";

// Serve the decoder's WASM from this site rather than the library's default
// CDN, so scanning does not depend on a third party being up.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? zxingWasmUrl : prefix + path,
  },
});

/** Pause between decode attempts. Decoding itself sets the real pace on a
 *  slow phone, since the next attempt waits for the last to finish. */
const SCAN_INTERVAL_MS = 100;

type Status = "starting" | "scanning" | "stopped" | "failed" | "reading-photo";

/** Camera capabilities TypeScript's DOM types do not list yet. */
interface ExtraCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number };
  focusMode?: string[];
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "The camera only works over a secure (https) connection. Take a photo or type the number instead.";
  }
  if (name === "NotAllowedError") {
    return "Camera permission was denied. Allow it in your browser settings, or take a photo or type the number instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Type the barcode number instead.";
  }
  if (name === "NotReadableError") {
    return "The camera is being used by another app. Close it and try again, or take a photo instead.";
  }
  return "The camera could not be started here. Take a photo or type the number instead.";
}

/**
 * Barcode scanner with three ways in, because cameras fail for mundane
 * reasons and a phone's live preview is the least reliable of them:
 *
 * 1. Live scan -- continuous, no button to press.
 * 2. Take a photo -- the phone's own camera app, with its proper autofocus and
 *    macro lens. The dependable route on iPhones, where the browser's live
 *    camera often cannot focus close up.
 * 3. Type the number printed under the bars.
 */
export default function BarcodeScanner({
  onDetected, onCancel,
}: { onDetected: (code: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The parent passes a fresh callback on every render; restarting the camera
  // for that would make it flicker off and on.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const doneRef = useRef(false);

  const finish = useCallback((code: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    trackRef.current?.stop();
    navigator.vibrate?.(60);
    onDetectedRef.current(code);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");

    const scan = async () => {
      if (cancelled || doneRef.current) return;
      const video = videoRef.current;
      if (video && !document.hidden) {
        try {
          const code = await scanVideoFrame(video, canvas);
          if (code && !cancelled) {
            finish(code);
            return;
          }
        } catch {
          // A frame that fails to decode is no different from an empty one.
        }
      }
      if (!cancelled) timer = setTimeout(scan, SCAN_INTERVAL_MS);
    };

    // Mobile browsers pause the preview while the page is hidden -- including
    // while the camera app is open for a photo -- and do not always resume it.
    const onVisible = () => {
      const video = videoRef.current;
      if (!document.hidden && video?.srcObject && video.paused) {
        video.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      setStatus("starting");
      setMessage(null);
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("insecure");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            // The browser default is often 640x480, too coarse to resolve
            // the thin bars of a barcode more than a hand's width away.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        // iOS ends the stream when the camera app opens for a photo.
        track.addEventListener("ended", () => {
          if (!cancelled && !doneRef.current) setStatus("stopped");
        });

        const caps = (track.getCapabilities?.() ?? {}) as ExtraCapabilities;
        const advanced: Record<string, unknown>[] = [];
        if (caps.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
        // A little zoom lets the phone be held far enough away to focus
        // while the barcode still fills the frame.
        if (caps.zoom && caps.zoom.max >= 1.5) {
          advanced.push({ zoom: Math.min(2, caps.zoom.max) });
        }
        if (advanced.length) {
          await track
            .applyConstraints({ advanced } as MediaTrackConstraints)
            .catch(() => undefined);
        }
        setTorch(caps.torch ? false : null);

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (cancelled) return;
        setStatus("scanning");
        void scan();
      } catch (e) {
        if (cancelled) return;
        setStatus("failed");
        setMessage(cameraError(e));
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [attempt, finish]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || torch === null) return;
    const next = !torch;
    try {
      const torchOn: Record<string, unknown> = { torch: next };
      await track.applyConstraints({ advanced: [torchOn] } as MediaTrackConstraints);
      setTorch(next);
    } catch {
      setTorch(null);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoMessage(null);
    const before = status;
    setStatus("reading-photo");
    try {
      const code = await scanPhoto(file);
      if (code) {
        finish(code);
        return;
      }
      setPhotoMessage(
        "No barcode found in that photo. Fill most of the picture with the barcode, keep it flat and sharp, and try again — or type the number below.",
      );
    } catch {
      setPhotoMessage("That photo could not be read. Try again, or type the number below.");
    } finally {
      if (photoRef.current) photoRef.current.value = "";
    }
    // Resume whatever the live camera was doing; iOS may have ended it.
    const live = trackRef.current?.readyState === "live";
    setStatus(before === "failed" ? "failed" : live ? "scanning" : "stopped");
  };

  const showVideo = status !== "failed";

  return (
    <div className="space-y-4">
      {showVideo && (
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-900">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 size-full object-cover"
          />

          {/* Aiming guide. The whole frame is decoded, so this is a hint
              about distance, not a region the barcode must sit inside. */}
          {status === "scanning" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[40%] -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
            >
              <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse rounded bg-rose-500/80" />
            </div>
          )}

          {(status === "starting" || status === "reading-photo") && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="flex items-center gap-2 rounded-full bg-slate-900/70 px-3 py-1.5 text-sm text-white">
                <Spinner className="size-4" />
                {status === "starting" ? "Starting camera…" : "Reading photo…"}
              </span>
            </div>
          )}

          {status === "stopped" && (
            <div className="absolute inset-0 grid place-items-center">
              <Button onClick={() => setAttempt((n) => n + 1)}>Restart camera</Button>
            </div>
          )}

          {status === "scanning" && torch !== null && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch}
              className="tap absolute right-2 bottom-2 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-white"
            >
              {torch ? "Light off" : "Light on"}
            </button>
          )}
        </div>
      )}

      {status === "scanning" && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Hold the phone about a hand&rsquo;s length away with the barcode across
          the box. It reads on its own — no button needed.
        </p>
      )}
      {status === "failed" && message && <Banner tone="warn">{message}</Banner>}
      {photoMessage && <Banner tone="warn">{photoMessage}</Banner>}

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPhoto(e.target.files?.[0])}
      />
      <Button
        full
        size="lg"
        onClick={() => photoRef.current?.click()}
        disabled={status === "reading-photo"}
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path
            d="M3 6.5A1.5 1.5 0 0 1 4.5 5h1.8l1.2-1.5h5L13.7 5h1.8A1.5 1.5 0 0 1 17 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-8Z"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10.5" r="3" />
        </svg>
        Take a photo of the barcode
      </Button>

      <form
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) finish(manual.trim()); }}
        className="space-y-2"
      >
        <Field label="Or type the number under the barcode">
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
