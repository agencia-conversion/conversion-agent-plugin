process.env["CONVERSION_SYNC_TARGET"] = "searchhub";
// Correção emergencial de 17/09/2026: o monitor do Search Hub só sobe para
// quem configurou o destino explicitamente. O plugin 0.5.10 tinha removido
// esta guarda, o que fez o monitor rodar para todos e bater em
// `/api/v1/sync/config` com `401 identity_not_found`. O modo padrão voltou a
// ser `legacy`, então o monitor também volta a ser opt-in.
if (!process.env["CONVERSION_SEARCHHUB_BACKEND_URL"]) {
    process.exit(0);
}
await import("./boot.mjs");
export {};
