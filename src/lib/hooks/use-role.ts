"use client";

// Thin re-export. The real implementation lives in `@/lib/role-context`
// — it caches the auth round-trip at module level and shares the result
// via React Context so Sidebar + TopBar + page components don't each
// fire their own `auth.getUser()` + profiles select on mount.
//
// Existing call sites keep importing from `@/lib/hooks/use-role` and
// don't need to change.
export { useRole } from "@/lib/role-context";
export type { Profile } from "@/lib/role-context";
