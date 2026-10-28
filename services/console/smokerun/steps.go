package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	ciptypes "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	sfntypes "github.com/aws/aws-sdk-go-v2/service/sfn/types"
)

// The same users as scripts/smoke-test.sh, so the two never disagree.
const (
	shopEmail   = "smoke-shop@dispatchy.test"
	driverEmail = "smoke-driver@dispatchy.test"
)

// run carries what one step learns for the next.
type run struct {
	handler
	id                     string
	shopToken, driverToken string
	driverID, orderID      string
	taskToken              string
}

func randomPassword() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "Sm0ke-" + hex.EncodeToString(b)
}

func (r *run) ensureUser(ctx context.Context, email, group, password string, attrs ...ciptypes.AttributeType) error {
	attrs = append(attrs,
		ciptypes.AttributeType{Name: aws.String("email"), Value: aws.String(email)},
		ciptypes.AttributeType{Name: aws.String("email_verified"), Value: aws.String("true")})
	_, err := r.cognito.AdminCreateUser(ctx, &cip.AdminCreateUserInput{
		UserPoolId: &r.poolID, Username: &email, MessageAction: ciptypes.MessageActionTypeSuppress, UserAttributes: attrs,
	})
	var exists *ciptypes.UsernameExistsException
	if err != nil && !errors.As(err, &exists) {
		return fmt.Errorf("create %s: %w", email, err)
	}
	if _, err := r.cognito.AdminSetUserPassword(ctx, &cip.AdminSetUserPasswordInput{
		UserPoolId: &r.poolID, Username: &email, Password: &password, Permanent: true,
	}); err != nil {
		return fmt.Errorf("set password for %s: %w", email, err)
	}
	_, err = r.cognito.AdminAddUserToGroup(ctx, &cip.AdminAddUserToGroupInput{
		UserPoolId: &r.poolID, Username: &email, GroupName: &group,
	})
	return err
}

func (r *run) idToken(ctx context.Context, email, password string) (string, error) {
	out, err := r.cognito.AdminInitiateAuth(ctx, &cip.AdminInitiateAuthInput{
		UserPoolId:     &r.poolID,
		ClientId:       &r.clientID,
		AuthFlow:       ciptypes.AuthFlowTypeAdminUserPasswordAuth,
		AuthParameters: map[string]string{"USERNAME": email, "PASSWORD": password},
	})
	if err != nil {
		return "", fmt.Errorf("sign in %s: %w", email, err)
	}
	if out.AuthenticationResult == nil {
		return "", fmt.Errorf("sign in %s: unexpected challenge %s", email, out.ChallengeName)
	}
	return *out.AuthenticationResult.IdToken, nil
}

func (r *run) driverSub(ctx context.Context) (string, error) {
	out, err := r.cognito.AdminGetUser(ctx, &cip.AdminGetUserInput{UserPoolId: &r.poolID, Username: aws.String(driverEmail)})
	if err != nil {
		return "", err
	}
	for _, a := range out.UserAttributes {
		if *a.Name == "sub" {
			return *a.Value, nil
		}
	}
	return "", errors.New("driver has no sub")
}

// seedDriver marks the smoke driver available again, as each run leaves it busy.
func (r *run) seedDriver(ctx context.Context) error {
	s := func(v string) dbtypes.AttributeValue { return &dbtypes.AttributeValueMemberS{Value: v} }
	_, err := r.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &r.driversTable, Item: map[string]dbtypes.AttributeValue{
		"pk": s("DRIVER#" + r.driverID), "sk": s("PROFILE"), "status": s("AVAILABLE"),
		"gsi1pk": s("STATUS#AVAILABLE"), "gsi1sk": s(r.driverID),
	}})
	return err
}

func prepareUsers(ctx context.Context, r *run) (string, error) {
	password := randomPassword()
	shopID := ciptypes.AttributeType{Name: aws.String("custom:shop_id"), Value: aws.String("smoke-shop")}
	if err := r.ensureUser(ctx, shopEmail, "shops", password, shopID); err != nil {
		return "", err
	}
	if err := r.ensureUser(ctx, driverEmail, "drivers", password); err != nil {
		return "", err
	}
	var err error
	if r.driverID, err = r.driverSub(ctx); err != nil {
		return "", err
	}
	if err := r.seedDriver(ctx); err != nil {
		return "", err
	}
	if r.shopToken, err = r.idToken(ctx, shopEmail, password); err != nil {
		return "", err
	}
	r.driverToken, err = r.idToken(ctx, driverEmail, password)
	return "signed in as " + shopEmail + " and " + driverEmail, err
}

func (r *run) createOrder(ctx context.Context, key string) (string, error) {
	body := map[string]string{"customerName": "Smoke Test", "customerEmail": r.customerEmail, "dropoffAddress": "1 Main St, Springfield"}
	out, err := call(ctx, http.MethodPost, r.ordersAPI+"/orders", r.shopToken, body, map[string]string{"Idempotency-Key": key})
	if err != nil {
		return "", err
	}
	var order struct {
		OrderID string `json:"orderId"`
	}
	if err := json.Unmarshal(out, &order); err != nil || order.OrderID == "" {
		return "", fmt.Errorf("no orderId in %s", out)
	}
	return order.OrderID, nil
}

func placeOrder(ctx context.Context, r *run) (string, error) {
	key := r.id
	var err error
	if r.orderID, err = r.createOrder(ctx, key); err != nil {
		return "", err
	}
	retry, err := r.createOrder(ctx, key)
	if err != nil {
		return "", err
	}
	if retry != r.orderID {
		return "", fmt.Errorf("retry with the same Idempotency-Key created %s, want %s", retry, r.orderID)
	}
	return "order " + r.orderID + ", and the idempotent retry returned it again", nil
}

// findTaskToken reads the offer's task token from the workflow history,
// where a real driver app would get it from the SNS offer.
func (r *run) findTaskToken(ctx context.Context) error {
	arn := strings.Replace(r.machine, ":stateMachine:", ":execution:", 1) + ":" + r.orderID
	out, err := r.sfn.GetExecutionHistory(ctx, &sfn.GetExecutionHistoryInput{ExecutionArn: &arn, ReverseOrder: true})
	var missing *sfntypes.ExecutionDoesNotExist
	if errors.As(err, &missing) {
		return errNotYet
	}
	if err != nil {
		return err
	}
	for _, e := range out.Events {
		if e.Type != sfntypes.HistoryEventTypeTaskScheduled || e.TaskScheduledEventDetails == nil {
			continue
		}
		var params struct {
			Payload struct {
				TaskToken string `json:"taskToken"`
			} `json:"Payload"`
		}
		if json.Unmarshal([]byte(*e.TaskScheduledEventDetails.Parameters), &params) == nil && params.Payload.TaskToken != "" {
			r.taskToken = params.Payload.TaskToken
			return nil
		}
	}
	return errNotYet
}

func waitForOffer(ctx context.Context, r *run) (string, error) {
	err := waitFor(ctx, 2*time.Minute, "the driver offer", func() error { return r.findTaskToken(ctx) })
	return "the workflow offered the job to the smoke driver", err
}

func (r *run) orderStatusIs(ctx context.Context, want string) error {
	out, err := call(ctx, http.MethodGet, r.ordersAPI+"/orders/"+r.orderID, r.shopToken, nil, nil)
	if err != nil {
		return err
	}
	var order struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(out, &order); err != nil {
		return err
	}
	if order.Status != want {
		return errNotYet
	}
	return nil
}

func acceptOffer(ctx context.Context, r *run) (string, error) {
	if _, err := call(ctx, http.MethodPost, r.dispatchAPI+"/offers/accept", r.driverToken, map[string]string{"taskToken": r.taskToken}, nil); err != nil {
		return "", err
	}
	err := waitFor(ctx, 30*time.Second, "status ASSIGNED", func() error { return r.orderStatusIs(ctx, "ASSIGNED") })
	return "order is ASSIGNED", err
}

// The route only has to move on the console's map, so it is a straight line.
var route = struct{ fromLat, fromLng, toLat, toLng float64 }{51.5007, -0.1246, 51.5074, -0.1278}

const pings = 10

func drive(ctx context.Context, r *run) (string, error) {
	for i := range pings {
		f := float64(i) / (pings - 1)
		ping := map[string]float64{
			"lat": route.fromLat + f*(route.toLat-route.fromLat),
			"lng": route.fromLng + f*(route.toLng-route.fromLng),
		}
		if _, err := call(ctx, http.MethodPost, r.trackingAPI+"/pings", r.driverToken, ping, nil); err != nil {
			return "", err
		}
		time.Sleep(time.Second)
	}
	return fmt.Sprintf("sent %d location pings", pings), nil
}

func readETA(ctx context.Context, r *run) (string, error) {
	var eta []byte
	err := waitFor(ctx, time.Minute, "an ETA", func() error {
		out, err := call(ctx, http.MethodGet, r.trackingAPI+"/orders/"+r.orderID+"/eta", r.shopToken, nil, nil)
		if err != nil {
			return errNotYet
		}
		eta = out
		return nil
	})
	return "ETA " + strings.TrimSpace(string(eta)), err
}

func uploadProof(ctx context.Context, r *run) (string, error) {
	out, err := call(ctx, http.MethodPost, r.proofAPI+"/orders/"+r.orderID+"/proof", r.driverToken, map[string]string{"contentType": "image/jpeg"}, nil)
	if err != nil {
		return "", err
	}
	var upload struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(out, &upload); err != nil || upload.URL == "" {
		return "", fmt.Errorf("no upload url in proof response")
	}

	// The smallest valid JPEG: start and end of image markers.
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, upload.URL, strings.NewReader("\xff\xd8\xff\xd9"))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "image/jpeg")
	resp, err := httpClient.Do(req)
	if err != nil {
		// Unwrap drops the url.Error, whose URL carries the signature.
		return "", fmt.Errorf("upload photo: %w", errors.Unwrap(err))
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("upload photo: %s", resp.Status)
	}
	return "photo uploaded to the proof bucket", nil
}

func waitForDelivery(ctx context.Context, r *run) (string, error) {
	err := waitFor(ctx, time.Minute, "status DELIVERED", func() error { return r.orderStatusIs(ctx, "DELIVERED") })
	return "order " + r.orderID + " is DELIVERED", err
}
