"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api";
import type { StaffUser } from "@/lib/types";

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

// Sets a new password on an account. For your own account it asks for the current one first —
// a signed-in screen left unattended shouldn't be enough to take the account over. For anyone
// else's it doesn't: an admin resetting a forgotten password can't know the old one.
export function ChangePasswordDialog({ user, own, onClose, onChanged }: { user: StaffUser; own: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("staff");
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_LENGTH && password.length <= MAX_LENGTH && confirm === password && (!own || current.length > 0);

  const change = useMutation({
    mutationFn: () =>
      apiFetch<void>("staff", `staff/${user.id}/password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: password, currentPassword: own ? current : null }),
      }),
    onSuccess: () => {
      // A changed password is also a new audit entry.
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      onChanged();
    },
  });
  const wrongCurrent = change.isError && change.error instanceof ApiError && change.error.status === 409;
  const type = show ? "text" : "password";

  return (
    <Dialog open onOpenChange={(open) => !open && !change.isPending && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) change.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{own ? t("password.titleOwn") : t("password.title", { username: user.username })}</DialogTitle>
            <DialogDescription>{own ? t("password.descriptionOwn") : t("password.description")}</DialogDescription>
          </DialogHeader>

          {own && (
            <FormField id="password-current" label={t("password.current")} error={wrongCurrent ? t("password.wrongCurrent") : undefined}>
              <Input
                id="password-current"
                type={type}
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                aria-invalid={wrongCurrent}
                aria-describedby="password-current-msg"
                className="h-11"
              />
            </FormField>
          )}

          <FormField id="password-new" label={t("password.new")} error={tooShort ? t("validation.passwordMin") : undefined} hint={t("dialog.passwordHint")}>
            <div className="relative">
              <Input
                id="password-new"
                type={type}
                autoComplete="new-password"
                value={password}
                maxLength={MAX_LENGTH}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={tooShort}
                aria-describedby="password-new-msg"
                className="h-11 pr-11"
              />
              <button
                type="button"
                aria-label={show ? t("dialog.hidePassword") : t("dialog.showPassword")}
                aria-pressed={show}
                onClick={() => setShow((v) => !v)}
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </FormField>

          <FormField id="password-confirm" label={t("dialog.confirmPassword")} error={mismatch ? t("validation.mismatch") : undefined}>
            <Input
              id="password-confirm"
              type={type}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch}
              aria-describedby="password-confirm-msg"
              className="h-11"
            />
          </FormField>

          {change.isError && !wrongCurrent && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {change.error instanceof Error ? change.error.message : t("password.failed")}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" disabled={change.isPending} onClick={onClose}>
              {t("password.cancel")}
            </Button>
            <Button type="submit" className="h-10 gap-2" disabled={!valid || change.isPending}>
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("password.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
