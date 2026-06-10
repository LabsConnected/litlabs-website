#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
"$DIR/sync.sh"
echo "🚀 Booting development server..."
cd /home/litbit/LiTTreeLabstudios
npm run dev
