#!/bin/bash
# Resolves the bash interpreter path to embed in the litt launcher's
# shebang line.
#
# Termux ships no /bin/bash — bash lives under $PREFIX/bin/bash instead
# (e.g. /data/data/com.termux/files/usr/bin/bash). Every other platform
# (Linux, macOS) keeps the standard /bin/bash path. Detection checks that
# a bash binary actually exists under $PREFIX rather than assuming every
# environment that happens to set PREFIX is Termux.
get_launcher_bash_path() {
  if [ -n "${PREFIX:-}" ] && [ -x "${PREFIX}/bin/bash" ]; then
    echo "${PREFIX}/bin/bash"
  else
    echo "/bin/bash"
  fi
}
