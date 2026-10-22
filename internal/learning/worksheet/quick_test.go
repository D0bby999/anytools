package worksheet

import (
	"encoding/json"
	"testing"

	"github.com/D0bby999/anytools/internal/learning"
)

// sample is a valid value for one field, as a client would send it. Audio
// is left out: it names a recording the worksheet must already have.
func sample(f Field, options []string, row string) (any, bool) {
	switch f.Type {
	case Text, Long:
		return "a first answer", true
	case Choice:
		if len(options) == 0 {
			return nil, false
		}
		return options[0], true
	case Multi:
		if len(options) == 0 {
			return nil, false
		}
		return []string{options[0]}, true
	case Score:
		return 1, true
	case YesNo, Check:
		return true, true
	case Date:
		return "2026-11-30", true
	case Table:
		rowKey := row
		if rowKey == "" && len(f.Rows) > 0 {
			rowKey = f.Rows[0].Key
		}
		cells := map[string]any{}
		for _, c := range f.Columns {
			if c.Type == Label || c.Type == Audio || !c.appliesTo(rowKey) {
				continue
			}
			opts := c.Options
			if o, ok := c.RowOptions[rowKey]; ok {
				opts = o
			}
			if v, ok := sample(c, opts, ""); ok {
				cells[c.Key] = v
			}
		}
		return []map[string]any{{"row": rowKey, "cells": cells}}, true
	}
	return nil, false
}

// Every kind's quick version, filled and nothing else, is a worksheet the
// engine accepts while it is open, and its reviews are scheduled as a full
// one's would be (red team 4 and 5, the private design notes).
func TestAQuickVersionAloneIsAcceptedAndScheduled(t *testing.T) {
	today := learning.Day{Year: 2026, Month: 10, Day: 22}
	quick := 0
	for _, k := range Kinds() {
		if len(k.Quick) == 0 {
			fields := 0
			for _, s := range k.Sections {
				fields += len(s.Fields)
			}
			if fields > 12 {
				t.Errorf("%s has %d fields and no quick version", k.Kind, fields)
			}
			continue
		}
		quick++
		anchorRow := map[string]string{}
		for _, r := range k.Reviews {
			if r.From.Row != "" {
				anchorRow[r.From.Section+"."+r.From.Field] = r.From.Row
			}
		}
		raw := map[string]map[string]any{}
		for _, qf := range k.Quick {
			f := k.field(qf.Section, qf.Field)
			v, ok := sample(*f, f.Options, anchorRow[qf.Section+"."+qf.Field])
			if !ok {
				t.Fatalf("%s.%s.%s: no sample", k.Kind, qf.Section, qf.Field)
			}
			if qf.Today {
				v = today.String()
			}
			if raw[qf.Section] == nil {
				raw[qf.Section] = map[string]any{}
			}
			raw[qf.Section][qf.Field] = v
		}
		sections := map[string]json.RawMessage{}
		written := map[string]bool{}
		for s, fields := range raw {
			b, _ := json.Marshal(fields)
			sections[s] = b
			written[s] = true
		}
		cleaned, err := Validate(k, sections)
		if err != nil {
			t.Errorf("%s: quick answers refused: %v", k.Kind, err)
			continue
		}
		answers := Answers(cleaned)
		if k.Check != nil {
			if err := k.Check(answers, StatusOpen); err != nil {
				t.Errorf("%s: an open quick worksheet fails its check: %v", k.Kind, err)
			}
		}
		if k.CheckWritten != nil {
			if err := k.CheckWritten(answers, written); err != nil {
				t.Errorf("%s: a quick write fails its check: %v", k.Kind, err)
			}
		}
		reviews := map[string]ReviewDate{}
		schedule(k, answers, reviews, today, today)
		for _, r := range k.Reviews {
			if f := k.anchorField(r.From); f != nil && f.Type == Audio {
				continue // scheduled once the learner records
			}
			if _, ok := reviews[r.Key]; !ok {
				t.Errorf("%s: review %s not scheduled from the quick version", k.Kind, r.Key)
			}
		}
	}
	if quick < 20 {
		t.Fatalf("only %d kinds have a quick version", quick)
	}
}
