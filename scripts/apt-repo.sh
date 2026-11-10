#!/usr/bin/env bash
# Build the release .deb's signed flat apt repository, or independently check downloaded artifacts:
#   bash scripts/apt-repo.sh
#   bash scripts/apt-repo.sh --verify-only /path/to/release
# Requires dpkg-dev, apt-utils, gnupg and python3. Only building needs $APT_SIGNING_KEY.
set +x
set -euo pipefail
export -n APT_SIGNING_KEY
repo=$(cd "$(dirname "$0")/.." && pwd)
keyring="$repo/build/linux/folio-archive-keyring.gpg"
deb=Doko-linux-amd64.deb
product=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build"]["productName"])' "$repo/package.json")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "$*" >&2; exit 1; }
export GNUPGHOME="$work/verification"
mkdir -m 700 "$GNUPGHOME"
primary_fingerprints() {
  gpg --batch --with-colons --show-keys "$1" | awk -F: '
    $1 == "sec" || $1 == "ssb" { exit 1 }
    $1 == "pub" { primary = 1 }
    $1 == "fpr" && primary { print $10; primary = 0 }
  '
}
# The checked-in public certificate is this fork's trust root, independent of upstream.
signer=$(primary_fingerprints "$keyring") || fail "Could not read the public archive keyring"
[[ $signer =~ ^[A-F0-9]{40}$ ]] || fail "Archive keyring must contain exactly one public primary key"
gpg --batch --dearmor --output "$work/dearmored.gpg" "$repo/build/linux/folio-archive-keyring.asc"
cmp "$keyring" "$work/dearmored.gpg" || fail "Armored and binary archive keyrings differ"

if [[ $# == 0 ]]; then
  : "${APT_SIGNING_KEY:?APT_SIGNING_KEY (armored private key) is required}"
  artifacts="$repo/release"
  metadata="$work/repo"
  mkdir "$metadata"
  cp "$artifacts/$deb" "$metadata/"
  (cd "$metadata" && dpkg-scanpackages --multiversion . /dev/null > Packages)
  gzip -9nc "$metadata/Packages" > "$metadata/Packages.gz"
  # Keep the installed repository identity: changing Origin/Label blocks unattended apt updates.
  (cd "$metadata" && apt-ftparchive \
    -o APT::FTPArchive::Release::Origin="Folio Local" \
    -o APT::FTPArchive::Release::Label="Folio Local" \
    -o APT::FTPArchive::Release::Suite="stable" \
    -o APT::FTPArchive::Release::Codename="stable" \
    -o APT::FTPArchive::Release::Architectures="amd64" \
    -o APT::FTPArchive::Release::Description="$product PDF reader" \
    release . > "$work/Release")
  mv "$work/Release" "$metadata/Release"

  export GNUPGHOME="$work/signing"
  mkdir -m 700 "$GNUPGHOME"
  printf '%s\n' "$APT_SIGNING_KEY" | gpg --batch --quiet --import
  unset APT_SIGNING_KEY
  sign=(gpg --batch --yes --pinentry-mode loopback --passphrase '' --local-user "$signer")
  "${sign[@]}" --clearsign -o "$metadata/InRelease" "$metadata/Release"
  "${sign[@]}" --armor --detach-sign -o "$metadata/Release.gpg" "$metadata/Release"
elif [[ $# == 2 && $1 == --verify-only ]]; then
  artifacts=$(cd -- "$2" && pwd)
  metadata=$artifacts
else
  echo "Usage: $0 [--verify-only ARTIFACT_DIRECTORY]" >&2
  exit 2
fi

export GNUPGHOME="$work/verification"
gpgv --keyring "$keyring" --output "$work/verified-Release" "$metadata/InRelease"
cmp "$work/verified-Release" "$metadata/Release" || fail "InRelease and Release have different contents"
gpgv --keyring "$keyring" "$metadata/Release.gpg" "$metadata/Release"
python3 "$repo/scripts/verify-apt-index.py" "$metadata" "$artifacts/$deb" "$repo/package.json"
dpkg-deb --fsys-tarfile "$artifacts/$deb" | tar -xO "./opt/$product/resources/folio-archive-keyring.gpg" > "$work/packaged.gpg"
cmp "$keyring" "$work/packaged.gpg" || fail "The .deb's keyring differs from the checked-in public keyring"

if [[ $# == 0 ]]; then
  cp "$metadata"/{Packages,Packages.gz,Release,InRelease,Release.gpg} "$artifacts/"
fi
echo "Verified both apt signatures and the packaged keyring with $signer"
