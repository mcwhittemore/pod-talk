"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Queue" },
  { href: "/feeds", label: "Feeds" },
  { href: "/uploads", label: "Uploads" },
  { href: "/conversations", label: "Conversations" },
  { href: "/webhooks", label: "Webhooks" },
];

export function Nav({ loggedIn, appName }: { loggedIn: boolean; appName: string }) {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">{appName}</Link>
        {loggedIn && (
          <div className="nav-links">
            {LINKS.map((l) => {
              const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
        {loggedIn ? (
          <form action="/logout" method="post"><button type="submit">Log out</button></form>
        ) : (
          <Link href="/login">Log in</Link>
        )}
      </div>
    </nav>
  );
}
