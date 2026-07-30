import { useState } from "react";
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

export function Layout({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <html lang="fr" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-900 text-white">
        <div className="border-b border-gray-800">
          <nav className="max-w-[1800px] mx-auto px-3 py-3 sm:px-6">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-[#111118] p-2 text-gray-300 sm:hidden"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-label="Ouvrir le menu"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <div className={`flex-1 ${isMenuOpen ? "block" : "hidden"} sm:block`}>
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-center sm:gap-6 sm:pt-0">
                  <NavLink
                    to="/"
                    onClick={closeMenu}
                    className={({ isActive }) =>
                      `text-sm font-medium ${
                        isActive
                          ? "text-white border-b-2 border-red-500"
                          : "text-gray-400 hover:text-white"
                      }`
                    }
                    end
                  >
                    Checker
                  </NavLink>
                  <NavLink
                    to="/directlogin"
                    onClick={closeMenu}
                    className={({ isActive }) =>
                      `text-sm font-medium ${
                        isActive
                          ? "text-white border-b-2 border-red-500"
                          : "text-gray-400 hover:text-white"
                      }`
                    }
                  >
                    Direct Login
                  </NavLink>
                  <NavLink
                    to="/results"
                    onClick={closeMenu}
                    className={({ isActive }) =>
                      `text-sm font-medium ${
                        isActive
                          ? "text-white border-b-2 border-red-500"
                          : "text-gray-400 hover:text-white"
                      }`
                    }
                  >
                    Results
                  </NavLink>
                </div>
              </div>
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
