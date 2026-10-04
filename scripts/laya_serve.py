"""Lance le serveur Laya local (port 8765, checkpoint anglais) joint par le proxy Vite `/laya`.

Installation (une fois) :
  python -m venv .venv
  .venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu   (Windows ; bin/python ailleurs)
  .venv/Scripts/python -m pip install "laya[serve]"

Le premier lancement télécharge le checkpoint depuis Hugging Face.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def venv_python() -> Path | None:
    for rel in ("Scripts/python.exe", "bin/python"):
        p = ROOT / ".venv" / rel
        if p.exists():
            return p
    return None


def main() -> None:
    try:
        import laya.serve  # noqa: F401
    except ImportError:
        py = venv_python()
        if py and Path(sys.executable).resolve() != py.resolve():
            sys.exit(subprocess.call([str(py), __file__, *sys.argv[1:]]))
        sys.exit("Laya n'est pas installé : voir l'en-tête de scripts/laya_serve.py.")

    os.environ.setdefault("LAYA_HOST", "127.0.0.1")
    os.environ.setdefault("LAYA_PORT", "8765")
    os.environ.setdefault("LAYA_MODELS", "english")
    os.environ.setdefault("LAYA_DEFAULT_MODEL", "english")
    os.environ.setdefault("LAYA_LOG_LEVEL", "warning")
    from laya.serve import main as serve

    print(f"Laya sur http://{os.environ['LAYA_HOST']}:{os.environ['LAYA_PORT']} (Ctrl+C pour arrêter)", flush=True)
    serve()


if __name__ == "__main__":
    main()
