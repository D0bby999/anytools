// Command bodylibrary adds free-exercise-db's exercises and photos, and
// wger's Spanish and Portuguese names and videos, to Body's exercise
// library (the private design notes, phase 3), rewriting
// internal/body/library.json.
//
//	go run ./scripts/bodylibrary <free-exercise-db dist/exercises.json> <fedb commit> <wger exerciseinfo.json> <wger read date>
//
// The openGym entries (hasaneyldrm/exercises-dataset's text, MIT) stay as
// they are, ids unchanged: plans and logs name them. Of free-exercise-db's
// (the Unlicense), one whose name has the same words as an openGym entry's
// gives that entry its two photos; the others are added, with their own
// steps and photos, under ids "fe-<its id>". wger's data (CC BY-SA 4.0 or
// 3.0, CC BY 4.0 or CC0, by exercise) gives a Spanish or Portuguese name and
// a link to its page when it has a video, for an entry whose name matches
// in the same way. Names that only nearly match are left apart: "seated
// hammer curl" is not "seated dumbbell curl".
//
// The wger file is the API's /api/v2/exerciseinfo/ pages joined into one
// array, read on the date given.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
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
	// Src: "fedb" for an exercise free-exercise-db added; empty for openGym's.
	Src string `json:"src,omitempty"`
	// Img: the free-exercise-db id whose 0.jpg and 1.jpg are the photos.
	Img string `json:"img,omitempty"`
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

type fedb struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Equipment *string  `json:"equipment"`
	Primary   []string `json:"primaryMuscles"`
	Secondary []string `json:"secondaryMuscles"`
	Steps     []string `json:"instructions"`
	Category  string   `json:"category"`
	Images    []string `json:"images"`
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

// free-exercise-db's words for muscles and equipment, in openGym's.
var (
	target = map[string]string{
		"abdominals": "abs", "abductors": "abductors", "adductors": "adductors", "biceps": "biceps",
		"calves": "calves", "chest": "pectorals", "forearms": "forearms", "glutes": "glutes",
		"hamstrings": "hamstrings", "lats": "lats", "lower back": "spine", "middle back": "upper back",
		"neck": "levator scapulae", "quadriceps": "quads", "shoulders": "delts", "traps": "traps",
		"triceps": "triceps",
	}
	bodyPart = map[string]string{
		"abdominals": "waist", "abductors": "upper legs", "adductors": "upper legs", "glutes": "upper legs",
		"hamstrings": "upper legs", "quadriceps": "upper legs", "calves": "lower legs",
		"biceps": "upper arms", "triceps": "upper arms", "forearms": "lower arms", "chest": "chest",
		"lats": "back", "middle back": "back", "lower back": "back", "traps": "back",
		"shoulders": "shoulders", "neck": "neck",
	}
	equipment = map[string]string{
		"body only": "body weight", "machine": "leverage machine", "kettlebells": "kettlebell",
		"dumbbell": "dumbbell", "cable": "cable", "barbell": "barbell", "bands": "band",
		"medicine ball": "medicine ball", "exercise ball": "stability ball", "e-z curl bar": "ez barbell",
		"foam roll": "roller", "other": "body weight",
	}
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
	if len(os.Args) != 5 {
		fail(fmt.Errorf("usage: go run ./scripts/bodylibrary <fedb exercises.json> <fedb commit> <wger exerciseinfo.json> <wger date>"))
	}
	all := must[[]entry](out)
	fe := must[[]fedb](os.Args[1])
	wg := must[[]wger](os.Args[3])

	// openGym's entries, as they were before any run.
	var lib []entry
	for _, e := range all {
		if e.Src == "" {
			e.Img, e.Wg = "", nil
			lib = append(lib, e)
		}
	}
	byKey := map[string]int{}
	for i, e := range lib {
		if _, dup := byKey[key(e.N)]; !dup {
			byKey[key(e.N)] = i
		}
	}

	merged, added, noPhotos := 0, 0, 0
	unmapped := map[string]int{}
	for _, f := range fe {
		hasPhotos := len(f.Images) == 2 && f.Images[0] == f.ID+"/0.jpg" && f.Images[1] == f.ID+"/1.jpg"
		if i, ok := byKey[key(f.Name)]; ok {
			if hasPhotos && lib[i].Img == "" {
				lib[i].Img = f.ID
				merged++
			}
			continue
		}
		if len(f.Primary) == 0 || len(f.Steps) == 0 {
			unmapped["no muscle or steps"]++
			continue
		}
		tg, ok := target[f.Primary[0]]
		if !ok {
			unmapped["muscle "+f.Primary[0]]++
			continue
		}
		bp := bodyPart[f.Primary[0]]
		if f.Category == "cardio" {
			bp = "cardio"
		}
		eq := "body weight"
		if f.Equipment != nil {
			if eq, ok = equipment[*f.Equipment]; !ok {
				unmapped["equipment "+*f.Equipment]++
				continue
			}
		}
		var sm []string
		for _, m := range f.Secondary {
			if t, ok := target[m]; ok && t != tg && !slices.Contains(sm, t) {
				sm = append(sm, t)
			}
		}
		if sm == nil {
			sm = []string{}
		}
		e := entry{ID: "fe-" + f.ID, N: strings.ToLower(f.Name), BP: bp, EQ: eq, TG: tg, SM: sm, ST: f.Steps, Src: "fedb"}
		if hasPhotos {
			e.Img = f.ID
		} else {
			noPhotos++
		}
		byKey[key(f.Name)] = len(lib)
		lib = append(lib, e)
		added++
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
	photos := 0
	for _, e := range lib {
		if e.Img != "" {
			photos++
		}
	}
	fmt.Printf("%d exercises (%d added from free-exercise-db %s, %d without photos); photos on %d (%d openGym entries given theirs); wger (%s) names or a video on %d\n",
		len(lib), added, os.Args[2], noPhotos, photos, merged, os.Args[4], named)
	for k, n := range unmapped {
		fmt.Printf("  left out: %s ×%d\n", k, n)
	}
}
