"""drive_auth.py - autenticacao Google via Application Default Credentials (ADC).

Cada analista loga com a PROPRIA conta Google. Nao depende de token nem de
client_secret do squad BI - antes a skill reaproveitava ~/.conversion-bi/, mas
esses arquivos so existem nas maquinas do squad BI, entao os demais analistas
nao conseguiam rodar. Agora a credencial vem do ADC, criado uma vez por:

    gcloud auth application-default login --scopes=<drive + cloud-platform>

O Google Cloud SDK (gcloud) ja esta instalado nas maquinas e o mesmo login ADC
tambem serve as skills que falam com o BigQuery.

Uso programatico:

    from drive_auth import build_drive
    drive = build_drive()

Uso CLI:

    python drive_auth.py --whoami   # mostra o e-mail autenticado
    python drive_auth.py --login    # dispara o login ADC (abre o browser)

Escopo necessario:

- drive.readonly  -> files().list + files().get_media (.docx) + comments().list
"""

from __future__ import annotations

import argparse
import subprocess
import sys

import google.auth
from google.auth.exceptions import DefaultCredentialsError, RefreshError
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# drive.readonly cobre tudo que o extractor faz (listar a pasta/links, baixar
# .docx e ler comments().list). cloud-platform entra no login para o mesmo ADC
# servir tambem as skills de BigQuery - nao e usado por esta skill.
SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
]

LOGIN_SCOPES = ",".join(
    [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/cloud-platform",
    ]
)

GCLOUD_LOGIN_CMD = f"gcloud auth application-default login --scopes={LOGIN_SCOPES}"

_LOGIN_HINT = (
    "Credenciais Google nao encontradas (ou sem o escopo do Drive).\n"
    "Faca login com a SUA conta Google (abre o browser):\n\n"
    f"    {GCLOUD_LOGIN_CMD}\n\n"
    "Cada analista usa a propria conta - nao precisa de nenhum arquivo do squad BI.\n"
    "Depois rode o comando de novo."
)


def load_credentials() -> google.auth.credentials.Credentials:
    """Credenciais ADC validas para os escopos do Drive.

    Levanta SystemExit com instrucoes de login quando o ADC nao existe, perdeu
    o refresh, ou nao tem o escopo do Drive.
    """
    try:
        creds, _ = google.auth.default(scopes=SCOPES)
    except DefaultCredentialsError as exc:
        raise SystemExit(_LOGIN_HINT) from exc

    if not creds.valid:
        try:
            creds.refresh(Request())
        except RefreshError as exc:
            raise SystemExit(_LOGIN_HINT) from exc

    return creds


def build_drive():
    """Cliente Drive v3 pronto para uso."""
    creds = load_credentials()
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _do_login() -> int:
    """Dispara `gcloud auth application-default login` (interativo, abre o browser)."""
    print(f"Disparando login Google:\n    {GCLOUD_LOGIN_CMD}\n")
    # shell=True para resolver gcloud/gcloud.cmd no Windows e no POSIX.
    proc = subprocess.run(GCLOUD_LOGIN_CMD, shell=True)
    if proc.returncode != 0:
        print(
            "Login falhou. Verifique se o gcloud (Google Cloud SDK) esta instalado e "
            "tente novamente.",
            file=sys.stderr,
        )
    return proc.returncode


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    parser = argparse.ArgumentParser(
        description="Auth Google (ADC) da skill sync-feedbacks."
    )
    parser.add_argument(
        "--login", action="store_true", help="Dispara o login ADC (abre o browser)."
    )
    parser.add_argument(
        "--whoami", action="store_true", help="Mostra o e-mail Google autenticado."
    )
    args = parser.parse_args()

    if args.login:
        rc = _do_login()
        if rc != 0:
            return rc

    if args.whoami or not (args.login or args.whoami):
        try:
            drive = build_drive()
            about = drive.about().get(fields="user(emailAddress,displayName)").execute()
        except HttpError as exc:
            if exc.resp.status in (401, 403):
                print(_LOGIN_HINT, file=sys.stderr)
                return 1
            raise
        print(about.get("user", {}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
