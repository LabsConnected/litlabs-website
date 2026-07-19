"""Update object-position references for the cropped mascot image."""
from pathlib import Path

files = [
    Path(r"c:\Users\litbi\CascadeProjects\litlab\src\components\FloatingChat.tsx"),
    Path(r"c:\Users\litbi\CascadeProjects\litlab\src\components\chat\MessageAvatar.tsx"),
    Path(r"c:\Users\litbi\CascadeProjects\litlab\src\app\agents\AgentsPageClient.tsx"),
]

OLD = 'objectPosition: "50% 35%"'
NEW = 'objectPosition: "50% 30%"'

for fp in files:
    content = fp.read_text(encoding="utf-8")
    if OLD in content:
        new_content = content.replace(OLD, NEW)
        fp.write_text(new_content, encoding="utf-8")
        print(f"OK   {fp}")
    else:
        print(f"SKIP {fp} (no match)")

print("done")
