package worksheet

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

func TestTheBytesDecideARecordingsType(t *testing.T) {
	webm := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81}
	ogg := []byte("OggS\x00\x02\x00\x00")
	mp4 := []byte("\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00")
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR")
	for _, c := range []struct {
		data     []byte
		declared string
		want     string
	}{
		{webm, "audio/webm;codecs=opus", MIMEWebM},
		{webm, "video/webm", MIMEWebM},
		{ogg, "audio/ogg; codecs=opus", MIMEOgg},
		{mp4, "audio/mp4", MIMEMP4},
		{mp4, "audio/x-m4a", MIMEMP4},
	} {
		got, ok := SniffAudio(c.data)
		if !ok || got != c.want || declaredAs(c.declared) != got {
			t.Errorf("%s: sniffed %q (%v), declared as %q", c.declared, got, ok, declaredAs(c.declared))
		}
	}
	if _, ok := SniffAudio(png); ok {
		t.Error("a PNG sniffed as audio")
	}
	// A WebM declared as Ogg disagrees, and so does a made-up type.
	if declaredAs("audio/ogg") == MIMEWebM || declaredAs("image/png") != "" || declaredAs("") != "" {
		t.Error("a declared type agrees with bytes it does not describe")
	}
}

// up's experiment keeps a recording only on the days whose evidence is one.
func TestARecordingCellIsRefusedOnADayWithoutOne(t *testing.T) {
	k, _ := Lookup("speaking_experiment")
	id := uuid.NewString()
	for row, ok := range map[string]bool{"day1": true, "day4": true, "day2": false, "day14": false} {
		raw := `{"plan": [{"row": "` + row + `", "cells": {"recording": "` + id + `"}}]}`
		_, err := Validate(k, map[string]json.RawMessage{"days": json.RawMessage(raw)})
		if ok != (err == nil) {
			t.Errorf("%s: %v", row, err)
		}
	}
}

func day(n int) learning.Day {
	t := time.Date(2026, time.October, n, 0, 0, 0, 0, time.UTC)
	return learning.Day{Year: t.Year(), Month: t.Month(), Day: t.Day()}
}

// write runs one section write through the rules every write shares, as
// Service.Update does under the row lock.
func write(t *testing.T, k *Kind, w *Worksheet, on learning.Day, section, raw string) error {
	t.Helper()
	cleaned, err := Validate(k, map[string]json.RawMessage{section: json.RawMessage(raw)})
	if err != nil {
		return err
	}
	if err := checkRecordings(k, w, cleaned); err != nil {
		return err
	}
	wr := &Write{Sections: map[string]map[string]any{section: merge(w.Answers[section], cleaned[section])}}
	if err := (&Service{}).finish(k, w, wr, day(1), on, nil); err != nil {
		return err
	}
	w.Answers[section] = wr.Sections[section]
	if wr.Reviews != nil {
		w.Reviews = wr.Reviews
	}
	return nil
}

// The retests count from the day the monologue baseline is first recorded,
// and each retest row opens on its date.
func TestSpeakingRetestsCountFromTheMonologueRecording(t *testing.T) {
	k, _ := Lookup("speaking_evidence")
	take := Recording{ID: uuid.New()}
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}, Recordings: []Recording{take}}

	if err := write(t, k, w, day(2), "baselines", `{"main_point": "x"}`); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("scheduled before the monologue was recorded: %v", w.Reviews)
	}
	if err := write(t, k, w, day(3), "baselines",
		`{"samples": [{"row": "monologue", "cells": {"recording": "`+take.ID.String()+`"}}]}`); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"days_3_7": "2026-10-08", "day14": "2026-10-17", "day30": "2026-11-02"}
	for key, due := range want {
		if w.Reviews[key].Due != due {
			t.Errorf("%s due %q, want %s", key, w.Reviews[key].Due, due)
		}
	}
	// Day 1's row is open; the Days 3–7 row is not, until its date.
	if err := write(t, k, w, day(3), "retests", `{"retest": [{"row": "day1", "cells": {"output": "first take"}}]}`); err != nil {
		t.Fatalf("day 1 row: %v", err)
	}
	early := `{"retest": [{"row": "day1", "cells": {"output": "first take"}}, {"row": "day3_7", "cells": {"output": "x"}}]}`
	if err := write(t, k, w, day(7), "retests", early); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("days 3–7 row on day 7 of the month (due the 8th): %v", err)
	}
	if err := write(t, k, w, day(8), "retests", early); err != nil {
		t.Fatalf("days 3–7 row on its date: %v", err)
	}
}

// Day 7 of the experiment cannot be filled on day 2.
func TestAnExperimentDayOpensOnThatDay(t *testing.T) {
	k, _ := Lookup("speaking_experiment")
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}}
	if err := write(t, k, w, day(2), "days", `{"plan": [{"row": "day2", "cells": {"done": true}}]}`); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("day 2 before day 1 was marked: %v", err)
	}
	if err := write(t, k, w, day(1), "days", `{"plan": [{"row": "day1", "cells": {"done": true}}]}`); err != nil {
		t.Fatal(err)
	}
	if w.Reviews["day7"].Due != "2026-10-07" || w.Reviews["day2"].Due != "2026-10-02" || len(w.Reviews) != 13 {
		t.Fatalf("reviews %v", w.Reviews)
	}
	day7 := `{"plan": [{"row": "day1", "cells": {"done": true}}, {"row": "day7", "cells": {"evidence": "x"}}]}`
	if err := write(t, k, w, day(2), "days", day7); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("day 7 on day 2: %v", err)
	}
	if err := write(t, k, w, day(7), "days", day7); err != nil {
		t.Fatalf("day 7 on day 7: %v", err)
	}
}

// An audio value must be one of the worksheet's own recordings.
func TestAnAudioValueMustBeThisWorksheetsRecording(t *testing.T) {
	k, _ := Lookup("speaking_evidence")
	own, other := uuid.New(), uuid.New()
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}, Recordings: []Recording{{ID: own}}}
	ladder := func(id uuid.UUID) string {
		return `{"ladder": [{"row": "mark", "cells": {"recording": "` + id.String() + `"}}]}`
	}
	if err := write(t, k, w, day(1), "shadowing", ladder(other)); !errors.Is(err, ErrRecordingNotFound) {
		t.Fatalf("another recording: %v", err)
	}
	if err := write(t, k, w, day(1), "shadowing", ladder(own)); err != nil {
		t.Fatalf("its own: %v", err)
	}
}

// Deleting a recording clears its id wherever it is held, and leaves every
// other value alone.
func TestClearingARecordingRemovesOnlyItsID(t *testing.T) {
	gone, kept := uuid.NewString(), uuid.NewString()
	w := &Worksheet{Answers: Answers{
		"baselines": {"main_point": "x", "samples": []any{
			map[string]any{"row": "monologue", "cells": map[string]any{"recording": gone, "first_break": "0:40"}},
			map[string]any{"row": "exchange", "cells": map[string]any{"recording": kept}},
		}},
		"task":   {"situation": "standup"},
		"legacy": {"clip": gone},
	}}
	got := clearRecording(w, gone)
	want := map[string]map[string]any{
		"baselines": {"main_point": "x", "samples": []any{
			map[string]any{"row": "monologue", "cells": map[string]any{"first_break": "0:40"}},
			map[string]any{"row": "exchange", "cells": map[string]any{"recording": kept}},
		}},
		"legacy": {},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("cleared %v", got)
	}
}

// The rebuild lines are shown only after level four is marked "not held";
// a show_when must name a yes/no of its own section.
func TestShowWhenNamesAYesNoOfItsSection(t *testing.T) {
	k, _ := Lookup("speaking_evidence")
	f := k.field("shadowing", "keyword_1")
	if f.ShowWhen == nil || f.ShowWhen.Equals || f.ShowWhen.Row != "retell" {
		t.Fatalf("keyword_1 show_when %+v", f.ShowWhen)
	}
	bad := Kind{Kind: "show_probe", Name: "S", Group: GroupLanguage, Source: "s", Version: 1,
		Sections: []Section{{Key: "s", Title: "S", Fields: []Field{
			{Key: "a", Label: "A", Type: Text},
			{Key: "b", Label: "B", Type: Text, ShowWhen: &Condition{Field: "a"}},
		}}}}
	if err := checkKind(&bad); err == nil {
		t.Fatal("a show_when on a text field was accepted")
	}
}

// Day 5 of the experiment points at the speaking evidence's shadowing
// ladder, which must exist.
func TestEveryRowsSeeAlsoNamesARealSection(t *testing.T) {
	for _, k := range Kinds() {
		for _, s := range k.Sections {
			for _, f := range s.Fields {
				for _, r := range f.Rows {
					if r.See == nil {
						continue
					}
					target, ok := Lookup(r.See.Kind)
					if !ok || target.section(r.See.Section) == nil {
						t.Errorf("%s %s.%s[%s] sees %+v, which does not exist", k.Kind, s.Key, f.Key, r.Key, r.See)
					}
				}
			}
		}
	}
}
