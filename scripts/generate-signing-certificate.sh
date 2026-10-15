#!/usr/bin/env bash
#
# Generate a self-signed X.509 document-signing certificate as a PKCS#12 bundle
# for Documenso's local signing transport, and print the environment variables
# that point Documenso at it.
#
# Self-signed certificates guarantee integrity (any edit after sealing breaks
# the signature) and identify your organisation in the signature panel, but PDF
# readers show "certificate not trusted" because no CA vouches for it. For a
# green checkmark in Acrobat you need a document-signing certificate from a CA
# on the Adobe Approved Trust List, which usually ships on a hardware token or
# cloud HSM. Documenso supports Google Cloud HSM for that case.
#
# Usage:
#   scripts/generate-signing-certificate.sh \
#     --org "SmartRoofing AI" \
#     --common-name "SmartRoofing AI Document Signing" \
#     --email "contracts@example.com" \
#     --country US --state Texas --locality Austin \
#     --out-dir "$HOME/.config/documenso/signing" \
#     [--days 3650] [--key-bits 4096] [--passphrase "..."] [--legacy]
#
# Outputs <out-dir>/<slug>.p12 (plus the PEM key and cert) and prints the
# NEXT_PRIVATE_SIGNING_* lines to paste into .env. The passphrase is generated
# when not supplied and printed once.

set -euo pipefail

ORG=""
COMMON_NAME=""
EMAIL=""
COUNTRY="US"
STATE=""
LOCALITY=""
OUT_DIR="${HOME}/.config/documenso/signing"
DAYS=3650
KEY_BITS=4096
PASSPHRASE=""
LEGACY=0

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    --common-name) COMMON_NAME="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --country) COUNTRY="$2"; shift 2 ;;
    --state) STATE="$2"; shift 2 ;;
    --locality) LOCALITY="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --days) DAYS="$2"; shift 2 ;;
    --key-bits) KEY_BITS="$2"; shift 2 ;;
    --passphrase) PASSPHRASE="$2"; shift 2 ;;
    --legacy) LEGACY=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

if [[ -z "$ORG" ]]; then
  echo "error: --org is required" >&2
  usage
fi

COMMON_NAME="${COMMON_NAME:-${ORG} Document Signing}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl is not installed" >&2
  exit 1
fi

if [[ -z "$PASSPHRASE" ]]; then
  PASSPHRASE="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)"
fi

slug="$(printf '%s' "$ORG" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
stamp="$(date +%Y%m%d)"
base="${OUT_DIR}/${slug}-signing-${stamp}"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

subject="/C=${COUNTRY}"
[[ -n "$STATE" ]] && subject="${subject}/ST=${STATE}"
[[ -n "$LOCALITY" ]] && subject="${subject}/L=${LOCALITY}"
subject="${subject}/O=${ORG}/CN=${COMMON_NAME}"
[[ -n "$EMAIL" ]] && subject="${subject}/emailAddress=${EMAIL}"

echo "Generating ${KEY_BITS}-bit RSA key and self-signed certificate valid for ${DAYS} days"
echo "Subject: ${subject}"

# keyUsage marks the key as a signing key with non-repudiation (contentCommitment),
# which is what PDF readers expect for document signatures.
openssl req -x509 -newkey "rsa:${KEY_BITS}" -sha256 -days "$DAYS" -nodes \
  -keyout "${base}.key.pem" \
  -out "${base}.crt.pem" \
  -subj "$subject" \
  -addext "keyUsage=critical,digitalSignature,nonRepudiation" \
  -addext "extendedKeyUsage=emailProtection" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "subjectKeyIdentifier=hash" \
  2>/dev/null

chmod 600 "${base}.key.pem"

p12_args=(-export -out "${base}.p12" -inkey "${base}.key.pem" -in "${base}.crt.pem" -name "$COMMON_NAME" -passout "pass:${PASSPHRASE}")

# OpenSSL 3 defaults to AES-256-CBC with PBKDF2 for the PKCS#12 container.
# --legacy falls back to 3DES/RC2 for parsers that only understand PBES1.
if [[ "$LEGACY" -eq 1 ]]; then
  p12_args+=(-legacy)
fi

openssl pkcs12 "${p12_args[@]}"
chmod 600 "${base}.p12"

echo
echo "Wrote:"
echo "  ${base}.p12      (PKCS#12 bundle Documenso loads)"
echo "  ${base}.key.pem  (private key, keep offline)"
echo "  ${base}.crt.pem  (public certificate, safe to share)"
echo
echo "Certificate:"
openssl x509 -in "${base}.crt.pem" -noout -subject -dates -fingerprint -sha256 | sed 's/^/  /'
echo
echo "Add to .env (the passphrase is shown once, store it in your secret manager):"
echo
echo "NEXT_PRIVATE_SIGNING_TRANSPORT=\"local\""
echo "NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH=\"${base}.p12\""
echo "NEXT_PRIVATE_SIGNING_PASSPHRASE=\"${PASSPHRASE}\""
echo "NEXT_PUBLIC_SIGNING_CONTACT_INFO=\"${EMAIL:-}\""
echo
echo "For containers, use the base64 contents instead of a path:"
echo "  NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS=\"\$(base64 -i '${base}.p12')\""
