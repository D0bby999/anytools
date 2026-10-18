package main

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

// A dependency added without `go run ./scripts/notices` ships without its
// notice. The Go part is compared exactly; the npm part needs node_modules to
// regenerate, so here it is checked for the direct production dependencies.
func TestNoticesAreCurrent(t *testing.T) {
	b, err := os.ReadFile("../../" + outFile)
	if err != nil {
		t.Fatal(err)
	}
	notices := string(b)

	goPart, err := GoSection("../..")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(notices, goPart) {
		t.Errorf("the Go modules in %s are stale: run `go run ./scripts/notices` from the repository root", outFile)
	}

	pkg, err := os.ReadFile("../../ui/web/package.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct{ Dependencies map[string]string }
	if err := json.Unmarshal(pkg, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Dependencies) == 0 {
		t.Fatal("ui/web/package.json lists no dependencies; the check would pass on nothing")
	}
	var missing []string
	for name := range manifest.Dependencies {
		if !strings.Contains(notices, "| ["+name+"]") && !strings.Contains(notices, "| "+name+" |") {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("%s does not list %v: run `go run ./scripts/notices` from the repository root", outFile, missing)
	}

	for _, credit := range []string{"## byoungd/up", "CC BY-NC", "## DeepTutor", "Apache License", "## omni-tools"} {
		if !strings.Contains(notices, credit) {
			t.Errorf("%s lacks %q", outFile, credit)
		}
	}
}

func TestSPDXNamesTheCommonLicences(t *testing.T) {
	for text, want := range map[string]string{
		"Permission is hereby granted, free of charge, to any person":                                 "MIT",
		"Apache License\n                           Version 2.0, January 2004":                        "Apache-2.0",
		"Redistribution and use in source and binary forms ... Neither the name of Google":            "BSD-3-Clause",
		"Redistribution and use in source and binary forms, with or without modification":             "BSD-2-Clause",
		"Permission to use, copy, modify, and/or distribute this software for any purpose with or":    "ISC",
		"Mozilla Public License Version 2.0":                                                          "MPL-2.0",
		"This is free and unencumbered software released into the public domain, with no conditions.": "",
	} {
		if got := spdx(text); got != want {
			t.Errorf("spdx(%.40q) = %q, want %q", text, got, want)
		}
	}
}
