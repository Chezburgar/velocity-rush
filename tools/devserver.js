// Dev-only static server + image save endpoint (not shipped in the game zip).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".csv": "text/csv"
};

http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/__save/")) {
    const name = req.url.slice(8).replace(/[^\w.\-]/g, "");
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      const b64 = body.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(path.join(ROOT, "design", name), Buffer.from(b64, "base64"));
      res.writeHead(200); res.end("saved " + name);
    });
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(8321, () => console.log("dev server on http://localhost:8321"));
