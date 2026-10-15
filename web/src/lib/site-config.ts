// Site-wide switches, set in code rather than from the admin screens: decisions about what this
// installation shows, made once by whoever deploys it. Change a value here and redeploy.

export const SITE_CONFIG = {
  /**
   * Show the money side of sales in reports and statistics: revenue totals and per-item revenue
   * (session report, Compare, Insights, the dashboard's Sales section, an item's session panel).
   * Off, those screens still show everything counted in units — sold, received, best sellers,
   * trends — just without amounts of money. Item prices are not affected.
   *
   * Display only: the data still comes from the server, so this is not a way to keep revenue
   * from an admin who goes looking for it.
   */
  showRevenue: false,
} as const;
