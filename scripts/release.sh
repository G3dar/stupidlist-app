#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.6.0"
  exit 1
fi

echo "=== Releasing v$VERSION ==="

# 1. Update version in package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
echo "  Updated package.json to $VERSION"

# 2. Bump cache buster in public/index.html
CURRENT_V=$(grep -oP '\?v=\K[0-9]+' public/index.html | head -1)
NEXT_V=$((CURRENT_V + 1))
sed -i "s/?v=$CURRENT_V/?v=$NEXT_V/g" public/index.html
echo "  Bumped cache buster to v=$NEXT_V"

# 3. Build everything
echo "  Building..."
npm run build:all

# 4. Deploy web to Firebase
echo "  Deploying to Firebase..."
npx firebase deploy --only hosting

# 5. Commit and tag
git add -A
git commit -m "Release v$VERSION"
git tag "v$VERSION"

# 6. Push (triggers GitHub Actions for installer builds)
echo "  Pushing to GitHub..."
git push
git push origin "v$VERSION"

echo ""
echo "=== Done! ==="
echo "  - Web deployed to https://stupidlist-app.web.app"
echo "  - GitHub Actions will build Win + Mac installers"
echo "  - Release: https://github.com/G3dar/stupidlist-app/releases/tag/v$VERSION"
