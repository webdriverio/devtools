#!/bin/sh
set -eu

ENDPOINT=http://s3:9000
BUCKET=traces

attempt=0
until aws --endpoint-url "$ENDPOINT" s3api head-bucket --bucket "$BUCKET" 2>/dev/null \
  || aws --endpoint-url "$ENDPOINT" s3 mb "s3://$BUCKET"; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || exit 1
  sleep 2
done

aws --endpoint-url "$ENDPOINT" s3api put-bucket-policy --bucket "$BUCKET" --policy file:///s3/bucket-policy.json
aws --endpoint-url "$ENDPOINT" s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///s3/cors.json
