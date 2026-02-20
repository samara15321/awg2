#!/bin/sh
set -e

REPO="samara15321/awg2"
API="https://api.github.com/repos/$REPO/releases?per_page=100"
TMP="/tmp/awg"

mkdir -p "$TMP"
cd "$TMP" || exit 1

# OpenWrt info
. /etc/openwrt_release
REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"
TARGET_DASH="$(echo "$TARGET" | tr '/' '-')"
echo "[*] OpenWrt release: $REL"
echo "[*] Target: $TARGET"

echo "[*] Fetching releases info..."
wget -qO releases.json "$API" || {
  echo "❌ Не удалось скачать информацию о релизах"
  exit 1
}

# Поиск ZIP — максимально гибкий
ZIP_URL=""
while IFS= read -r line; do
  case "$line" in
    *"https://github.com/$REPO/releases/download/$REL/"*"$TARGET_DASH"*".zip"*)
      ZIP_URL="$line"
      break
      ;;
  esac
done < releases.json

# Очистка: берём только чистый URL из JSON (убираем ", кавычки, etc.)
ZIP_URL=$(echo "$ZIP_URL" | sed -E 's/.*"(https:\/\/[^"]+\.zip)".*/\1/')

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  echo "Проверь релиз вручную: https://github.com/$REPO/releases/tag/$REL"
  echo "Для отладки выполни:"
  echo "grep -i '$TARGET_DASH' releases.json | grep zip"
  exit 1
fi

echo "[+] Found zip: $ZIP_URL"

wget -O awg.zip "$ZIP_URL" || {
  echo "❌ Не удалось скачать ZIP"
  exit 1
}

# unzip
if command -v unzip >/dev/null; then
  unzip -o awg.zip
elif busybox unzip >/dev/null; then
  busybox unzip -o awg.zip
else
  echo "❌ unzip not available. Установи: opkg update && opkg install unzip"
  exit 1
fi

cd awgrelease || {
  echo "❌ awgrelease directory missing"
  exit 1
}

# PM detect
if command -v apk >/dev/null; then PM=apk
elif command -v opkg >/dev/null; then PM=opkg
else
  echo "❌ No package manager (apk/opkg)"
  exit 1
fi

echo "[*] Installing via $PM"

INST_KMOD=0 INST_TOOLS=0 INST_LUCI=0

for pkg in kmod-amneziawg amneziawg-tools luci-proto-amneziawg luci-i18n-amneziawg-ru; do
  FILE=$(ls "${pkg}"-*."${PM}" 2>/dev/null | head -n1)
  [ -z "$FILE" ] && { echo "⚠ $pkg not found"; continue; }

  echo "[+] Installing $FILE"
  if [ "$PM" = apk ]; then
    apk add --allow-untrusted "./$FILE" || true
  else
    opkg install "./$FILE" || true
  fi

  case $pkg in
    kmod-amneziawg)     INST_KMOD=1 ;;
    amneziawg-tools)    INST_TOOLS=1 ;;
    luci-proto-amneziawg) INST_LUCI=1 ;;
  esac
done

echo "✅ AWG install finished"

[ "$INST_KMOD" = 1 ] && [ "$INST_TOOLS" = 1 ] && [ "$INST_LUCI" = 1 ] && {
  echo ""
  echo "⚠ Для применения изменений требуется перезагрузка роутера"
  echo "⚠ Reboot required to apply changes"
}
