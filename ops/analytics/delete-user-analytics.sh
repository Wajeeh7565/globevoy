#!/usr/bin/env bash
# GV-ANALYTICS-V1: delete one person's analytics when their account is deleted (or on request).
# Deletes their Users row and every Searches row under their hashed ID or any guest ID linked
# to it. Run in CloudShell, us-east-2:   bash delete-user-analytics.sh <cognito-sub> [--yes]
# Without --yes it only lists what would be deleted. Prints counts, never the raw sub.
set -euo pipefail
SUB=${1:?usage: delete-user-analytics.sh <cognito-sub> [--yes]}
YES=${2:-}
R=us-east-2; USERS=globevoy-analytics-users; SEARCHES=globevoy-analytics-searches
KEY=$(aws secretsmanager get-secret-value --region $R --secret-id globevoy/analytics-hash-key --query SecretString --output text)
UID_=$(SUB="$SUB" KEY="$KEY" python3 -c "import hmac,hashlib,os;print('u_'+hmac.new(os.environ['KEY'].encode(),os.environ['SUB'].encode(),hashlib.sha256).hexdigest()[:32])")
unset KEY
ids=("$UID_")
guests=$(aws dynamodb get-item --region $R --table-name $USERS --key "{\"userId\":{\"S\":\"$UID_\"}}" --query 'Item.linkedGuestIds.SS' --output text 2>/dev/null || true)
[ -n "$guests" ] && [ "$guests" != None ] && ids+=($guests)
rows=()
for id in "${ids[@]}"; do
  while read -r s; do [ -n "$s" ] && [ "$s" != None ] && rows+=("$s"); done < <(aws dynamodb query --region $R --table-name $SEARCHES --index-name userId-createdAt \
    --key-condition-expression 'userId = :u' --expression-attribute-values "{\":u\":{\"S\":\"$id\"}}" --query 'Items[].searchId.S' --output text | tr '\t' '\n')
done
echo "user row: $UID_ | linked guest IDs: $(( ${#ids[@]} - 1 )) | search rows: ${#rows[@]}"
if [ "$YES" != --yes ]; then echo "dry run: add --yes to delete"; exit 0; fi
for s in "${rows[@]}"; do aws dynamodb delete-item --region $R --table-name $SEARCHES --key "{\"searchId\":{\"S\":\"$s\"}}"; done
aws dynamodb delete-item --region $R --table-name $USERS --key "{\"userId\":{\"S\":\"$UID_\"}}"
echo "deleted: 1 user row, ${#rows[@]} search rows"
