import { Icons, type NavItem } from "./Layout";

/**
 * Navigation definitions live here rather than in the route modules so that
 * screens shared between roles (the family list and family detail, which
 * admins reuse verbatim) can pick the right nav without importing the app
 * module that renders them -- which would be a cycle.
 */

export const COACH_NAV: NavItem[] = [
  { to: "/coach", label: "Overview", icon: Icons.chart, end: true },
  { to: "/coach/families", label: "Families", icon: Icons.people },
  { to: "/coach/export", label: "Export", icon: Icons.download },
];

export const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: Icons.chart, end: true },
  { to: "/admin/coaches", label: "Coaches", icon: Icons.people },
  { to: "/admin/rules", label: "Rules", icon: Icons.rules },
  { to: "/admin/export", label: "Export", icon: Icons.download },
];

export type AppRole = "admin" | "coach" | "family";

/**
 * Nav, URL prefix and family-list path for whichever role is viewing a shared
 * screen. `familiesPath` is separate from `base` because both roles now land
 * on an overview, so the list lives one level in.
 */
export function chromeFor(role: AppRole | undefined) {
  return role === "admin"
    ? { nav: ADMIN_NAV, base: "/admin", familiesPath: "/admin/families" }
    : { nav: COACH_NAV, base: "/coach", familiesPath: "/coach/families" };
}
