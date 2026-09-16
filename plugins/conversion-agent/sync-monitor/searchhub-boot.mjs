process.env["CONVERSION_SYNC_TARGET"] = "searchhub";
// Antes do cutover, o monitor do Search Hub encerrava calado quando
// `CONVERSION_SEARCHHUB_BACKEND_URL` não existia, porque só a coorte do
// canário tinha a variável. Com o destino já em produção, o engine cai no
// domínio padrão e o monitor sobe para todo mundo. Sem projeto
// materializado no hub do Search Hub ele fica ocioso, como o legado.
await import("./boot.mjs");
export {};
