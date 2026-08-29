// Discover what @truefoundry/trueforge-sdk actually exposes. THROWAWAY.
import * as sdk from "@truefoundry/trueforge-sdk";

console.log("=== top-level exports ===");
console.log(Object.keys(sdk));

for (const [name, val] of Object.entries(sdk)) {
  if (typeof val === "function") {
    console.log(`\n=== export '${name}' (function/class) static+proto members ===`);
    console.log("  static:", Object.getOwnPropertyNames(val).filter((n) => !["length", "name", "prototype"].includes(n)));
    if (val.prototype) console.log("  proto :", Object.getOwnPropertyNames(val.prototype).filter((n) => n !== "constructor"));
  }
}

// Try to construct a client with common shapes and print its members
const Ctor = sdk.TrueForgeClient ?? sdk.Client ?? sdk.TrueForge ?? sdk.default;
console.log("\n=== chosen ctor:", Ctor?.name);
if (Ctor) {
  let client;
  for (const args of [{ baseUrl: "http://localhost:8790" }, { baseURL: "http://localhost:8790" }, "http://localhost:8790", {}]) {
    try { client = new Ctor(args); console.log("constructed with", JSON.stringify(args)); break; } catch (e) { /* try next */ }
  }
  if (client) {
    const members = new Set([...Object.keys(client), ...Object.getOwnPropertyNames(Object.getPrototypeOf(client) ?? {})]);
    console.log("client members:", [...members].sort());
    for (const m of members) {
      const v = client[m];
      if (v && typeof v === "object") {
        const sub = [...new Set([...Object.keys(v), ...Object.getOwnPropertyNames(Object.getPrototypeOf(v) ?? {})])].filter((n) => n !== "constructor");
        if (sub.length) console.log(`  client.${m}:`, sub.sort());
      }
    }
  }
}
