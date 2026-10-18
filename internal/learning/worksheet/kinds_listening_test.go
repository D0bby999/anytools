package worksheet

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func listening(t *testing.T, kind string) *Kind {
	t.Helper()
	k, ok := Lookup(kind)
	if !ok {
		t.Fatalf("%s is not registered", kind)
	}
	return k
}

// The barrier layer is one of up's six, and the error map holds at most 30
// places.
func TestTheErrorMapKeepsUpsLayersAndItsRowCap(t *testing.T) {
	k := listening(t, "listening_audit")
	row := func(layer string) string {
		return `{"row": "", "cells": {"timestamp": "1:05", "layer": "` + layer + `", "impact": "recurring"}}`
	}
	ok := `{"map": [` + row("known but not heard") + `]}`
	if _, err := Validate(k, map[string]json.RawMessage{"errors": json.RawMessage(ok)}); err != nil {
		t.Fatalf("one of the six layers: %v", err)
	}
	var fe *FieldError
	bad := `{"map": [` + row("bad luck") + `]}`
	if _, err := Validate(k, map[string]json.RawMessage{"errors": json.RawMessage(bad)}); !errors.As(err, &fe) ||
		!strings.Contains(fe.Field, "layer") {
		t.Fatalf("a seventh layer: %v", err)
	}
	if got := len(k.field("errors", "map").Columns[3].Options); got != 6 {
		t.Fatalf("%d barrier layers, want up's six", got)
	}

	rows := make([]string, 31)
	for i := range rows {
		rows[i] = row("technical")
	}
	full := `{"map": [` + strings.Join(rows[:30], ",") + `]}`
	if _, err := Validate(k, map[string]json.RawMessage{"errors": json.RawMessage(full)}); err != nil {
		t.Fatalf("30 rows: %v", err)
	}
	over := `{"map": [` + strings.Join(rows, ",") + `]}`
	if _, err := Validate(k, map[string]json.RawMessage{"errors": json.RawMessage(over)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a 31st row: %v", err)
	}
}

// A time the page seeks to is MM:SS or H:MM:SS; anything else is refused
// with the field it is in, so the Play button never gets a time it cannot
// play.
func TestListeningTimesAreClockTimes(t *testing.T) {
	k := listening(t, "listening_audit")
	for value, ok := range map[string]bool{
		"0:07": true, "12:30": true, "75:00": true, "1:02:03": true, "": true,
		"1:5": false, "12:60": false, "1:2:03": false, "90": false, "1h": false, "1:02:60": false,
	} {
		w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}}
		err := write(t, k, w, day(1), "segment", `{"start": "`+value+`"}`)
		if ok != (err == nil) {
			t.Errorf("segment start %q: %v", value, err)
		}
		var fe *FieldError
		if !ok && (!errors.As(err, &fe) || fe.Field != "segment.start") {
			t.Errorf("segment start %q refused as %v", value, err)
		}
	}
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}}
	err := write(t, k, w, day(1), "errors",
		`{"map": [{"row": "", "cells": {"timestamp": "0:10"}}, {"row": "", "cells": {"timestamp": "ten"}}]}`)
	var fe *FieldError
	if !errors.As(err, &fe) || fe.Field != "errors.map[1].timestamp" {
		t.Fatalf("a timestamp of %q: %v", "ten", err)
	}
}

// The retests count from the first pass, and each retest row opens on its
// date: +5, +14 and +30 days.
func TestListeningRetestsCountFromTheFirstPass(t *testing.T) {
	k := listening(t, "listening_audit")
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}}
	if err := write(t, k, w, day(2), "task", `{"situation": "weekly sync"}`); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("scheduled before the first pass: %v", w.Reviews)
	}
	if err := write(t, k, w, day(3), "first_pass", `{"gist": "the release slips a week"}`); err != nil {
		t.Fatal(err)
	}
	for key, due := range map[string]string{"days_3_7": "2026-10-08", "day_14": "2026-10-17", "day_30": "2026-11-02"} {
		if w.Reviews[key].Due != due {
			t.Errorf("%s due %q, want %s", key, w.Reviews[key].Due, due)
		}
	}
	if err := write(t, k, w, day(3), "retests", `{"retest": [{"row": "day_1", "cells": {"output": "gist"}}]}`); err != nil {
		t.Fatalf("day 1 row: %v", err)
	}
	early := `{"retest": [{"row": "day_1", "cells": {"output": "gist"}}, {"row": "days_3_7", "cells": {"result": "x"}}]}`
	if err := write(t, k, w, day(7), "retests", early); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("days 3–7 row before its date: %v", err)
	}
	if err := write(t, k, w, day(8), "retests", early); err != nil {
		t.Fatalf("days 3–7 row on its date: %v", err)
	}
}

// §7's delayed shadow is one of this worksheet's recordings, kept beside the
// segment it shadows.
func TestTheDelayedShadowIsThisWorksheetsRecording(t *testing.T) {
	k := listening(t, "listening_audit")
	if !k.HasAudio() {
		t.Fatal("the listening audit takes no recordings")
	}
	own, other := uuid.New(), uuid.New()
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}, Recordings: []Recording{{ID: own}}}
	shadow := func(id uuid.UUID) string {
		return `{"start": "1:00", "end": "1:12", "shadow": "` + id.String() + `"}`
	}
	if err := write(t, k, w, day(1), "segment", shadow(other)); !errors.Is(err, ErrRecordingNotFound) {
		t.Fatalf("another worksheet's recording: %v", err)
	}
	if err := write(t, k, w, day(1), "segment", shadow(own)); err != nil {
		t.Fatalf("its own: %v", err)
	}
	if w.Answers["segment"]["shadow"] != own.String() {
		t.Fatalf("stored %v", w.Answers["segment"])
	}
}

// Day 5 of the listening experiment — dictate and delay-shadow — cannot be
// filled before day 5, and is the only day that keeps a recording.
func TestListeningExperimentDayFiveOpensOnDayFive(t *testing.T) {
	k := listening(t, "listening_experiment")
	take := Recording{ID: uuid.New()}
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}, Recordings: []Recording{take}}
	day5 := `{"row": "day5", "cells": {"recording": "` + take.ID.String() + `", "done": true}}`
	if err := write(t, k, w, day(1), "days", `{"plan": [`+day5+`]}`); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("day 5 before day 1 was marked: %v", err)
	}
	day1 := `{"row": "day1", "cells": {"done": true}}`
	if err := write(t, k, w, day(1), "days", `{"plan": [`+day1+`]}`); err != nil {
		t.Fatal(err)
	}
	if w.Reviews["day5"].Due != "2026-10-05" || len(w.Reviews) != 13 {
		t.Fatalf("reviews %v", w.Reviews)
	}
	both := `{"plan": [` + day1 + `,` + day5 + `]}`
	if err := write(t, k, w, day(4), "days", both); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("day 5 on day 4: %v", err)
	}
	if err := write(t, k, w, day(5), "days", both); err != nil {
		t.Fatalf("day 5 on day 5: %v", err)
	}

	id := uuid.NewString()
	for i := 1; i <= 14; i++ {
		row := fmt.Sprintf("day%d", i)
		raw := `{"plan": [{"row": "` + row + `", "cells": {"recording": "` + id + `"}}]}`
		_, err := Validate(k, map[string]json.RawMessage{"days": json.RawMessage(raw)})
		if (i == 5) != (err == nil) {
			t.Errorf("a recording on %s: %v", row, err)
		}
	}
	decision := k.field("days", "decision")
	if strings.Join(decision.Options, ",") != "keep,downgrade,replace" {
		t.Fatalf("day 14 decision %v", decision.Options)
	}
	if see := k.field("days", "plan").Rows[4].See; see == nil || see.Kind != "listening_audit" || see.Section != "segment" {
		t.Fatalf("day 5 sees %+v", see)
	}
}

// Both kinds attach to a video; phase 15 widens them to media files.
func TestListeningKindsAttachToAVideo(t *testing.T) {
	for _, kind := range []string{"listening_audit", "listening_experiment"} {
		k := listening(t, kind)
		if k.Attach != AttachDocument || strings.Join(k.DocumentKinds, ",") != "youtube,media" || k.Private ||
			k.Group != GroupLanguage {
			t.Errorf("%s: attach %s %v, private %v, group %s", kind, k.Attach, k.DocumentKinds, k.Private, k.Group)
		}
	}
}

// The video's page finds the audit's fields by key (ui/web/app/lib/ladder.ts
// and components/reading/listening-practice.tsx): the ladder's "what became
// visible" per stage, the error map's timestamp, and §7's segment, shadow and
// retelling. Renaming one would silently stop the ladder hiding the
// transcript.
func TestTheVideoPageFindsItsFields(t *testing.T) {
	k := listening(t, "listening_audit")
	stages := k.field("ladder", "stages")
	if stages == nil || len(stages.Rows) != 6 {
		t.Fatalf("ladder.stages: %+v", stages)
	}
	for i, r := range stages.Rows {
		if r.Key != fmt.Sprintf("stage%d", i+1) {
			t.Errorf("ladder row %d is %q", i+1, r.Key)
		}
	}
	has := func(f *Field, col string, typ FieldType) bool {
		for _, c := range f.Columns {
			if c.Key == col {
				return c.Type == typ
			}
		}
		return false
	}
	if !has(stages, "visible", Text) || !has(stages, "action", Label) {
		t.Error("ladder.stages lacks its visible or action column")
	}
	if m := k.field("errors", "map"); m == nil || !has(m, "timestamp", Text) {
		t.Error("errors.map lacks its timestamp column")
	}
	for key, typ := range map[string]FieldType{"start": Text, "end": Text, "shadow": Audio, "retelling": Long} {
		if f := k.field("segment", key); f == nil || f.Type != typ {
			t.Errorf("segment.%s: %+v", key, f)
		}
	}
}
