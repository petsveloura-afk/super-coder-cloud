"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Bell, Check, ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Menu, Plus, Search, ShieldCheck, UserRound } from "lucide-react";
import type { Permission } from "@scc/shared/permissions";
import { matchCommands } from "@/lib/command-actions";
import { MOBILE_PRIMARY, NAV_GROUPS, NAV_ITEMS, itemsOfGroup, type NavGroupKey, type NavItem, type NavSection } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/client";
import { cn, initials } from "@/lib/utils";
import { BrandLockup, BrandMark } from "./brand";
import { NAV_ICONS } from "./nav-icons";
import { LinkPending } from "./link-pending";
import { NavProgress } from "./nav-progress";
import { LanguageSwitcher, ThemeToggle } from "./locale-theme";
import { InstallAppButton, InstallAppMenuItem } from "./install-app";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { switchOrganizationAction } from "@/app/[locale]/(onboarding)/onboarding/actions";

export interface ShellProps {
  user: { name: string; email: string; avatarUrl?: string | null };
  org: { id: string; name: string; isDemo: boolean };
  role: string;
  permissions: Permission[];
  workspaces: { id: string; name: string; role: string }[];
  unreadNotifications: number;
  /** wave 20: open conversations with unread messages (badge on the inbox tab) */
  unreadInbox?: number;
  isPlatformAdmin: boolean;
  /** feature flags on for this business (optional — no flags means only the regular menu) */
  flags?: string[];
  children: ReactNode;
}

/** the menu groups with their headings (core, AI & agents, growth, operations) */
const GROUPS: { key: NavGroupKey; label: "nav.sectionCore" | "nav.sectionGrowth" | "nav.sectionOps" | "nav.sectionAi" }[] = NAV_GROUPS.map((key) => ({ key, label: key === "core" ? "nav.sectionCore" : key === "growth" ? "nav.sectionGrowth" : key === "ops" ? "nav.sectionOps" : "nav.sectionAi" }));
const SECTIONS: { key: NavSection; label: "nav.sectionCore" | "nav.sectionGrowth" | "nav.sectionOps" }[] = [
  { key: "core", label: "nav.sectionCore" },
  { key: "growth", label: "nav.sectionGrowth" },
  { key: "ops", label: "nav.sectionOps" },
];
// (the section list is kept for reference; the menu renders GROUPS, which adds the AI group)
void SECTIONS;

/** feature flags that are on for the business (items with a `flag` stay hidden until it is on) */
const FlagsContext = createContext<string[]>([]);
/** menu design: live counts shown next to menu items (the inbox) — also on desktop now */
const CountsContext = createContext<Record<string, number>>({});

/* menu design: menu groups can be folded (remembered in this browser); the group of the open screen always stays open */
function subscribeGroups(onChange: () => void) {
  window.addEventListener("scc-navgroups", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("scc-navgroups", onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readGroups(): string {
  try {
    return localStorage.getItem("scc_nav_groups") ?? "";
  } catch {
    return "";
  }
}
function toggleGroup(key: string) {
  try {
    const cur = new Set((localStorage.getItem("scc_nav_groups") ?? "").split(",").filter(Boolean));
    if (cur.has(key)) cur.delete(key);
    else cur.add(key);
    localStorage.setItem("scc_nav_groups", [...cur].join(","));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event("scc-navgroups"));
}
/* menu design: the modules opened last (phones: "recent" row on top of the menu sheet) */
function readRecent(): string {
  try {
    return localStorage.getItem("scc_nav_recent") ?? "";
  } catch {
    return "";
  }
}
function noteRecent(key: string) {
  try {
    const list = (localStorage.getItem("scc_nav_recent") ?? "").split(",").filter((k) => k && k !== key);
    localStorage.setItem("scc_nav_recent", [key, ...list].slice(0, 6).join(","));
  } catch {
    /* storage unavailable */
  }
}

function useVisibleItems(permissions: Permission[], isPlatformAdmin = false) {
  const flags = useContext(FlagsContext);
  return NAV_ITEMS.filter((i) => (!i.platformOnly || isPlatformAdmin) && (!i.permission || permissions.includes(i.permission)) && (!i.flag || flags.includes(i.flag)));
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const href = `/${locale}/${item.key}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = NAV_ICONS[item.key]!;
  const count = useContext(CountsContext)[item.key] ?? 0;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? t(item.label) : undefined}
      className={cn(
        "nav-link group relative flex h-10 items-center gap-2.5 rounded-xl px-2 text-[14px] transition-colors",
        active ? "nav-active bg-accent-soft font-semibold text-fg" : "text-muted hover:bg-surface-hover hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active ? <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-accent" aria-hidden /> : null}
      <LinkPending />
      <span className={cn("nav-icon-tile relative grid h-7 w-7 shrink-0 place-items-center rounded-lg transition", active ? "bg-accent/15" : "group-hover:bg-surface")}>
        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "text-subtle group-hover:text-muted")} />
        {collapsed && count > 0 ? <span className="absolute -end-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg" aria-hidden /> : null}
      </span>
      {!collapsed ? (
        <>
          <span className="truncate">{t(item.label)}</span>
          {count > 0 ? (
            <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[10.5px] font-bold text-white" aria-label={String(count)}>
              <span dir="ltr">{count > 99 ? "99+" : count}</span>
            </span>
          ) : null}
          {item.phase !== null ? (
            <span className="ms-auto rounded-md border border-line px-1.5 text-[10px] font-medium text-subtle">
              <span dir="ltr">P{item.phase}</span>
            </span>
          ) : null}
        </>
      ) : null}
    </Link>
  );
}

function NavList({ permissions, collapsed, onNavigate, isPlatformAdmin }: { permissions: Permission[]; collapsed?: boolean; onNavigate?: () => void; isPlatformAdmin?: boolean }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const items = useVisibleItems(permissions, isPlatformAdmin);
  const folded = new Set(useSyncExternalStore(subscribeGroups, readGroups, () => "").split(",").filter(Boolean));
  return (
    <nav className="space-y-4" aria-label={t("nav.menu")}>
      {GROUPS.filter((s) => itemsOfGroup(items, s.key).length).map((s) => {
        const list = itemsOfGroup(items, s.key);
        // the group of the open screen always stays open
        const here = list.some((i) => pathname === `/${locale}/${i.key}` || pathname.startsWith(`/${locale}/${i.key}/`));
        const open = collapsed || here || !folded.has(s.key);
        const id = `nav-group-${s.key}`;
        return (
          <div key={s.key}>
            {!collapsed ? (
              <button
                type="button"
                onClick={() => toggleGroup(s.key)}
                aria-expanded={open}
                aria-controls={id}
                disabled={here}
                className="nav-group-head group/h mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-subtle transition hover:text-muted disabled:cursor-default"
              >
                <span className="truncate">{t(s.label)}</span>
                <span className="h-px flex-1 bg-line/70" aria-hidden />
                {!open ? <span className="rounded-full bg-surface-hover px-1.5 text-[10px] font-medium normal-case tracking-normal">{list.length}</span> : null}
                {!here ? <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90 rtl:rotate-90")} aria-hidden /> : null}
              </button>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-line" />
            )}
            {open ? (
              <div id={id} className="space-y-0.5">
                {list.map((i) => (
                  <NavLink key={i.key} item={i} collapsed={collapsed} onNavigate={onNavigate} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/** wave 20 — the "More" sheet on phones: every module as an app tile, grouped like the sidebar. */
function NavGrid({ permissions, onNavigate, isPlatformAdmin }: { permissions: Permission[]; onNavigate?: () => void; isPlatformAdmin?: boolean }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const counts = useContext(CountsContext);
  const all = useVisibleItems(permissions, isPlatformAdmin);
  // menu design: find a module by typing its name; the last opened modules on top
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const items = f ? all.filter((i) => t(i.label).toLowerCase().includes(f) || i.key.includes(f)) : all;
  const recent = useSyncExternalStore(subscribeGroups, readRecent, () => "")
    .split(",")
    .map((k) => all.find((i) => i.key === k))
    .filter((i): i is NavItem => Boolean(i))
    .slice(0, 4);
  const tile = (i: NavItem) => {
    const Icon = NAV_ICONS[i.key]!;
    const href = `/${locale}/${i.key}`;
    const active = pathname === href || pathname.startsWith(`${href}/`);
    const n = counts[i.key] ?? 0;
    return (
      <Link key={i.key} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className="module-tile relative">
        <span className="module-icon relative">
          <Icon className="h-5 w-5" />
          {n > 0 ? (
            <span className="absolute -end-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-elevated">
              <span dir="ltr">{n > 9 ? "9+" : n}</span>
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2">{t(i.label)}</span>
      </Link>
    );
  };
  return (
    <nav className="space-y-4" aria-label={t("nav.menu")} data-testid="nav-grid">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("nav.findModule")}
          aria-label={t("nav.findModule")}
          className="h-10 w-full rounded-xl border border-line bg-surface ps-9 pe-3 text-[14px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="nav-filter"
        />
      </div>
      {!f && recent.length ? (
        <div>
          <div className="mb-1 px-1 text-[12px] font-semibold text-subtle">{t("nav.recent")}</div>
          <div className="grid grid-cols-4 gap-1">{recent.map(tile)}</div>
        </div>
      ) : null}
      {f && !items.length ? <p className="px-1 text-[13px] text-subtle">{t("nav.noModule")}</p> : null}
      {GROUPS.map((s) => {
        const list = itemsOfGroup(items, s.key);
        if (!list.length) return null;
        return (
          <div key={s.key}>
            <div className="mb-1 px-1 text-[12px] font-semibold text-subtle">{t(s.label)}</div>
            <div className="grid grid-cols-4 gap-1">{list.map(tile)}</div>
          </div>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitcher({ org, workspaces, collapsed }: { org: ShellProps["org"]; workspaces: ShellProps["workspaces"]; collapsed?: boolean }) {
  const { t, locale, dir } = useI18n();
  return (
    <DM.Root dir={dir}>
      <DM.Trigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border border-line bg-elevated px-2.5 py-2 text-start hover:border-line-strong",
          collapsed && "justify-center px-0",
        )}
        aria-label={t("nav.workspace")}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-soft text-[13px] font-bold text-gold">
          {initials(org.name)}
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-subtle">{t("nav.workspace")}</span>
              <span className="block truncate text-[14px] font-semibold text-fg">{org.name}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-subtle" />
          </>
        ) : null}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className="z-50 min-w-64 rounded-xl border border-line bg-elevated p-1.5 shadow-2xl">
          {workspaces.map((w) => (
            <form key={w.id} action={switchOrganizationAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orgId" value={w.id} />
              <DM.Item asChild>
                <button type="submit" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[14px] outline-none data-[highlighted]:bg-surface-hover">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-surface text-[12px] font-semibold">{initials(w.name)}</span>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === org.id ? <Check className="h-4 w-4 text-accent" /> : null}
                </button>
              </DM.Item>
            </form>
          ))}
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item asChild>
            <Link href={`/${locale}/onboarding`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-muted outline-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg">
              <Plus className="h-4 w-4" /> {t("nav.newWorkspace")}
            </Link>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function UserMenu({ user, role, isPlatformAdmin }: { user: ShellProps["user"]; role: string; isPlatformAdmin: boolean }) {
  const { t, locale, dir } = useI18n();
  return (
    <DM.Root dir={dir}>
      <DM.Trigger className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent ring-1 ring-accent/30" aria-label={t("common.profile")}>
        {user.avatarUrl ? (
          // wave 52 — profile picture when the person uploaded one
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initials(user.name || user.email)
        )}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="z-50 w-72 rounded-xl border border-line bg-elevated p-1.5 shadow-2xl">
          <div className="px-2.5 py-2">
            <div className="truncate text-[14px] font-semibold">{user.name || "—"}</div>
            <div className="truncate text-[12px] text-muted" dir="ltr">{user.email}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="accent">{t(`team.roles.${role}`)}</Badge>
              {isPlatformAdmin ? (
                <Badge tone="gold">
                  <ShieldCheck className="h-3 w-3" /> {t("nav.admin")}
                </Badge>
              ) : null}
            </div>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          {/* wave 52 — quick way to the personal profile */}
          <DM.Item asChild>
            <a href={`/${locale}/settings#my-profile`} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] outline-none data-[highlighted]:bg-accent-soft" data-testid="menu-my-profile">
              <UserRound className="h-4 w-4" aria-hidden /> {t("settings.pro.title")}
            </a>
          </DM.Item>
          <div className="px-1.5 py-1.5">
            <LanguageSwitcher />
          </div>
          <InstallAppMenuItem />
          <DM.Separator className="my-1 h-px bg-line" />
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <DM.Item asChild>
              <button type="submit" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-danger outline-none data-[highlighted]:bg-danger-soft">
                <LogOut className="h-4 w-4" /> {t("common.signOut")}
              </button>
            </DM.Item>
          </form>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function GlobalSearch({ className, permissions = [] }: { className?: string; permissions?: readonly string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  // wave 17: Ctrl+K quick actions
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const actions = focused ? matchCommands(q, (k) => t(`cmd.${k}`), (p) => permissions.includes(p)) : [];
  const listId = `${className ? "gs-d" : "gs-m"}-actions`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const pick = actions[active];
        if (pick && active >= 0 && actions.length) {
          setQ("");
          router.push(`/${locale}${pick.href}`);
          return;
        }
        router.push(`/${locale}/crm?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        id="global-search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (!actions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % actions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? actions.length - 1 : i - 1));
          } else if (e.key === "Escape") setFocused(false);
        }}
        role="combobox"
        aria-expanded={actions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={actions.length && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={t("common.searchPlaceholder")}
        aria-label={t("common.search")}
        className="h-10 w-full rounded-xl border border-line bg-elevated ps-9 pe-14 text-[14px] text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <kbd className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line px-1.5 text-[11px] text-subtle sm:block">
        <span dir="ltr">⌘K</span>
      </kbd>
      {actions.length ? (
        <ul id={listId} role="listbox" aria-label={t("cmd.title")} className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
          {actions.map((a, i) => (
            <li
              key={a.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn("cursor-pointer rounded-lg px-3 py-2 text-[13.5px]", i === active ? "bg-accent-soft text-accent" : "hover:bg-surface-hover")}
              onMouseDown={(e) => {
                e.preventDefault();
                setQ("");
                setFocused(false);
                router.push(`/${locale}${a.href}`);
              }}
            >
              {t(`cmd.${a.key}`)}
            </li>
          ))}
          <li className="px-3 py-1.5 text-[12px] text-subtle">{t("cmd.searchContacts", { q: q.trim() })}</li>
        </ul>
      ) : null}
    </form>
  );
}

function NotificationBell({ count }: { count: number }) {
  const { t, locale } = useI18n();
  return (
    <Link
      href={`/${locale}/settings#notifications`}
      className="relative grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-fg"
      aria-label={`${t("common.notifications")}${count ? ` (${count})` : ""}`}
    >
      <Bell className="h-[18px] w-[18px]" />
      {count > 0 ? (
        <span className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
          <span dir="ltr">{count > 9 ? "9+" : count}</span>
        </span>
      ) : null}
    </Link>
  );
}

function subscribeSidebar(onChange: () => void) {
  window.addEventListener("scc-sidebar", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("scc-sidebar", onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readSidebar() {
  try {
    return localStorage.getItem("scc_sidebar") === "1";
  } catch {
    return false;
  }
}

export function AppShell(props: ShellProps) {
  return (
    <FlagsContext.Provider value={props.flags ?? []}>
      <CountsContext.Provider value={{ inbox: props.unreadInbox ?? 0 }}>
        <AppShellInner {...props} />
      </CountsContext.Provider>
    </FlagsContext.Provider>
  );
}

function AppShellInner(props: ShellProps) {
  const { t, locale } = useI18n();
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const items = useVisibleItems(props.permissions, props.isPlatformAdmin);
  // menu design: remember the module that was opened (the "recent" row of the phone menu)
  useEffect(() => {
    const key = pathname.split("/")[2];
    if (key && items.some((i) => i.key === key)) noteRecent(key);
  }, [pathname, items]);

  const toggle = () => {
    try {
      localStorage.setItem("scc_sidebar", collapsed ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event("scc-sidebar"));
  };

  const CollapseIcon = collapsed ? ChevronsRight : ChevronsLeft;

  return (
    <div className="flex min-h-dvh">
      {/* accessibility: keyboard / screen-reader users jump straight to the screen's content (visible only on focus) */}
      <a href="#main-content" className="skip-link">
        {t("common.skipToContent")}
      </a>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-bg/60 px-3 py-4 backdrop-blur lg:flex",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        <div className={cn("mb-4 flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          {collapsed ? <BrandMark /> : <BrandLockup />}
        </div>
        <WorkspaceSwitcher org={props.org} workspaces={props.workspaces} collapsed={collapsed} />
        <div className="-mx-1 mt-5 flex-1 overflow-y-auto px-1">
          <NavList permissions={props.permissions} collapsed={collapsed} isPlatformAdmin={props.isPlatformAdmin} />
        </div>
        <button
          type="button"
          onClick={toggle}
          className={cn("mt-3 flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-subtle hover:bg-surface-hover hover:text-fg", collapsed && "justify-center px-0")}
          aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
        >
          <CollapseIcon className="h-4 w-4 rtl:rotate-180" />
          {!collapsed ? t("nav.collapse") : null}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        {/* design 3.0: a brand progress bar at the top while the next screen loads */}
        <NavProgress />
        <header className="glass sticky top-0 z-30 border-b border-line pt-safe">
          <div className="flex h-14 items-center gap-2 px-4 sm:h-16 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <BrandMark className="h-8 w-8 shrink-0" />
              {/* wave 20: on phones the workspace name orients you (the sidebar is hidden) */}
              <span className="max-w-[38vw] truncate text-[14px] font-semibold text-fg" data-testid="mobile-org">
                {props.org.name}
              </span>
            </div>
            <GlobalSearch className="hidden max-w-md flex-1 md:block" permissions={props.permissions} />
            <div className="ms-auto flex items-center gap-1">
              {/* wave 20: search on phones opens the menu sheet with the search field on top */}
              <button type="button" onClick={() => setMoreOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-fg md:hidden" aria-label={t("common.search")}>
                <Search className="h-[18px] w-[18px]" />
              </button>
              <InstallAppButton className="hidden sm:grid" />
              <ThemeToggle />
              <NotificationBell count={props.unreadNotifications} />
              <UserMenu user={props.user} role={props.role} isPlatformAdmin={props.isPlatformAdmin} />
            </div>
          </div>
          {props.org.isDemo ? (
            <div className="border-t border-gold/25 bg-gold-soft px-4 py-1 text-center text-[11.5px] font-medium text-gold sm:px-6 sm:py-1.5 sm:text-[12px]" title={t("dashboard.demoBanner")}>
              <span className="line-clamp-1 sm:line-clamp-none">{t("dashboard.demoBanner")}</span>
            </div>
          ) : null}
        </header>

        <main id="main-content" tabIndex={-1} className="mb-bottomnav flex-1 px-4 py-6 outline-none sm:px-6 lg:mb-0 lg:px-8 lg:py-8" data-shell>
          {/* design upgrade: every screen change fades in softly (re-keyed by path; off for reduced motion) */}
          <div key={pathname} className="route-fade mx-auto w-full max-w-[1240px]">
            {props.children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("nav.menu")}
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-safe lg:hidden"
      >
        <div className="grid h-[4.25rem] grid-cols-5">
          {MOBILE_PRIMARY.map((key) => {
            const item = items.find((i) => i.key === key);
            if (!item) return <span key={key} />;
            const Icon = NAV_ICONS[key]!;
            const href = `/${locale}/${key}`;
            const active = pathname.startsWith(href);
            return (
              <Link
                key={key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-accent" : "text-subtle")}
              >
                <span className="tab-pill relative">
                  <LinkPending />
                  <Icon className="h-[21px] w-[21px]" />
                  {key === "inbox" && (props.unreadInbox ?? 0) > 0 ? (
                    <span className="absolute -top-0.5 end-2 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-bg" data-testid="tab-inbox-badge">
                      <span dir="ltr">{(props.unreadInbox ?? 0) > 9 ? "9+" : props.unreadInbox}</span>
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate px-1">{t(item.label)}</span>
              </Link>
            );
          })}
          <Dialog
            open={moreOpen}
            onOpenChange={setMoreOpen}
            title={t("nav.menu")}
            trigger={
              <button type="button" className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-subtle">
                <span className="tab-pill relative">
                  <Menu className="h-[21px] w-[21px]" />
                  {props.unreadNotifications > 0 ? <span className="absolute -top-0.5 end-2.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg" aria-hidden data-testid="tab-more-dot" /> : null}
                </span>
                {t("nav.more")}
              </button>
            }
          >
            <div className="space-y-5">
              <GlobalSearch permissions={props.permissions} />
              <WorkspaceSwitcher org={props.org} workspaces={props.workspaces} />
              <NavGrid permissions={props.permissions} onNavigate={() => setMoreOpen(false)} isPlatformAdmin={props.isPlatformAdmin} />
            </div>
          </Dialog>
        </div>
      </nav>
    </div>
  );
}
