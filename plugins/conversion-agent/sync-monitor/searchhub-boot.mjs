process.env["CONVERSION_SYNC_TARGET"] = "searchhub";
/**
 * O monitor do Search Hub sobe por padrão: desde o cutover, é o Search Hub
 * que guarda o Brain. Ele só não sobe quando alguém fixa o modo `legacy`,
 * que é a alavanca de rollback.
 *
 * A URL tem fallback de produção no engine, então não há mais a guarda por
 * `CONVERSION_SEARCHHUB_BACKEND_URL` que existia no canário.
 */
const mode = process.env["CONVERSION_TOOLSET_MODE"]?.trim().toLowerCase();
if (mode === "legacy") {
    process.exit(0);
}
await import("./boot.mjs");
export {};
