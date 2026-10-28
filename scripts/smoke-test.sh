#!/usr/bin/env bash
# Walks one order through a deployed dis-patchy: place it, accept the offer as
# a driver, ping a location, read the ETA, upload the proof photo.
#
#   CUSTOMER_EMAIL=you@example.com scripts/smoke-test.sh
#
# Creates (or resets) a test shop and a test driver in the user pool, with a
# fresh random password each run.
set -euo pipefail
trap 'echo "FAILED at line $LINENO" >&2' ERR

: "${CUSTOMER_EMAIL:?set CUSTOMER_EMAIL to an SES-verified address}"
SHOP_EMAIL=${SHOP_EMAIL:-smoke-shop@dispatchy.test}
DRIVER_EMAIL=${DRIVER_EMAIL:-smoke-driver@dispatchy.test}
PASSWORD="Sm0ke-$(openssl rand -hex 12)"

step() { printf '\n==> %s\n' "$*"; }

# resource STACK LOGICAL_ID_PREFIX TYPE prints the resource's physical ID.
resource() {
  aws cloudformation describe-stack-resources --stack-name "DisPatchy-$1" --output text \
    --query "StackResources[?ResourceType=='$3' && starts_with(LogicalResourceId, '$2')].PhysicalResourceId | [0]"
}

endpoint() {
  aws cloudformation describe-stacks --stack-name "DisPatchy-$1" --output text \
    --query "Stacks[0].Outputs[?contains(OutputKey, 'Endpoint')].OutputValue | [0]" | sed 's:/$::'
}

# api METHOD URL TOKEN [CURL ARGS...] prints the body, and fails on a non-2xx.
api() {
  local method=$1 url=$2 token=$3
  shift 3
  curl -sS --fail-with-body --max-time 30 -X "$method" "$url" \
    -H "Authorization: $token" -H "Content-Type: application/json" "$@"
}

# wait_for SECONDS CMD... retries CMD every 3 seconds until it succeeds.
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    if ((SECONDS >= deadline)); then
      echo "timed out waiting for: $*" >&2
      return 1
    fi
    sleep 3
  done
}

# ensure_user EMAIL GROUP [ATTRIBUTES...]
ensure_user() {
  local email=$1 group=$2
  shift 2
  # Fails harmlessly when the user already exists; the next call fails loudly otherwise.
  aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$email" \
    --message-action SUPPRESS --user-attributes Name=email,Value="$email" Name=email_verified,Value=true "$@" \
    >/dev/null 2>&1 || true
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$email" \
    --password "$PASSWORD" --permanent
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" --username "$email" --group-name "$group"
}

# The app client allows SRP sign-in only, which the AWS CLI can't do.
id_token() {
  uv run -q --with pycognito python -c 'import sys
from pycognito import Cognito
u = Cognito(sys.argv[1], sys.argv[2], username=sys.argv[3])
u.authenticate(password=sys.argv[4])
print(u.id_token)' "$POOL_ID" "$CLIENT_ID" "$1" "$PASSWORD"
}

order_status_is() {
  [[ $(api GET "$ORDERS_API/orders/$ORDER_ID" "$SHOP_TOKEN" | jq -r .status) == "$1" ]]
}

task_token() {
  aws stepfunctions get-execution-history --execution-arn "$EXECUTION_ARN" --reverse-order --output json \
    --query "events[?type=='TaskScheduled'].taskScheduledEventDetails.parameters" 2>/dev/null |
    jq -er 'map(fromjson | .Payload.taskToken // empty) | first // empty'
}

eta() {
  local out
  out=$(api GET "$TRACKING_API/orders/$ORDER_ID/eta" "$SHOP_TOKEN" 2>/dev/null) || return 1
  echo "$out"
}

step "Finding the deployment"
ORDERS_API=$(endpoint Orders)
DISPATCH_API=$(endpoint Dispatch)
TRACKING_API=$(endpoint Tracking)
PROOF_API=$(endpoint Proof)
POOL_ID=$(resource Platform Users AWS::Cognito::UserPool)
CLIENT_ID=$(resource Platform Users AWS::Cognito::UserPoolClient)
DRIVERS_TABLE=$(resource Dispatch Drivers AWS::DynamoDB::Table)
STATE_MACHINE=$(resource Dispatch DispatchWorkflow AWS::StepFunctions::StateMachine)
echo "orders api: $ORDERS_API"

step "Preparing $SHOP_EMAIL and $DRIVER_EMAIL"
ensure_user "$SHOP_EMAIL" shops Name=custom:shop_id,Value=smoke-shop
ensure_user "$DRIVER_EMAIL" drivers
DRIVER_ID=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$DRIVER_EMAIL" \
  --output text --query "UserAttributes[?Name=='sub'].Value | [0]")
aws dynamodb put-item --table-name "$DRIVERS_TABLE" --item "$(jq -n --arg id "$DRIVER_ID" '{
  pk: {S: "DRIVER#\($id)"}, sk: {S: "PROFILE"}, status: {S: "AVAILABLE"},
  gsi1pk: {S: "STATUS#AVAILABLE"}, gsi1sk: {S: $id}}')"
SHOP_TOKEN=$(id_token "$SHOP_EMAIL")
DRIVER_TOKEN=$(id_token "$DRIVER_EMAIL")

step "Placing an order for $CUSTOMER_EMAIL"
KEY=$(openssl rand -hex 16)
BODY=$(jq -n --arg email "$CUSTOMER_EMAIL" \
  '{customerName: "Smoke Test", customerEmail: $email, dropoffAddress: "1 Main St, Springfield"}')
ORDER_ID=$(api POST "$ORDERS_API/orders" "$SHOP_TOKEN" -H "Idempotency-Key: $KEY" -d "$BODY" | jq -er .orderId)
echo "order: $ORDER_ID"
RETRY_ID=$(api POST "$ORDERS_API/orders" "$SHOP_TOKEN" -H "Idempotency-Key: $KEY" -d "$BODY" | jq -er .orderId)
[[ $RETRY_ID == "$ORDER_ID" ]] || { echo "retry with the same Idempotency-Key created $RETRY_ID" >&2; exit 1; }

step "Waiting for the driver offer"
EXECUTION_ARN="${STATE_MACHINE/:stateMachine:/:execution:}:$ORDER_ID"
TASK_TOKEN=$(wait_for 120 task_token)

step "Accepting the offer"
api POST "$DISPATCH_API/offers/accept" "$DRIVER_TOKEN" -d "$(jq -n --arg t "$TASK_TOKEN" '{taskToken: $t}')"
echo
wait_for 30 order_status_is ASSIGNED

step "Sending a location ping and reading the ETA"
api POST "$TRACKING_API/pings" "$DRIVER_TOKEN" -d '{"lat":51.5074,"lng":-0.1278}'
echo
wait_for 60 eta

step "Uploading the proof photo"
UPLOAD_URL=$(api POST "$PROOF_API/orders/$ORDER_ID/proof" "$DRIVER_TOKEN" -d '{"contentType":"image/jpeg"}' | jq -er .url)
printf '\xff\xd8\xff\xd9' | curl -sS --fail-with-body --max-time 30 -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/jpeg" --data-binary @-
wait_for 60 order_status_is DELIVERED

step "Passed: order $ORDER_ID is DELIVERED"
echo "$CUSTOMER_EMAIL should have three emails: confirmation, driver assigned, delivered."
