#!/bin/zsh
set -e
cd "${0:A:h}"
print 'Open http://127.0.0.1:8767 in your browser. Press Control-C to stop.'
exec python3 -m http.server 8767 --bind 127.0.0.1 --directory public
