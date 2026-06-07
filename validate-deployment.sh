#!/bin/bash
# Window Runner - Deployment Validation Script
# Run this to verify all game files are present and valid

echo "🎮 Window Runner - Deployment Validation"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check function
check_file() {
  if [ -f "$1" ]; then
    size=$(wc -c < "$1" | sed -e 's/^[[:space:]]*//')
    echo -e "${GREEN}✓${NC} $1 ($size bytes)"
    return 0
  else
    echo -e "${RED}✗${NC} $1 (MISSING)"
    return 1
  fi
}

# Check required files
echo "Checking required files:"
echo ""

all_exist=true

check_file "index.html" || all_exist=false
check_file "style.css" || all_exist=false
check_file "game.js" || all_exist=false
check_file "README.md" || all_exist=false
check_file "DEPLOYMENT.md" || all_exist=false
check_file "PRODUCTION_RELEASE.md" || all_exist=false

echo ""
echo "Additional files (optional):"
echo ""

check_file "WindowRunner_V3_Architecture.html" || true

echo ""
echo "=========================================="
echo ""

# Content validation
echo "Validating file contents:"
echo ""

# Check index.html
if grep -q "id=\"gameCanvas\"" index.html; then
  echo -e "${GREEN}✓${NC} index.html contains game canvas"
else
  echo -e "${RED}✗${NC} index.html missing game canvas"
  all_exist=false
fi

if grep -q "src=\"game.js\"" index.html; then
  echo -e "${GREEN}✓${NC} index.html links to game.js"
else
  echo -e "${RED}✗${NC} index.html doesn't link to game.js"
  all_exist=false
fi

if grep -q "href=\"style.css\"" index.html; then
  echo -e "${GREEN}✓${NC} index.html links to style.css"
else
  echo -e "${RED}✗${NC} index.html doesn't link to style.css"
  all_exist=false
fi

echo ""

# Check game.js
if grep -q "const CONFIG" game.js; then
  echo -e "${GREEN}✓${NC} game.js contains CONFIG"
else
  echo -e "${RED}✗${NC} game.js missing CONFIG"
  all_exist=false
fi

if grep -q "class Player" game.js; then
  echo -e "${GREEN}✓${NC} game.js contains Player class"
else
  echo -e "${RED}✗${NC} game.js missing Player class"
  all_exist=false
fi

if grep -q "gameLoop" game.js; then
  echo -e "${GREEN}✓${NC} game.js contains game loop"
else
  echo -e "${RED}✗${NC} game.js missing game loop"
  all_exist=false
fi

echo ""

# Check style.css
if grep -q "canvas" style.css; then
  echo -e "${GREEN}✓${NC} style.css has canvas styles"
else
  echo -e "${RED}✗${NC} style.css missing canvas styles"
  all_exist=false
fi

if grep -q ".screen" style.css; then
  echo -e "${GREEN}✓${NC} style.css has screen styles"
else
  echo -e "${RED}✗${NC} style.css missing screen styles"
  all_exist=false
fi

echo ""
echo "=========================================="
echo ""

# File size check
echo "File sizes (should be reasonable):"
echo ""

total_size=0

for file in index.html style.css game.js README.md DEPLOYMENT.md PRODUCTION_RELEASE.md; do
  if [ -f "$file" ]; then
    size=$(wc -c < "$file" | sed -e 's/^[[:space:]]*//')
    total_size=$((total_size + size))
    size_kb=$(echo "scale=1; $size / 1024" | bc)
    echo "$file: ${size_kb} KB"
  fi
done

echo ""
total_kb=$(echo "scale=1; $total_size / 1024" | bc)
echo "Total: ${total_kb} KB (uncompressed)"

echo ""
echo "=========================================="
echo ""

if [ "$all_exist" = true ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "Your game is ready for deployment."
  echo ""
  echo "Next steps:"
  echo "1. Go to https://github.com/becktj90/Finger-Runner/settings"
  echo "2. Click 'Pages' in the left sidebar"
  echo "3. Select 'v1-production' branch as source"
  echo "4. Click 'Save'"
  echo "5. Wait 1-2 minutes for deployment"
  echo ""
  echo "Game will be live at:"
  echo "https://becktj90.github.io/Finger-Runner/"
  exit 0
else
  echo -e "${RED}❌ Some checks failed!${NC}"
  echo ""
  echo "Fix the missing or invalid files before deploying."
  exit 1
fi
