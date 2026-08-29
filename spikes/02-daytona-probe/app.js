// Spike 02 — trivial Express target. THROWAWAY (delete before PR 2).
// The agent boots this inside a Daytona sandbox, then a probe (curl / generated code) hits it
// on localhost in the SAME sandbox. If the probe reads `secret`, boot + serve + probe all work.

const express = require("express");
const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/data", (_req, res) =>
  res.json({
    ok: true,
    secret: "tenant-a-balance-42000",
    note: "if a probe read this over localhost, the sandbox booted the app and served traffic",
  })
);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => console.log(`spike target app listening on :${PORT}`));
