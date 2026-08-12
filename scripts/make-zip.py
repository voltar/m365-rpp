"""Create a deployment ZIP with forward-slash paths.

PowerShell's Compress-Archive stores backslash paths, which makes Kudu on Linux App Service fail
with "failed to stat wwwroot\\assets\\..." (EO-420). Python's zipfile normalizes to forward slashes,
so packaging goes through here.

Usage: python scripts/make-zip.py <archive-path-without-extension> <source-directory>
"""

import shutil
import sys

if len(sys.argv) != 3:
    print(__doc__.strip(), file=sys.stderr)
    sys.exit(2)

archive_base, source_directory = sys.argv[1], sys.argv[2]
created = shutil.make_archive(archive_base, "zip", source_directory)
print(f"Created {created}")
