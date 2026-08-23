import { useState, useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

// Script injecté avant le rendu pour éviter le flash de thème
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light') { document.documentElement.classList.add('light'); }
  } catch(e) {}
})();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLight, setIsLight] = useState(false);

  // Synchronise l'état React avec la classe déjà appliquée par le script anti-flash
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggleTheme = () => {
    const next = !isLight;
    setIsLight(next);
    if (next) {
      document.documentElement.classList.add("light");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.remove("light");
      localStorage.setItem("theme", "dark");
    }
  };

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Anti-flash: applique le thème sauvegardé avant le premier paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body style={{ background: "var(--bg)", color: "var(--text)" }}>
        <div className="border-b" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <nav className="max-w-7xl mx-auto px-3 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              {/* Hamburger mobile */}
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl p-2 sm:hidden"
                style={{ background: "var(--bg-surface-alt)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-label="Ouvrir le menu"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Nav links */}
              <div className={`flex-1 ${isMenuOpen ? "block" : "hidden"} sm:block`}>
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-center sm:gap-5 sm:pt-0">
                  {[
                    { to: "/", label: "Netflix", end: true },
                    { to: "/prime", label: "Prime" },
                    { to: "/spotify", label: "Spotify" },
                    // { to: "/crunchyroll", label: "Crunchyroll" },
                    { to: "/paramount", label: "Paramount+" },
                    { to: "/capcut", label: "CapCut" },
                    { to: "/perplexity", label: "Perplexity" },
                    { to: "/scribd", label: "Scribd" },
                    // { to: "/directlogin", label: "Direct Login" },
                    { to: "/results", label: "Results" },
                  ].map(({ to, label, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={closeMenu}
                      end={end}
                      style={({ isActive }) => ({
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        color: isActive ? "var(--text)" : "var(--text-muted)",
                        borderBottom: isActive ? "2px solid #ef4444" : "2px solid transparent",
                        paddingBottom: "2px",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      })}
                    >
                      {label}
                    </NavLink>
                  ))}
                </div>
              </div>

              {/* Theme toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                className="theme-toggle shrink-0"
                aria-label={isLight ? "Passer en mode sombre" : "Passer en mode clair"}
                title={isLight ? "Mode sombre" : "Mode clair"}
              >
                {isLight ? (
                  /* Lune — repasser en dark */
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  /* Soleil — passer en light */
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                )}
              </button>
            </div>
          </nav>
        </div>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
