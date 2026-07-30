import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("results", "routes/results.tsx"),
  route("directlogin", "routes/directlogin.tsx"),
  route("spotify", "routes/spotify.tsx"),
  route("prime", "routes/prime.tsx"),
  route("api/spotify", "routes/api.spotify.ts"),
  route("api/prime", "routes/api.prime.ts"),
  route("api/validate", "routes/api.validate.ts"),
  route("api/directlogin", "routes/api.directlogin.ts"),
] satisfies RouteConfig;
