"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError, apiFetch } from "@/lib/api";
import type { StaffUser } from "@/lib/types";

// The same rules the backend enforces (Staff.Api rejects anything else with a 400), checked here
// first so a typo is caught before a round trip. Built from `t` (rather than at module level) so
// the validation messages follow the UI language.
function makeSchema(t: ReturnType<typeof useTranslations<"staff.validation">>) {
  return z
    .object({
      username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,50}$/, t("username")),
      password: z.string().min(8, t("passwordMin")).max(128, t("passwordMax")),
      confirm: z.string(),
      role: z.enum(["Seller", "Admin"]),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("mismatch") });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

export function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: StaffUser) => void;
}) {
  const t = useTranslations("staff");
  const tv = useTranslations("staff.validation");
  const tc = useTranslations("common");
  const schema = useMemo(() => makeSchema(tv), [tv]);
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, setError, reset, control, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", confirm: "", role: "Seller" },
  });
  const { errors } = formState;
  const role = useWatch({ control, name: "role" });

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      apiFetch<StaffUser>("staff", "staff", {
        method: "POST",
        body: JSON.stringify({ username: values.username, password: values.password, role: values.role }),
      }),
    onSuccess: (user) => {
      // A new account is also a new audit entry.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      reset();
      setShowPassword(false);
      setSubmitError(null);
      onCreated(user);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setError("username", { message: t("dialog.usernameTaken") });
      } else {
        setSubmitError(error instanceof Error ? error.message : t("dialog.createFailed"));
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        if (!next) {
          reset();
          setSubmitError(null);
          setShowPassword(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit((values) => {
            setSubmitError(null);
            create.mutate(values);
          })}
          className="flex flex-col gap-4"
        >
          <FormField id="staff-username" label={t("username")} error={errors.username?.message}>
            <Input
              id="staff-username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!errors.username}
              aria-describedby="staff-username-msg"
              className="h-11"
              {...register("username")}
            />
          </FormField>

          <FormField id="staff-password" label={t("dialog.password")} error={errors.password?.message} hint={t("dialog.passwordHint")}>
            <div className="relative">
              <Input
                id="staff-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                aria-describedby="staff-password-msg"
                className="h-11 pr-11"
                {...register("password")}
              />
              <button
                type="button"
                aria-label={showPassword ? t("dialog.hidePassword") : t("dialog.showPassword")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </FormField>

          <FormField id="staff-confirm" label={t("dialog.confirmPassword")} error={errors.confirm?.message}>
            <Input
              id="staff-confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              aria-describedby="staff-confirm-msg"
              className="h-11"
              {...register("confirm")}
            />
          </FormField>

          <FormField id="staff-role" label={t("role")} hint={role === "Admin" ? t("dialog.adminHint") : t("dialog.sellerHint")}>
            <NativeSelect id="staff-role" aria-describedby="staff-role-msg" {...register("role")}>
              <option value="Seller">{t("roles.Seller")}</option>
              <option value="Admin">{t("roles.Admin")}</option>
            </NativeSelect>
          </FormField>

          {submitError && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" className="h-10" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
