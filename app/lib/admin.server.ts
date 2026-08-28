import "dotenv/config";
import dotenv from "dotenv";
import { createHmac, timingSafeEqual } from "node:crypto";

dotenv.config({ path: "process.env" });

const ADMIN_COOKIE = "netcookies_admin";
const SESSION_MAX_AGE = 60 * 60 * 12;

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "";
}

function sign(value: string): string {
  return createHmac("sha256", getAdminPassword()).update(value).digest("base64url");
}

function getCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`));
  return match?.[1] || null;
}

export function isAdminConfigured(): boolean {
  return Boolean(getAdminPassword());
}

export function isAdminRequest(request: Request): boolean {
  const password = getAdminPassword();
  const token = getCookie(request);
  if (!password || !token) return false;

  const [issuedAt, signature] = token.split(".");
  const timestamp = Number(issuedAt);
  if (!issuedAt || !signature || !Number.isInteger(timestamp)) return false;
  if (Date.now() - timestamp > SESSION_MAX_AGE * 1000 || timestamp > Date.now() + 30_000) return false;

  const expected = sign(issuedAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function loginAdmin(password: string): string | null {
  if (!getAdminPassword() || password !== getAdminPassword()) return null;
  const issuedAt = String(Date.now());
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function adminSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearAdminSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
