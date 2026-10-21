// Command bodylibrary adds wger's Spanish and Portuguese names, and a link
// to its page with a video, to Body's exercise library (the private design notes, phase 3), rewriting internal/body/library.json.
//
//	go run ./scripts/bodylibrary <wger exerciseinfo.json> <wger read date>
//
// The openGym entries (hasaneyldrm/exercises-dataset's text, MIT) stay as
// they are. wger's data (CC BY-SA 4.0 or 3.0, CC BY 4.0 or CC0, by exercise)
// is matched to an entry whose name has the same words; names that only
// nearly match are left apart ("seated hammer curl" is not "seated dumbbell
// curl"). The wger file is the API's /api/v2/exerciseinfo/ pages joined into
// one array, read on the date given.
//
// free-exercise-db was taken out again (2026-10-21): its photos and its
// steps were scraped from bodybuilding.com (wrkout/exercises.json's
// CONTRIBUTING says so of the photos; the steps match bodybuilding.com's
// word for word), whatever its Unlicense says.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

const out = "internal/body/library.json"

// entry is library.json's shape (internal/body/library.go reads it).
type entry struct {
	ID string   `json:"id"`
	N  string   `json:"n"`
	BP string   `json:"bp"`
	EQ string   `json:"eq"`
	TG string   `json:"tg"`
	SM []string `json:"sm"`
	ST []string `json:"st"`
	// Wg: wger's names, licence and video for this exercise.
	Wg *wgInfo `json:"wg,omitempty"`
}

type wgInfo struct {
	ID    int               `json:"id"`
	Names map[string]string `json:"names"`
	// Lic and By: each name's licence and author, by language.
	Lic   map[string]string `json:"lic"`
	By    map[string]string `json:"by"`
	Video bool              `json:"video,omitempty"`
}

type wger struct {
	ID           int `json:"id"`
	Translations []struct {
		Name     string `json:"name"`
		Language int    `json:"language"`
		License  int    `json:"license"`
		Author   string `json:"license_author"`
	} `json:"translations"`
	Videos []struct{} `json:"videos"`
}

// wger's language and licence ids (/api/v2/language/, /api/v2/license/).
var (
	wgLang    = map[int]string{2: "en", 4: "es", 7: "pt"}
	wgLicence = map[int]string{1: "CC BY-SA 3.0", 2: "CC BY-SA 4.0", 3: "CC0", 4: "CC BY 4.0"}
)

var (
	nonWord  = regexp.MustCompile(`[^a-z0-9 ]+`)
	synonyms = map[string]string{
		"db": "dumbbell", "dumbbells": "dumbbell", "bb": "barbell", "barbells": "barbell",
		"smith": "smith machine", "pushup": "push up", "pullup": "pull up", "situp": "sit up", "chinup": "chin up",
		"ups": "up", "curls": "curl", "raises": "raise", "presses": "press", "rows": "row",
		"extensions": "extension", "squats": "squat", "lunges": "lunge", "flyes": "fly", "flys": "fly",
		"flies": "fly", "crunches": "crunch", "dips": "dip", "deadlifts": "deadlift", "kickbacks": "kickback",
		"shrugs": "shrug", "twists": "twist", "bodyweight": "",
	}
	stop = map[string]bool{"the": true, "a": true, "with": true, "and": true, "on": true, "of": true, "to": true, "in": true, "exercise": true}
)

// key is a name's words, sorted, without case, punctuation or plurals.
func key(name string) string {
	s := nonWord.ReplaceAllString(strings.ReplaceAll(strings.ToLower(name), "-", " "), " ")
	set := map[string]bool{}
	for _, w := range strings.Fields(s) {
		if v, ok := synonyms[w]; ok {
			w = v
		}
		for _, x := range strings.Fields(w) {
			if !stop[x] {
				set[x] = true
			}
		}
	}
	words := make([]string, 0, len(set))
	for w := range set {
		words = append(words, w)
	}
	sort.Strings(words)
	return strings.Join(words, " ")
}

func must[T any](path string) T {
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		fail(fmt.Errorf("%s: %w", path, err))
	}
	return v
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "bodylibrary:", err)
	os.Exit(1)
}

func main() {
	if len(os.Args) != 3 {
		fail(fmt.Errorf("usage: go run ./scripts/bodylibrary <wger exerciseinfo.json> <wger date>"))
	}
	var raw []json.RawMessage
	raw = must[[]json.RawMessage](out)
	wg := must[[]wger](os.Args[1])

	// openGym's entries; anything an earlier run added is dropped.
	var lib []entry
	for _, r := range raw {
		var e entry
		if err := json.Unmarshal(r, &e); err != nil {
			fail(err)
		}
		if strings.HasPrefix(e.ID, "fe-") {
			continue
		}
		e.Wg = nil
		lib = append(lib, e)
	}
	byKey := map[string]int{}
	for i, e := range lib {
		if _, dup := byKey[key(e.N)]; !dup {
			byKey[key(e.N)] = i
		}
	}

	named := 0
	for _, w := range wg {
		var en string
		info := &wgInfo{ID: w.ID, Names: map[string]string{}, Lic: map[string]string{}, By: map[string]string{}, Video: len(w.Videos) > 0}
		for _, t := range w.Translations {
			lang, ok := wgLang[t.Language]
			lic, licOK := wgLicence[t.License]
			if !ok || !licOK || strings.TrimSpace(t.Name) == "" {
				continue
			}
			if lang == "en" {
				en = t.Name
				continue
			}
			info.Names[lang] = strings.TrimSpace(t.Name)
			info.Lic[lang] = lic
			info.By[lang] = strings.TrimSpace(t.Author)
		}
		i, ok := byKey[key(en)]
		if en == "" || !ok || lib[i].Wg != nil || (len(info.Names) == 0 && !info.Video) {
			continue
		}
		lib[i].Wg = info
		named++
	}

	b, err := json.Marshal(lib)
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(out, append(b, '\n'), 0o644); err != nil {
		fail(err)
	}
	fmt.Printf("%d exercises; wger (%s) names or a video on %d\n", len(lib), os.Args[2], named)
}
