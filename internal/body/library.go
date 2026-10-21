package body

import (
	_ "embed"
	"encoding/json"
	"slices"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// library.json is hasaneyldrm/exercises-dataset's text (MIT), taken through
// openGym's frontend/src/lib/exercises-data.js at 678bf5b, with the image
// and animation file names dropped: that media is © Gym visual and is not
// ours to serve. THIRD-PARTY-NOTICES.md carries the notice.
//
//go:embed library.json
var libraryJSON []byte

// Exercise is one library entry. Names and instructions are English: the
// dataset has no Vietnamese or Portuguese, and a machine translation of 1,324
// form cues is not something to ship unread.
type Exercise struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	BodyPart  string   `json:"body_part"`
	Equipment string   `json:"equipment"`
	Target    string   `json:"target"`
	Secondary []string `json:"secondary"`
	Steps     []string `json:"steps,omitempty"`
	// Wger is the name in other languages and the video wger has for it
	// (the private design notes, phase 3).
	Wger *Wger `json:"wger,omitempty"`
}

// Wger is wger's data for an exercise: each name with its licence and
// author, by language, and whether its page has a video.
type Wger struct {
	ID       int               `json:"id"`
	Names    map[string]string `json:"names"`
	Licences map[string]string `json:"licences"`
	Authors  map[string]string `json:"authors"`
	Video    bool              `json:"video,omitempty"`
}

// Mode is how the exercise is logged when nothing else says: cardio by time
// and speed, everything else by weight and reps.
func (e Exercise) Mode() string {
	if e.BodyPart == "cardio" {
		return ModeCardio
	}
	return ModeReps
}

// Bodyweight reports whether the exercise carries no external load.
func (e Exercise) Bodyweight() bool { return e.Equipment == "body weight" }

var (
	libOnce  sync.Once
	libList  []Exercise
	libIndex map[string]Exercise
)

func loadLibrary() {
	var raw []struct {
		ID string   `json:"id"`
		N  string   `json:"n"`
		BP string   `json:"bp"`
		EQ string   `json:"eq"`
		TG string   `json:"tg"`
		SM []string `json:"sm"`
		ST []string `json:"st"`
		Wg *struct {
			ID    int               `json:"id"`
			Names map[string]string `json:"names"`
			Lic   map[string]string `json:"lic"`
			By    map[string]string `json:"by"`
			Video bool              `json:"video"`
		} `json:"wg"`
	}
	if err := json.Unmarshal(libraryJSON, &raw); err != nil {
		panic("body: library.json: " + err.Error())
	}
	libList = make([]Exercise, 0, len(raw))
	libIndex = make(map[string]Exercise, len(raw))
	for _, r := range raw {
		e := Exercise{ID: r.ID, Name: capitalize(r.N), BodyPart: r.BP, Equipment: r.EQ, Target: r.TG, Secondary: r.SM, Steps: r.ST}
		if r.Wg != nil {
			e.Wger = &Wger{ID: r.Wg.ID, Names: r.Wg.Names, Licences: r.Wg.Lic, Authors: r.Wg.By, Video: r.Wg.Video}
		}
		libList = append(libList, e)
		libIndex[e.ID] = e
	}
	slices.SortFunc(libList, func(a, b Exercise) int { return strings.Compare(a.Name, b.Name) })
}

// capitalize starts a name with a capital, as a title: the dataset's names
// are lower case ("barbell full squat").
func capitalize(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

// Lookup returns a library exercise by id.
func Lookup(id string) (Exercise, bool) {
	libOnce.Do(loadLibrary)
	e, ok := libIndex[id]
	return e, ok
}

// Library is every exercise, by name.
func Library() []Exercise {
	libOnce.Do(loadLibrary)
	return libList
}

// LibraryFilter narrows a search.
type LibraryFilter struct {
	Q         string
	BodyPart  string
	Equipment []string
	Limit     int
	Offset    int
}

// Search returns one page of matches, without steps, and the number of
// matches in all. Every word of the query must appear in the name or the
// target muscle.
func Search(f LibraryFilter) ([]Exercise, int) {
	words := strings.Fields(strings.ToLower(f.Q))
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var out []Exercise
	total := 0
	for _, e := range Library() {
		if f.BodyPart != "" && e.BodyPart != f.BodyPart {
			continue
		}
		if len(f.Equipment) > 0 && !slices.Contains(f.Equipment, e.Equipment) {
			continue
		}
		hay := strings.ToLower(e.Name + " " + e.Target)
		if e.Wger != nil {
			for _, n := range e.Wger.Names {
				hay += " " + strings.ToLower(n)
			}
		}
		if !allIn(words, hay) {
			continue
		}
		total++
		if total > f.Offset && len(out) < limit {
			e.Steps = nil
			out = append(out, e)
		}
	}
	return out, total
}

func allIn(words []string, hay string) bool {
	for _, w := range words {
		if !strings.Contains(hay, w) {
			return false
		}
	}
	return true
}

// Facets are the body parts and equipment the library has, most common first,
// for the filter chips.
type Facets struct {
	BodyParts []string `json:"body_parts"`
	Equipment []string `json:"equipment"`
}

// LibraryFacets counts the library once.
func LibraryFacets() Facets {
	bp, eq := map[string]int{}, map[string]int{}
	for _, e := range Library() {
		bp[e.BodyPart]++
		eq[e.Equipment]++
	}
	return Facets{BodyParts: byCount(bp), Equipment: byCount(eq)}
}

func byCount(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.SortFunc(out, func(a, b string) int {
		if m[a] != m[b] {
			return m[b] - m[a]
		}
		return strings.Compare(a, b)
	})
	return out
}

// Muscle groups for the coverage list: the dataset's target muscles collapsed
// onto the groups a learner would name. A target outside this map (the
// cardiovascular system, the levator scapulae) counts toward nothing.
var muscleGroup = map[string]string{
	"pectorals": "chest", "serratus anterior": "chest",
	"lats": "back", "upper back": "back", "traps": "back",
	"spine":  "lower_back",
	"delts":  "shoulders",
	"biceps": "biceps", "triceps": "triceps", "forearms": "forearms",
	"abs":   "core",
	"quads": "quads", "hamstrings": "hamstrings", "glutes": "glutes",
	"adductors": "hips", "abductors": "hips",
	"calves": "calves",
}

// MuscleGroups is every group, head to toe: the order the coverage list reads in.
var MuscleGroups = []string{
	"shoulders", "chest", "back", "biceps", "triceps", "forearms",
	"core", "lower_back", "glutes", "hips", "quads", "hamstrings", "calves",
}

// secondaryGroup maps the library's secondary muscles onto the same groups.
// Ones no learner tracks (ankles, feet, the neck) count toward nothing.
var secondaryGroup = map[string]string{
	"chest": "chest", "upper chest": "chest",
	"back": "back", "upper back": "back", "lats": "back", "latissimus dorsi": "back",
	"rhomboids": "back", "trapezius": "back", "traps": "back",
	"lower back": "lower_back",
	"shoulders":  "shoulders", "deltoids": "shoulders", "rear deltoids": "shoulders", "rotator cuff": "shoulders",
	"biceps": "biceps", "brachialis": "biceps", "triceps": "triceps",
	"forearms": "forearms", "wrists": "forearms", "wrist flexors": "forearms", "wrist extensors": "forearms",
	"grip muscles": "forearms", "hands": "forearms",
	"core": "core", "obliques": "core", "abdominals": "core", "lower abs": "core",
	"glutes": "glutes", "hip flexors": "hips", "inner thighs": "hips", "groin": "hips",
	"quadriceps": "quads", "hamstrings": "hamstrings",
	"calves": "calves", "soleus": "calves",
}

// GroupShares is how much one set of an exercise counts toward each group:
// 1 for its target's group, 0.5 for each secondary muscle's.
func GroupShares(id string) map[string]float64 {
	e, ok := Lookup(id)
	if !ok {
		return nil
	}
	out := map[string]float64{}
	for _, m := range e.Secondary {
		if g := secondaryGroup[m]; g != "" {
			out[g] = 0.5
		}
	}
	if g := muscleGroup[e.Target]; g != "" {
		out[g] = 1
	}
	return out
}

// GroupOf is an exercise's muscle group, or "".
func GroupOf(id string) string {
	e, ok := Lookup(id)
	if !ok {
		return ""
	}
	return muscleGroup[e.Target]
}
