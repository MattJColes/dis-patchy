// Package shared holds the API Gateway plumbing every HTTP handler repeats.
package shared

import (
	"encoding/json"
	"log/slog"
	"slices"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

func JSON(status int, body any) (events.APIGatewayProxyResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{}, err
	}
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(b),
	}, nil
}

func Error(status int, msg string) (events.APIGatewayProxyResponse, error) {
	return JSON(status, map[string]string{"error": msg})
}

// Internal logs the cause and hides it from the caller.
func Internal(err error) (events.APIGatewayProxyResponse, error) {
	slog.Error("internal error", "err", err)
	return Error(500, "internal error")
}

func claims(req events.APIGatewayProxyRequest) map[string]any {
	c, _ := req.RequestContext.Authorizer["claims"].(map[string]any)
	return c
}

// Claim returns a Cognito claim from the authorizer context, or "".
func Claim(req events.APIGatewayProxyRequest, name string) string {
	v, _ := claims(req)[name].(string)
	return v
}

func ShopID(req events.APIGatewayProxyRequest) string {
	return Claim(req, "custom:shop_id")
}

func UserID(req events.APIGatewayProxyRequest) string {
	return Claim(req, "sub")
}

// InGroup checks cognito:groups, which the REST authorizer flattens to a
// space-separated string.
func InGroup(req events.APIGatewayProxyRequest, group string) bool {
	return slices.Contains(strings.Fields(strings.Trim(Claim(req, "cognito:groups"), "[]")), group)
}
