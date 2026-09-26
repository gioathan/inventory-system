"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
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
// first so a typo is caught before a round trip.
const schema = z
  .object({
    username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,50}$/, "Use 3 to 50 characters: letters, digits, . _ or -."),
    password: z.string().min(8, "Use at least 8 characters.").max(128, "Keep it under 128 characters."),
    confirm: z.string(),
    role: z.enum(["Seller", "Admin"]),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });
type FormValues = z.infer<typeof schema>;

export function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: StaffUser) => void;
}) {
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
        setError("username", { message: "That username is already taken." });
      } else {
        setSubmitError(error instanceof Error ? error.message : "Couldn't create the account.");
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
          <DialogTitle>Add a staff account</DialogTitle>
          <DialogDescription>They sign in with this username and password. Share the password with them directly.</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit((values) => {
            setSubmitError(null);
            create.mutate(values);
          })}
          className="flex flex-col gap-4"
        >
          <FormField id="staff-username" label="Username" error={errors.username?.message}>
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

          <FormField id="staff-password" label="Password" error={errors.password?.message} hint="At least 8 characters.">
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
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </FormField>

          <FormField id="staff-confirm" label="Confirm password" error={errors.confirm?.message}>
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

          <FormField
            id="staff-role"
            label="Role"
            hint={
              role === "Admin"
                ? "Admins can see and change everything, including staff accounts."
                : "Sellers can scan, sell, receive stock and look items up. They can't reach the back office."
            }
          >
            <NativeSelect id="staff-role" aria-describedby="staff-role-msg" {...register("role")}>
              <option value="Seller">Seller</option>
              <option value="Admin">Admin</option>
            </NativeSelect>
          </FormField>

          {submitError && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-10" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
