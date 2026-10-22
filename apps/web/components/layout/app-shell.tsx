"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Bell, Check, ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Menu, Plus, Search, ShieldCheck } from "lucide-react";
import type { Permission } from "@scc/shared/permissions";
import { matchCommands } from "@/lib/command-actions";
import { MOBILE_PRIMARY, NAV_ITEMS, type NavItem, type NavSection } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/client";
import { cn, initials } from "@/lib/utils";
import { BrandLockup, BrandMark } from "./brand";
import { NAV_ICONS } from "./nav-icons";
import { LanguageSwitcher, ThemeToggle } from "./locale-theme";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { switchOrganizationAction } from "@/app/[locale]/(onboarding)/onboarding/actions";

export interface ShellProps {
  user: { name: string; email: string };
  org: { id: string; name: string; isDemo: boolean };
  role: string;
  permissions: Permission[];
  workspaces: { id: string; name: string; role: string }[];
  unreadNotifications: number;
  isPlatformAdmin: boolean;
  children: ReactNode;
}

const SECTIONS: { key: NavSection; label: "nav.sectionCore" | "nav.sectionGrowth" | "nav.sectionOps" }[] = [
  { key: "core", label: "nav.sectionCore" },
  { key: "growth", label: "nav.sectionGrowth" },
  { key: "ops", label: "nav.sectionOps" },
];

function useVisibleItems(permissions: Permission[], isPlatformAdmin = false) {
  return NAV_ITEMS.filter((i) => (!i.platformOnly || isPlatformAdmin) && (!i.permission || permissions.includes(i.permission)));
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const href = `/${locale}/${item.key}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = NAV_ICONS[item.key]!;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? t(item.label) : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors",
        active ? "bg-accent-soft font-semibold text-fg" : "text-muted hover:bg-surface-hover hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active ? <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-accent" aria-hidden /> : null}
      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "text-subtle group-hover:text-muted")} />
      {!collapsed ? (
        <>
          <span className="truncate">{t(item.label)}</span>
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
  const { t } = useI18n();
  const items = useVisibleItems(permissions, isPlatformAdmin);
  return (
    <nav className="space-y-5" aria-label={t("nav.menu")}>
      {SECTIONS.map((s) => (
        <div key={s.key}>
          {!collapsed ? (
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">{t(s.label)}</div>
          ) : (
            <div className="mx-auto mb-2 h-px w-6 bg-line" />
          )}
          <div className="space-y-0.5">
            {items
              .filter((i) => i.section === s.key)
              .map((i) => (
                <NavLink key={i.key} item={i} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
          </div>
        </div>
      ))}
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
        {initials(user.name || user.email)}
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
          <div className="px-1.5 py-1.5">
            <LanguageSwitcher />
          </div>
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
  const { t, locale } = useI18n();
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const items = useVisibleItems(props.permissions, props.isPlatformAdmin);

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
        <header className="glass sticky top-0 z-30 border-b border-line pt-safe">
          <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
            <div className="lg:hidden">
              <BrandMark className="h-8 w-8" />
            </div>
            <GlobalSearch className="hidden max-w-md flex-1 md:block" permissions={props.permissions} />
            <div className="ms-auto flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell count={props.unreadNotifications} />
              <UserMenu user={props.user} role={props.role} isPlatformAdmin={props.isPlatformAdmin} />
            </div>
          </div>
          {props.org.isDemo ? (
            <div className="border-t border-gold/25 bg-gold-soft px-4 py-1.5 text-center text-[12px] font-medium text-gold sm:px-6">
              {t("dashboard.demoBanner")}
            </div>
          ) : null}
        </header>

        <main className="mb-bottomnav flex-1 px-4 py-6 sm:px-6 lg:mb-0 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1240px]">{props.children}</div>
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
                className={cn("flex flex-col items-center justify-center gap-1 text-[11px]", active ? "text-accent" : "text-subtle")}
              >
                <Icon className="h-[22px] w-[22px]" />
                <span className="max-w-full truncate px-1">{t(item.label)}</span>
              </Link>
            );
          })}
          <Dialog
            open={moreOpen}
            onOpenChange={setMoreOpen}
            title={t("nav.menu")}
            trigger={
              <button type="button" className="flex flex-col items-center justify-center gap-1 text-[11px] text-subtle">
                <Menu className="h-[22px] w-[22px]" />
                {t("nav.more")}
              </button>
            }
          >
            <div className="space-y-5">
              <GlobalSearch permissions={props.permissions} />
              <WorkspaceSwitcher org={props.org} workspaces={props.workspaces} />
              <NavList permissions={props.permissions} onNavigate={() => setMoreOpen(false)} isPlatformAdmin={props.isPlatformAdmin} />
            </div>
          </Dialog>
        </div>
      </nav>
    </div>
  );
}
