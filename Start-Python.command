#!/bin/zsh
set -e
cd "${0:A:h}"
PROJECT_PYTHON="$PWD/.venv/bin/python"
if [ ! -x "$PROJECT_PYTHON" ]; then
  python3 -m venv .venv
  PROJECT_PYTHON="$PWD/.venv/bin/python"
fi
if ! "$PROJECT_PYTHON" -c 'import streamlit,numpy,pandas,reportlab; from packaging.version import Version; assert Version(streamlit.__version__) >= Version("1.66.1")' >/dev/null 2>&1; then
  "$PROJECT_PYTHON" -m pip install -r requirements.txt
fi
exec "$PROJECT_PYTHON" -m streamlit run app.py --server.address=127.0.0.1 --server.port=8501 --browser.gatherUsageStats=false
