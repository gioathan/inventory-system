"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { NoticeBanner } from "@/components/notice-banner";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useStaff } from "@/hooks/use-admin-data";
import type { Notice } from "@/hooks/use-item-lookup";
import { useTimeFormat } from "@/lib/time";
import type { StaffUser } from "@/lib/types";
import { AddStaffDialog } from "./add-staff-dialog";

function RolePill({ role }: { role: StaffUser["role"] }) {
  const t = useTranslations("staff.roles");
  return <StatusPill tone={role === "Admin" ? "info" : "neutral"}>{t(role)}</StatusPill>;
}

export function StaffView({ currentUsername }: { currentUsername: string }) {
  const t = useTranslations("staff");
  const { formatDateTime } = useTimeFormat();
  const staff = useStaff();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const sorted = useMemo(
    () => [...(staff.data ?? [])].sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === "Admin" ? -1 : 1)),
    [staff.data],
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button type="button" className="h-10 gap-2" onClick={() => setAdding(true)}>
          <UserPlus className="size-4" />
          {t("addStaff")}
        </Button>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      {staff.isPending ? (
        <div className="flex flex-col gap-2" aria-label={t("loading")}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : staff.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">{t("loadError", { message: staff.error.message })}</p>
          <Button type="button" variant="outline" onClick={() => staff.refetch()}>
            {staff.isFetching && <Loader2 className="size-4 animate-spin" />}
            {t("tryAgain")}
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t("username")}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t("role")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t("created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{user.username}</span>
                      {user.username === currentUsername && <span className="ml-2 text-xs text-muted-foreground">{t("you")}</span>}
                    </td>
                    <td className="px-4 py-3"><RolePill role={user.role} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatDateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {sorted.map((user) => (
              <li key={user.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {user.username}
                    {user.username === currentUsername && <span className="ml-2 text-xs font-normal text-muted-foreground">{t("you")}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("added", { date: formatDateTime(user.createdAt) })}</div>
                </div>
                <RolePill role={user.role} />
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">{t("footnote")}</p>
        </>
      )}

      <AddStaffDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(user) => setNotice({ kind: "success", text: t("createdNotice", { role: user.role, username: user.username }) })}
      />
    </div>
  );
}
