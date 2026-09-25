"use client";

import { Camera, ScanBarcode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import { CameraScanner } from "./camera-scanner";

interface ScanInputProps {
  onScan: (code: string) => void;
  /** Ignore scans while something else (a lookup, a sale) is in flight. */
  disabled?: boolean;
}

// The one scanning surface, reused by Scan & Sell and Receiving. Three ways in, all funnelling
// into the same onScan(code): the phone camera, a hardware scanner (which types like a
// keyboard), or typing the code by hand. Callers never need to know which one it was.
export function ScanInput({ onScan, disabled = false }: ScanInputProps) {
  const [cameraOn, setCameraOn] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(raw: string) {
    const code = raw.trim();
    if (!code || disabled) return;
    onScan(code);
  }

  // Hardware scanners: works even when this input isn't focused.
  useKeyboardWedge(submit, !disabled);

  // Focus the box on desktop so typing/scanning just works; skip on touch devices, where
  // focusing would pop the on-screen keyboard over the very thing being scanned.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {cameraOn ? (
        <CameraScanner onScan={submit} onClose={() => setCameraOn(false)} />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-24 w-full flex-col gap-2 border-dashed text-sm"
          onClick={() => setCameraOn(true)}
        >
          <Camera className="size-6 text-primary" />
          Scan with camera
        </Button>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
          setValue("");
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <ScanBarcode aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Barcode"
            placeholder="Scan or type a barcode"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="text"
            className="h-11 pl-9 font-mono"
          />
        </div>
        <Button type="submit" className="h-11 px-4" disabled={disabled || !value.trim()}>
          Look up
        </Button>
      </form>
    </div>
  );
}
