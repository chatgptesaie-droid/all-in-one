import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("results", "routes/results.tsx"),
  route("directlogin", "routes/directlogin.tsx"),
  route("spotify", "routes/spotify.tsx"),
  route("prime", "routes/prime.tsx"),
  route("crunchyroll", "routes/crunchyroll.tsx"),
  route("paramount", "routes/paramount.tsx"),
  route("api/spotify", "routes/api.spotify.ts"),
  route("api/prime", "routes/api.prime.ts"),
  route("api/crunchyroll", "routes/api.crunchyroll.ts"),
  route("api/paramount", "routes/api.paramount.ts"),
  route("api/validate", "routes/api.validate.ts"),
  route("api/storage/list", "routes/api-storage-list.ts"),
  route("api/storage/content", "routes/api-storage-content.ts"),
  route("api/storage/url", "routes/api-storage-url.ts"),
  route("api/storage/upload", "routes/api-storage-upload.ts"),
  route("api/db/save", "routes/api-db-save.ts"),
  route("api/directlogin", "routes/api.directlogin.ts"),
] satisfies RouteConfig;
