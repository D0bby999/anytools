package byok

import (
	"context"

	"github.com/google/uuid"
)

// connectors.go — non-AI connectors on the readiness matrix (added by phase 13).
//
// The matrix answers "can this product actually do the thing yet, and if not,
// what is the one sentence that fixes it". Until now every row was an AI
// function with a BYOK chain behind it. A Drive grant Google has stopped
// honouring fails the same test — documents silently stop updating, and
// nothing anywhere says why — so it belongs in the same place the user already
// looks, rather than only on a Settings row they have no reason to open.
//
// It is a SEPARATE list rather than another Function, because a connector has
// no chain, no routes and no cooldown: squeezing it into FunctionReadiness
// would mean four fields that are always empty and one that means something
// different for this row than for every other.

// ConnectorReadiness is one non-AI connector's verdict.
type ConnectorReadiness struct {
	// Connector is the id, e.g. "drive".
	Connector string `json:"connector"`
	Status    Status `json:"status"`
	Reason    string `json:"reason"`
}

// ConnectorReporter reports a connector's readiness for one user.
//
// Consumer-defined, and deliberately string-typed: internal/byok must not
// import internal/connectors/drive to learn what a Drive grant is. The adapter
// lives in internal/app/wire_drive.go.
type ConnectorReporter interface {
	ConnectorReadiness(ctx context.Context, userID uuid.UUID) (ConnectorReadiness, error)
}

// UseConnectors registers the connector reporters Compute consults.
//
// Called at wiring time. A Service with none behaves exactly as it did before
// this file existed: the matrix has no connector rows and nothing downstream
// has to special-case their absence.
func (s *Service) UseConnectors(reporters ...ConnectorReporter) {
	s.connectors = append(s.connectors, reporters...)
}

// connectorRows collects every registered reporter's verdict.
//
// A reporter that FAILS is skipped rather than reported as blocked. Readiness
// is itself a diagnostic screen; a database blip while reading a Drive row must
// not make the matrix claim the connector is broken, which is a different and
// more alarming statement than "we could not check".
func (s *Service) connectorRows(ctx context.Context, userID uuid.UUID) []ConnectorReadiness {
	out := make([]ConnectorReadiness, 0, len(s.connectors))
	for _, r := range s.connectors {
		row, err := r.ConnectorReadiness(ctx, userID)
		if err != nil || row.Connector == "" {
			continue
		}
		out = append(out, row)
	}
	return out
}
