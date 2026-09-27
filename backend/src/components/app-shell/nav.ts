import { Bed, Cable, Dumbbell, HeartPulse, LayoutDashboard, Settings } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/live", label: "Live", icon: HeartPulse },
  { href: "/sleep", label: "Sleep", icon: Bed },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/sources", label: "Sources", icon: Cable },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
