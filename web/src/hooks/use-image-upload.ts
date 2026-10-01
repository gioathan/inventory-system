import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Cloudflare Images' own per-file limit.

// Shared by the new-item form and the edit-item dialog: pick a file, upload it to Cloudflare
// Images through the gateway, and hand back the resulting URL via `onUploaded`. Degrading to a
// clear message when Cloudflare isn't configured (502) is the expected state until real
// credentials exist, not a failure of the upload itself — see architecture.md.
export function useImageUpload(onUploaded: (url: string) => void) {
  const t = useTranslations("catalog");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) return setError(t("image.notImage"));
    if (file.size > MAX_IMAGE_BYTES) return setError(t("image.tooLarge"));

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { imageUrl } = await apiFetch<{ imageUrl: string }>("gateway", "images", { method: "POST", body });
      onUploaded(imageUrl);
    } catch (err) {
      const notConfigured = err instanceof ApiError && err.status === 502 && /not configured/i.test(err.message);
      setError(
        notConfigured
          ? t("image.notConfigured")
          : err instanceof Error
            ? err.message
            : t("image.failed"),
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  return { fileInput, uploading, error, onFileInputChange, pick: () => fileInput.current?.click() };
}
