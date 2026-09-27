import { expect } from "@playwright/test";

// A soft assertion that also prints a PASS/FAIL line per check. Soft, so one failing check doesn't
// hide the rest of a long scenario; the test still fails at the end if any check failed.
export function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  expect.soft(ok, detail ? `${name} — ${detail}` : name).toBe(true);
}
