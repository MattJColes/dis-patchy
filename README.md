# dis-patchy

A last-mile delivery dispatch platform on AWS, written entirely in Go: AWS CDK for the infrastructure, Go Lambdas for the services.

Shops place delivery orders. The platform assigns a driver, tracks the driver live, collects a proof-of-delivery photo, texts the customer and invoices each shop monthly.

## Purpose

dis-patchy is a **review target**. It exists so code-review tools, linters and AI reviewers have a realistic, multi-service codebase to find problems in. It looks and builds like a real product, and it contains deliberately planted defects, from missing infrastructure safeguards to subtle Go bugs. As the name suggests, it is a little patchy.

> **Do not run this in production.** The defects are real. If you deploy it, deploy it into a sandbox account and tear it down afterwards.

## Architecture

![dis-patchy architecture](docs/architecture.png)

One CDK stack per business area. The stacks talk through a shared EventBridge bus, not through each other's resources.

| Stack | What it does | Main services |
|---|---|---|
| `DisPatchy-Platform` | Identity, the event bus, the ops alarm topic | Cognito, EventBridge, SNS |
| `DisPatchy-Orders` | Shops create and read orders; publishes `OrderPlaced` | API Gateway, Lambda, DynamoDB |
| `DisPatchy-Dispatch` | Claims a driver, offers the job, waits for acceptance | SQS, Step Functions (task token), SNS, DynamoDB |
| `DisPatchy-Tracking` | Ingests driver location pings and serves customer ETAs | Kinesis, Lambda, DynamoDB (TTL) |
| `DisPatchy-Proof` | Presigned photo upload; a new photo closes the order and texts the customer | S3 event notifications, SNS SMS |
| `DisPatchy-Billing` | One line item per delivery, then a monthly CSV invoice per shop | EventBridge schedule, SQS, DynamoDB, S3 |

An order moves through the system like this:

1. A shop calls `POST /orders`. The order is geocoded, stored and announced as `OrderPlaced`.
2. Dispatch picks up the event from its intake queue and starts one workflow execution per order.
3. The workflow claims an available driver and pushes the offer. It then waits until the driver calls `POST /offers/accept`, marks the order `ASSIGNED` and publishes `DriverAssigned`.
4. While driving, the driver app posts location pings to `POST /pings`. Customers poll `GET /orders/{id}/eta`.
5. At the door, the driver requests a presigned URL and uploads the photo. The upload marks the order `DELIVERED`, publishes `OrderDelivered` and texts the customer.
6. Billing records a line item per delivered order. At 02:00 UTC on the 1st of each month it builds every shop's invoice.

### Layout

```
main.go                 CDK composition root: wires the stacks, no resources
infra/                  one file per stack, plus shared L3 constructs
services/<context>/     Go Lambda handlers, one directory per function
services/shared/        API Gateway response and claims helpers
docs/architecture.py    diagram source (renders docs/architecture.png)
```

## Deploying

### Prerequisites

- Go 1.27+
- Node.js 20+ (the CDK CLI runs on Node, and `npx` fetches it)
- AWS credentials for a **sandbox** account
- Docker is optional. Lambdas are bundled with your local Go toolchain when it is present.

### Steps

```sh
# 1. Check it builds, tests and synthesises
go build ./... && go vet ./... && go test ./...
npx aws-cdk@2 synth

# 2. Bootstrap the account/region once
npx aws-cdk@2 bootstrap

# 3. Review, then deploy all six stacks (~10 minutes)
npx aws-cdk@2 diff
npx aws-cdk@2 deploy --all
```

### After deploying

1. **Subscribe to alarms:** add your email to the `DisPatchy-Platform` alarms SNS topic.
2. **Create users:** create users in the Cognito user pool. Shops need the `custom:shop_id` attribute and the `shops` group. Drivers need the `drivers` group.
3. **Seed drivers:** add driver records to the `Drivers` table with `pk = DRIVER#<cognito sub>`, `sk = PROFILE`, `gsi1pk = STATUS#AVAILABLE` and `gsi1sk = <cognito sub>`. Driver onboarding is out of scope.
4. **Point at a real geocoder:** `CreateOrder` is configured with a placeholder URL. Until you change it, order creation returns `422`.
5. **Leave the SMS sandbox:** new accounts can only text verified numbers. Verify a test number, or request production SMS access.

### Tearing down

```sh
npx aws-cdk@2 destroy --all
```

The stateful resources are retained on purpose: the Cognito pool, the Orders, Drivers and Positions tables, and both photo and invoice buckets. Delete them by hand in the console once you're sure.

## What it costs to run

These are **rough monthly estimates in `us-east-1`**, at on-demand list prices, ignoring the free tier. Prices change, so check the [AWS Pricing Calculator](https://calculator.aws/) before relying on them.

### Idle: deployed with no traffic, about $13/month

Almost everything is pay-per-request, so an idle deployment costs very little. The exception is the Kinesis stream: a provisioned shard bills hourly whether or not anything is sent.

| Item | Cost |
|---|---|
| Kinesis, 1 provisioned shard | ~$11.00 |
| CloudWatch alarms (16 × $0.10) | ~$1.60 |
| DynamoDB, S3, logs and the EventBridge archive at near-zero storage | <$1.00 |
| API Gateway, Lambda, Step Functions, SQS | $0 (no requests) |

### Busy: about $60–70/month, plus SMS

This assumes 1,000 deliveries a day (≈30k a month). Each delivery has ~30 minutes of driving with a ping every 10 seconds, which comes to ≈5.4M pings a month.

| Item | Cost |
|---|---|
| API Gateway REST (~6.2M requests; pings dominate) | ~$22 |
| X-Ray tracing (active on every function) | ~$10–15 |
| Kinesis (shard plus PUT units) | ~$11 |
| Step Functions Standard (~8 transitions per order) | ~$6 |
| DynamoDB on-demand (mostly position writes) | ~$4 |
| CloudWatch Logs ingestion | ~$3 |
| Lambda (arm64, 256 MB) | ~$2.50 |
| Alarms, EventBridge, SQS, S3 | ~$2 |
| **Total before SMS** | **~$60–70** |
| **SNS SMS, one text per delivery** | **~$240 in the US**. Several times that in the UK and EU, because per-message prices vary a lot by country. |

At this volume, SMS is the biggest cost by far. After that, the cost is driven by ping volume: a shorter ping interval scales API Gateway, Lambda and DynamoDB linearly. If those costs matter, the first levers are HTTP API in place of REST API, and batching pings on the device.

## Regenerating the diagram

The diagram needs [Graphviz](https://graphviz.org/) (`brew install graphviz`).

```sh
uv run --with diagrams python docs/architecture.py
```
