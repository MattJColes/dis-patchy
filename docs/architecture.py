"""Renders docs/architecture.png.

Run from the repo root (needs Graphviz):
    uv run --with diagrams python docs/architecture.py
"""

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.analytics import KinesisDataStreams
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.engagement import SimpleEmailServiceSes
from diagrams.aws.integration import (
    Eventbridge,
    SimpleNotificationServiceSns,
    SimpleQueueServiceSqs,
    StepFunctions,
)
from diagrams.aws.management import Cloudwatch
from diagrams.aws.mobile import APIGateway, Appsync
from diagrams.aws.network import CloudFront
from diagrams.aws.security import Cognito
from diagrams.aws.storage import SimpleStorageServiceS3
from diagrams.onprem.client import Users

graph_attr = {"fontsize": "20", "pad": "0.5", "nodesep": "0.6", "ranksep": "1.0"}

with Diagram(
    "dis-patchy",
    filename="docs/architecture",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    shops = Users("Shops")
    drivers = Users("Drivers")
    customers = Users("Customers")
    ops = Users("Ops console")

    with Cluster("Platform"):
        cognito = Cognito("User pool")
        bus = Eventbridge("dis-patchy bus")
        alarms = Cloudwatch("Alarms -> SNS")

    with Cluster("Orders"):
        orders_api = APIGateway("Orders API")
        create = Lambda("CreateOrder")
        get = Lambda("GetOrder")
        orders_table = Dynamodb("Orders")
        orders_api >> [create, get] >> orders_table

    with Cluster("Dispatch"):
        intake = SimpleQueueServiceSqs("Intake + DLQ")
        starter = Lambda("StartDispatch")
        workflow = StepFunctions("Dispatch workflow")
        assign = Lambda("AssignDriver")
        offer = Lambda("OfferDriver")
        offers_topic = SimpleNotificationServiceSns("Driver offers")
        dispatch_api = APIGateway("Dispatch API")
        accept = Lambda("AcceptOffer")
        collect = Lambda("CollectOrder")
        drivers_table = Dynamodb("Drivers")
        intake >> starter >> workflow
        workflow >> [assign, offer]
        assign >> drivers_table
        offer >> offers_topic
        dispatch_api >> accept >> Edge(label="task token") >> workflow
        dispatch_api >> collect >> orders_table

    with Cluster("Tracking"):
        tracking_api = APIGateway("Tracking API")
        ingest = Lambda("IngestPing")
        stream = KinesisDataStreams("Driver pings")
        positions_fn = Lambda("UpdatePositions")
        positions = Dynamodb("Positions")
        eta = Lambda("OrderEta")
        tracking_api >> ingest >> stream >> positions_fn >> positions
        tracking_api >> eta >> positions

    with Cluster("Proof of delivery"):
        proof_api = APIGateway("Proof API")
        upload = Lambda("ProofUploadUrl")
        photos = SimpleStorageServiceS3("Proof photos")
        delivered = Lambda("OrderDelivered")
        proof_api >> upload
        photos >> Edge(label="ObjectCreated") >> delivered

    with Cluster("Notifications"):
        updates_q = SimpleQueueServiceSqs("Customer updates + DLQ")
        notifier = Lambda("NotifyCustomer")
        ses = SimpleEmailServiceSes("SES email")
        updates_q >> notifier >> ses

    with Cluster("Billing"):
        delivered_q = SimpleQueueServiceSqs("Delivered + DLQ")
        recorder = Lambda("RecordLineItem")
        billing_table = Dynamodb("Billing")
        monthly = Eventbridge("Monthly schedule")
        scheduler = Lambda("ScheduleInvoices")
        jobs = SimpleQueueServiceSqs("Invoice jobs + DLQ")
        invoice = Lambda("BuildInvoice")
        invoices = SimpleStorageServiceS3("Invoices")
        delivered_q >> recorder >> billing_table
        monthly >> scheduler >> jobs >> invoice >> [billing_table, invoices]

    with Cluster("Console"):
        console_api = APIGateway("Ops API")
        admission = Lambda("StartSmokeRun /\nStartScenarioRun")
        smoke = Lambda("SmokeRun\nservice API calls")
        scenario_q = SimpleQueueServiceSqs("Scenario jobs + DLQ")
        scenario = Lambda("ScenarioRun\nservice API calls")
        fleet = Lambda("ReadAssets")
        registry = Dynamodb("Admission + fleet registry")
        live = Appsync("Live events\nops subscribers / IAM publishers")
        relay = Lambda("Event + workflow relays")
        pingrelay = Lambda("PingRelay")
        site = SimpleStorageServiceS3("Private console site")
        cloudfront = CloudFront("Console + /api/*")
        console_api >> admission >> registry
        admission >> smoke
        admission >> scenario_q >> scenario
        [smoke, scenario] >> registry
        console_api >> fleet >> [registry, drivers_table]
        [smoke, scenario, relay, pingrelay] >> live
        cloudfront >> [site, console_api]

    shops >> orders_api
    (drivers >> Edge() >> [tracking_api, dispatch_api, proof_api])
    drivers >> Edge(style="dashed", label="presigned PUT") >> photos
    shops >> Edge(label="ETA") >> tracking_api
    offers_topic >> Edge(style="dashed") >> drivers
    ses >> Edge(style="dashed") >> customers
    (
        cognito
        >> Edge(style="dotted")
        >> [orders_api, dispatch_api, proof_api, tracking_api, console_api, live]
    )

    create >> Edge(label="OrderPlaced", color="darkorange") >> bus
    workflow >> Edge(label="DriverAssigned", color="darkorange") >> bus
    delivered >> Edge(label="OrderDelivered", color="darkorange") >> bus
    collect >> Edge(label="OrderCollected", color="darkorange") >> bus
    create >> Edge(label="inline confirmation") >> ses
    [create, notifier] >> Edge(label="NotificationAccepted", color="darkgreen") >> bus
    recorder >> Edge(label="BillingLineRecorded", color="darkgreen") >> bus
    bus >> Edge(color="darkorange") >> [intake, delivered_q, updates_q]
    workflow >> Edge(label="status") >> orders_table
    eta >> orders_table
    delivered >> orders_table
    notifier >> orders_table
    ops >> cloudfront
    ops >> Edge(label="subscribe", style="dashed") >> live
    bus >> relay
    workflow >> Edge(label="execution status", style="dotted") >> relay
    stream >> pingrelay
    [smoke, scenario] >> Edge(label="fixture preparation") >> drivers_table
