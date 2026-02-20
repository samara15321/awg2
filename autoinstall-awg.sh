#!/bin/sh
# AWG auto installer (POSIX / BusyBox ash compatible)

set -e

REPO="samara15321/awg2"
API="https://api.github.com/repos/$REPO/releases?per_page=100"
TMP="/tmp/awg"

mkdir -p "$TMP"
cd "$TMP" || exit 1

echo "[*] Detecting OpenWrt..."

# --- OpenWrt info ---
. /etc/openwrt_release

REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"
TARGET_DASH="$(echo "$TARGET" | tr '/' '-')"

echo "[*] Release: $REL"
echo "[*] Target : $TARGET"

# --- fetch releases ---
echo "[*] Fetching releases list..."
wget -qO releases.json "$API" || {
    echo "❌ Cannot fetch releases"
    exit 1
}

# --- SNAPSHOT fix ---
case "$REL" in
  *SNAPSHOT*)
    echo "[*] SNAPSHOT detected → using latest release tag"
    REL="$(grep -m1 '"tag_name"' releases.json \
        | sed 's/.*"tag_name":[ ]*"\([^"]*\)".*/\1/')"
    echo "[*] Using tag: $REL"
  ;;
esac

# --- find ZIP ---
echo "[*] Searching matching build..."

ZIP_URL="$(grep "$TARGET_DASH" releases.json \
    | grep '\.zip' \
    | grep "download/$REL" \
    | head -n1 \
    | sed -n 's/.*"\(https:[^"]*\.zip\)".*/\1/p')"

if [ -z "$ZIP_URL" ]; then
    echo "❌ Build not found for:"
    echo "   tag=$REL"
    echo "   target=$TARGET_DASH"
    exit 1
fi

echo "[+] Found:"
echo "    $ZIP_URL"

# --- download ---
echo "[*] Downloading..."
wget -qO awg.zip "$ZIP_URL" || {
    echo "❌ Download failed"
    exit 1
}

# --- unzip ---
if ! command -v unzip >/dev/null 2>&1; then
    echo "[*] Installing unzip..."
    opkg update >/dev/null 2>&1
    opkg install unzip >/dev/null 2>&1
fi

unzip -o awg.zip >/dev/null

cd awgrelease 2>/dev/null || {
    echo "❌ awgrelease directory missing"
    exit 1
}

# --- detect package manager ---
if command -v opkg >/dev/null 2>&1; then
    PM="opkg"
elif command -v apk >/dev/null 2>&1; then
    PM="apk"
else
    echo "❌ No package manager"
    exit 1
fi

echo "[*] Installing packages via $PM"

INST_KMOD=0
INST_TOOLS=0
INST_LUCI=0

for pkg in \
    kmod-amneziawg \
    amneziawg-tools \
    luci-proto-amneziawg \
    luci-i18n-amneziawg-ru
do
    FILE="$(ls | grep "^$pkg-.*\.$PM$" | head -n1)"

    [ -z "$FILE" ] && {
        echo "⚠ $pkg not found"
        continue
    }

    echo "[+] Installing $FILE"

    if [ "$PM" = "opkg" ]; then
        opkg install "./$FILE" >/dev/null 2>&1 || true
    else
        apk add --allow-untrusted "./$FILE" >/dev/null 2>&1 || true
    fi

    case "$pkg" in
        kmod-amneziawg) INST_KMOD=1 ;;
        amneziawg-tools) INST_TOOLS=1 ;;
        luci-proto-amneziawg) INST_LUCI=1 ;;
    esac
done

echo
echo "✅ AWG installation finished"

if [ "$INST_KMOD" -eq 1 ] &&
   [ "$INST_TOOLS" -eq 1 ] &&
   [ "$INST_LUCI" -eq 1 ]; then
    echo
    echo "⚠ Reboot required:"
    echo "reboot"
fi
