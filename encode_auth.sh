#!/bin/bash
# Run this from the dcpca_bday directory to print secrets for GitHub.
# Copy each value into the corresponding GitHub secret.

set -e
cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════"
echo "  Secret: BAILEYS_AUTH"
echo "  (base64 of .baileys_auth folder)"
echo "══════════════════════════════════════════"
tar czf - .baileys_auth | base64 | tr -d '\n'
echo ""
echo ""

echo "══════════════════════════════════════════"
echo "  Secret: BDAY_EXCEL"
echo "  (base64 of ../bday.xlsx)"
echo "══════════════════════════════════════════"
base64 < ../bday.xlsx | tr -d '\n'
echo ""
echo ""

echo "Done. Paste each block into GitHub → Settings → Secrets → Actions."
