package console

type Scenario string

const (
	ScenarioSmoke       Scenario = "smoke"
	ScenarioRush        Scenario = "rush"
	ScenarioIgnored     Scenario = "ignored-offer"
	ScenarioRetry       Scenario = "retry-race"
	ScenarioMalformed   Scenario = "malformed-ping"
	ScenarioStale       Scenario = "stale-pings"
	ScenarioInterrupted Scenario = "interrupted-pings"
	ScenarioDuplicate   Scenario = "duplicate-proof"
)

func (s Scenario) Valid() bool {
	switch s {
	case ScenarioSmoke, ScenarioRush, ScenarioIgnored, ScenarioRetry, ScenarioMalformed, ScenarioStale, ScenarioInterrupted, ScenarioDuplicate:
		return true
	default:
		return false
	}
}

type RunRequest struct {
	RunID    string   `json:"runId"`
	Scenario Scenario `json:"scenario"`
}
