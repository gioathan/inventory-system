export const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// The dev admin the Staff service seeds on first start (see Staff.Api/Program.cs).
export const admin = {
  username: process.env.E2E_ADMIN_USER ?? "admin",
  password: process.env.E2E_ADMIN_PASSWORD ?? "ChangeMe123!",
};

// Screenshots and generated camera videos land here (git-ignored), for a human to look at.
export const SCREENS = "test-results/screens";
export const CAM = "test-results/camera";
