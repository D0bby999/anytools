package worksheet

import (
	"context"

	"github.com/google/uuid"
)

// cycles.go is what a cycle's page reads of its closes (phase 10): this
// cycle's own close, which "Close this cycle" opens instead of starting a
// second, and the close of the cycle before it in the same learning state,
// whose results the new cycle starts from. Continue and transfer rows are
// offered for week 1's question; repair rows are shown as "reduce first";
// stop rows are not offered at all.

// CycleCloses is a cycle's view of its closes.
type CycleCloses struct {
	// Close is this cycle's close, or nil.
	Close *Summary `json:"close"`
	// Previous is the close of the state's previous cycle, or nil.
	Previous *PreviousClose `json:"previous"`
}

// PreviousClose is what the next cycle takes from the last close.
type PreviousClose struct {
	ID      uuid.UUID  `json:"id"`
	Title   string     `json:"title"`
	CycleID *uuid.UUID `json:"cycle_id,omitempty"`
	// Offers are the continue and transfer rows that name a next step.
	Offers []Destination `json:"offers"`
	// ReduceFirst are the repair rows.
	ReduceFirst []Destination `json:"reduce_first"`
}

// Destination is one row of a close's destinations table. Row is its index
// there, which the page posts back to choose it.
type Destination struct {
	Row         int    `json:"row"`
	Result      string `json:"result"`
	Destination string `json:"destination"`
	NextStep    string `json:"next_step"`
	Condition   string `json:"condition,omitempty"`
}

// CycleClose reads the owner's cycle's closes. Another user's cycle is
// ErrNotFound.
func (s *Service) CycleClose(ctx context.Context, userID, cycleID uuid.UUID) (*CycleCloses, error) {
	current, previous, err := s.store.CycleCloses(ctx, userID, cycleID)
	if err != nil {
		return nil, err
	}
	out := &CycleCloses{Close: current}
	if previous == nil {
		return out, nil
	}
	p := &PreviousClose{ID: previous.ID, Title: previous.Title, CycleID: previous.CycleID,
		Offers: []Destination{}, ReduceFirst: []Destination{}}
	for i, row := range tableRows(previous.Answers["destinations"]["results"]) {
		d := Destination{Row: i, Result: cellText(row, "result"), Destination: cellText(row, "destination"),
			NextStep: cellText(row, "next_step"), Condition: cellText(row, "condition")}
		switch d.Destination {
		case DestinationContinue, DestinationTransfer:
			if d.NextStep != "" {
				p.Offers = append(p.Offers, d)
			}
		case DestinationRepair:
			p.ReduceFirst = append(p.ReduceFirst, d)
		}
	}
	out.Previous = p
	return out, nil
}
