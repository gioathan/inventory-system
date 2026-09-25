"use client";

import type { IScannerControls } from "@zxing/browser";
import { CameraOff, Loader2, SwitchCamera, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "starting" | "live" | "error";
type Facing = "environment" | "user";

// The camera API only exists in a secure context (HTTPS or localhost). On a phone reaching the
// dev machine by LAN IP over plain http it silently doesn't exist, which is far more confusing
// than a clear message.
function cameraSupportProblem(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) {
    return "The camera needs a secure (HTTPS) connection. You can still type or scan a code with a hardware scanner.";
  }
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't use the camera.";
  return null;
}

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "Camera access was blocked. Allow it in your browser's site settings, or type the code instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  return "Couldn't start the camera. You can still type or scan a code.";
}

interface CameraScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function CameraScanner({ onScan, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  const [problem] = useState(cameraSupportProblem);
  const [facing, setFacing] = useState<Facing>("environment");
  const [status, setStatus] = useState<Status>(problem ? "error" : "starting");
  const [error, setError] = useState<string | null>(problem);
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  useEffect(() => {
    if (problem) return;

    // Set when this effect is torn down. Starting the camera is async, so it can finish *after*
    // cleanup (React strict mode mounts, unmounts and remounts in dev; a user can also close
    // the panel mid-start). Without this the stream would be left running with nothing owning it.
    let cancelled = false;
    let controls: IScannerControls | undefined;
    let lastCode = "";
    let lastAt = 0;

    (async () => {
      try {
        // Loaded on demand: the decoder is large and only needed once someone opens the camera.
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled) return;

        // Restricting to the formats we actually print or expect makes decoding faster and
        // avoids false positives from patterns that merely resemble exotic symbologies.
        const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.CODE_128,
              BarcodeFormat.CODE_39,
              BarcodeFormat.EAN_13,
              BarcodeFormat.EAN_8,
              BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E,
              BarcodeFormat.QR_CODE,
            ],
          ],
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });

        controls = await reader.decodeFromConstraints(
          { video: { facingMode: facing }, audio: false },
          videoRef.current ?? undefined,
          (result) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            // The same label stays in frame for many frames; report it once, not once per frame.
            if (code === lastCode && now - lastAt < 2000) return;
            lastCode = code;
            lastAt = now;
            onScanRef.current(code);
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;

        // ZXing only attaches switchTorch when the stream's track actually supports a torch, so its
        // presence is the capability check (its own typings for the capability getters are wrong).
        setTorch({ supported: typeof controls.switchTorch === "function", on: false });
        setStatus("live");

        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setHasMultipleCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(describeCameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
      controlsRef.current = null;
    };
  }, [facing, problem]);

  function flipCamera() {
    setStatus("starting");
    setFacing((current) => (current === "environment" ? "user" : "environment"));
  }

  async function toggleTorch() {
    const next = !torch.on;
    try {
      await controlsRef.current?.switchTorch?.(next);
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  return (
    <div className="relative aspect-[2/1] min-h-40 w-full overflow-hidden rounded-xl border bg-black sm:aspect-video">
      {/* playsInline matters on iOS: without it the stream tries to go fullscreen. */}
      <video ref={videoRef} muted playsInline className={cn("size-full object-cover", status !== "live" && "opacity-0")} />

      {status === "live" && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-1/2 w-3/5 max-w-xs">
              <span className="absolute left-0 top-0 size-5 rounded-tl-md border-l-2 border-t-2 border-primary" />
              <span className="absolute right-0 top-0 size-5 rounded-tr-md border-r-2 border-t-2 border-primary" />
              <span className="absolute bottom-0 left-0 size-5 rounded-bl-md border-b-2 border-l-2 border-primary" />
              <span className="absolute bottom-0 right-0 size-5 rounded-br-md border-b-2 border-r-2 border-primary" />
              <span className="absolute inset-x-2 top-1/2 h-px bg-primary/80" />
            </div>
          </div>
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[0.7rem] font-medium text-white">
            <span className="size-1.5 rounded-full bg-primary" />
            Camera live
          </div>
        </>
      )}

      {status === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
          <Loader2 className="size-4 animate-spin" />
          Starting camera…
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white/85">
          <CameraOff className="size-6 text-white/60" />
          <p className="max-w-xs">{error}</p>
        </div>
      )}

      <div className="absolute right-2 top-2 flex gap-2">
        {torch.supported && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={torch.on ? "Turn torch off" : "Turn torch on"}
            aria-pressed={torch.on}
            className="size-10 bg-black/60 text-white hover:bg-black/75"
            onClick={toggleTorch}
          >
            <Zap className={cn("size-4", torch.on && "fill-warning text-warning")} />
          </Button>
        )}
        {hasMultipleCameras && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Switch camera"
            className="size-10 bg-black/60 text-white hover:bg-black/75"
            onClick={flipCamera}
          >
            <SwitchCamera className="size-4" />
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Close camera"
          className="size-10 bg-black/60 text-white hover:bg-black/75"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
