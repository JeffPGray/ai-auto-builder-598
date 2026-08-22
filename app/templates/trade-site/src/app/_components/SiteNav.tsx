"use client";

/**
 * Template SiteNav — BOTH lanes (shared + dedicated).
 *
 * Logo chrome from site-data (filled by `node scripts/inspect-logo.mjs <slug> --write`):
 * - navTheme "light" when logo sits on a white plate → light navbar
 * - logoOnly when lockup/wordmark → no shortName duplicate
 * - logoImgClass sizes tiny marks / lockups up so they aren't 40² stickers
 */
import { useState } from "react";
import Link from "next/link";
import { biz, NAV_LINKS } from "./site-data";
import EstimateDialog from "./EstimateDialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/app/_components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/app/_components/ui/dropdown-menu";

const navTheme = (biz as { navTheme?: string }).navTheme === "light" ? "light" : "dark";
const logoOnly = Boolean((biz as { logoOnly?: boolean }).logoOnly);
const logoImgClass =
  (biz as { logoImgClass?: string }).logoImgClass ||
  "h-10 w-10 shrink-0 object-contain";

export default function SiteNav() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const areaLabel =
    biz.serviceAreaLabel ||
    (biz.areaServed?.length
      ? `Serving ${biz.areaServed.slice(0, 3).join(", ")}`
      : "");
  const hoursShort = biz.hoursShort || "";
  const light = navTheme === "light";

  const linkCls = light
    ? "text-sm font-semibold text-ink hover:text-accent transition-colors"
    : "text-sm font-semibold text-on-dark hover:text-accent-dark transition-colors";
  const linkClsPad = `${linkCls} py-2 inline-flex items-center gap-1`;
  const menuCls = light
    ? "w-56 bg-surface-1 border border-surface-3 rounded-md shadow-xl p-1 text-ink"
    : "w-56 bg-surface-dark border border-on-dark-15 rounded-md shadow-xl p-1 text-on-dark";
  const menuItemCls = light
    ? "rounded-sm px-3 py-2.5 text-sm text-ink focus:bg-surface-2 focus:text-accent cursor-pointer"
    : "rounded-sm px-3 py-2.5 text-sm text-on-dark focus:bg-surface-5 focus:text-accent-dark cursor-pointer";
  const sheetCls = light
    ? "w-[300px] bg-surface-1 border-l border-surface-3 p-0 text-ink"
    : "w-[300px] bg-surface-dark border-l border-on-dark-15 p-0 text-on-dark";
  const sheetLink = light
    ? "block py-3 text-ink font-semibold"
    : "block py-3 text-on-dark font-semibold";
  const sheetChild = light
    ? "block py-2 text-sm text-ink-muted hover:text-accent"
    : "block py-2 text-sm text-on-dark-muted hover:text-accent-dark";

  return (
    <>
      <div
        className={
          light
            ? "fixed top-0 left-0 right-0 z-50 border-b border-surface-3 bg-surface-1 text-ink text-xs py-1.5 px-4"
            : "fixed top-0 left-0 right-0 z-50 bg-surface-dark text-on-dark text-xs py-1.5 px-4"
        }
        style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4 px-4 sm:px-6">
          <span
            className={
              light
                ? "min-w-0 truncate font-body text-ink-muted"
                : "min-w-0 truncate font-body text-on-dark-muted"
            }
          >
            <span className={light ? "text-ink" : "text-on-dark"}>
              {biz.address.city}, {biz.address.state}
            </span>
            {areaLabel ? (
              <span className="hidden sm:inline">
                {" "}
                &middot; {areaLabel}
              </span>
            ) : null}
          </span>
          <div className="flex shrink-0 items-center gap-4">
            <a
              href={biz.phoneHref}
              className={
                light
                  ? "hover:text-accent transition-colors font-semibold"
                  : "hover:text-accent-dark transition-colors font-semibold"
              }
            >
              {biz.phoneDisplay ?? biz.phone}
            </a>
            {hoursShort ? (
              <>
                <span
                  className={
                    light
                      ? "hidden md:inline text-ink-muted"
                      : "hidden md:inline text-on-dark-muted"
                  }
                >
                  |
                </span>
                <span
                  className={
                    light
                      ? "hidden md:inline text-ink-muted"
                      : "hidden md:inline text-on-dark-muted"
                  }
                >
                  {hoursShort}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <header
        data-nav
        data-nav-theme={navTheme}
        className={
          light
            ? "fixed top-[28px] left-0 right-0 z-40 border-b border-surface-3 bg-surface-1 text-ink backdrop-blur-sm transition-colors duration-300"
            : "fixed top-[28px] left-0 right-0 z-40 bg-surface-dark text-on-dark backdrop-blur-sm transition-colors duration-300"
        }
      >
        <nav className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3">
          <Link
            href="/"
            className={
              light
                ? "flex min-w-0 shrink-0 items-center gap-2.5 text-ink"
                : "flex min-w-0 shrink-0 items-center gap-2.5 text-on-dark"
            }
            aria-label={biz.shortName || biz.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.webp"
              alt={biz.shortName || biz.name}
              width={160}
              height={56}
              className={logoImgClass}
            />
            {!logoOnly ? (
              <span
                className={
                  light
                    ? "font-display text-base font-bold tracking-tight text-ink sm:text-lg"
                    : "font-display text-base font-bold tracking-tight text-on-dark sm:text-lg"
                }
              >
                {biz.shortName}
              </span>
            ) : null}
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) =>
              link.children?.length ? (
                <DropdownMenu key={link.href}>
                  <DropdownMenuTrigger asChild>
                    <Link
                      href={link.href}
                      className={linkClsPad}
                      onClick={(e) => e.preventDefault()}
                      onPointerDown={(e) => {
                        if (e.button === 1 || e.ctrlKey || e.metaKey) {
                          e.stopPropagation();
                          window.open(link.href, "_blank");
                        }
                      }}
                    >
                      {link.label}
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" aria-hidden="true">
                        <path
                          d="M3 5l3 3 3-3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Link>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={8} className={menuCls}>
                    <DropdownMenuItem asChild className={menuItemCls}>
                      <Link href={link.href}>All {link.label}</Link>
                    </DropdownMenuItem>
                    {link.children.map((child) => (
                      <DropdownMenuItem key={child.href} asChild className={menuItemCls}>
                        <Link href={child.href}>{child.label}</Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link key={link.href} href={link.href} className={linkCls}>
                  {link.label}
                </Link>
              ),
            )}
            <EstimateDialog triggerClassName="cta-primary text-sm !min-h-[44px] !py-2.5 !px-5" />
          </div>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={light ? "md:hidden p-2 text-ink" : "md:hidden p-2 text-on-dark"}
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className={sheetCls}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="px-5 py-6 space-y-1">
                {NAV_LINKS.map((link) => (
                  <div key={link.href}>
                    <Link
                      href={link.href}
                      className={sheetLink}
                      onClick={() => setSheetOpen(false)}
                    >
                      {link.label}
                    </Link>
                    {link.children?.length ? (
                      <div className="pl-4 space-y-1">
                        {link.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={sheetChild}
                            onClick={() => setSheetOpen(false)}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="pt-4" onClick={() => setSheetOpen(false)}>
                  <EstimateDialog triggerClassName="cta-primary w-full justify-center text-sm" />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </header>
    </>
  );
}
