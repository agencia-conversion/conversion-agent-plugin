process.env["CONVERSION_SYNC_TARGET"] = "searchhub";
if (!process.env["CONVERSION_SEARCHHUB_BACKEND_URL"]) {
    process.exit(0);
}
await import("./boot.mjs");
export {};
