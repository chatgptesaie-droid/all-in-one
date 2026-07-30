const fs = require("fs");

const path = "D:/NETCOOKIES/spotify_account.html";
const h = fs.readFileSync(path, "utf8");

const m = h.match(/"planName"\s*:\s*"([^"]+)"/);

console.log(
  m ? m[1].replace(/\u00A0/g, " ").trim() : "<not found>"
);