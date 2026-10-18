package parse

import (
	"archive/zip"
	"bytes"
	"errors"
	"runtime"
	"strings"
	"testing"
	"time"
)

// zipOf builds a zip whose entries inflate to the given sizes of repetitive
// XML text, streamed so the test never holds the inflated form itself.
func zipOf(t *testing.T, entries map[string]int, prefix map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	chunk := []byte(strings.Repeat("<w:t>aaaaaaaa</w:t>", 4096))
	for name, size := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(prefix[name]))
		for written := 0; written < size; written += len(chunk) {
			_, _ = w.Write(chunk)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// peakHeapDuring samples the live heap while fn runs and returns the highest
// value above the starting point. Peak live memory is what exhausts a
// container; cumulative allocation also counts garbage the GC already freed.
func peakHeapDuring(fn func()) uint64 {
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	base, peak := ms.HeapAlloc, ms.HeapAlloc
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak {
				peak = m.HeapAlloc
			}
			select {
			case <-stop:
				return
			case <-time.After(time.Millisecond):
			}
		}
	}()
	fn()
	close(stop)
	<-done
	return peak - base
}

const mb = 1 << 20

func TestDecompressionBombsAreRefusedWithinTheirBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("builds several hundred MB of inflated test input")
	}
	slides := map[string]int{}
	for i := 1; i <= 12; i++ {
		slides["ppt/slides/slide"+itoa(i)+".xml"] = 60 * mb
	}
	// Each under the per-part cap; only the whole-document budget stops them.
	budgetOnly := map[string]int{}
	for i := 1; i <= 5; i++ {
		budgetOnly["ppt/slides/slide"+itoa(i)+".xml"] = 25 * mb
	}
	cases := []struct {
		name  string
		data  []byte
		parse func([]byte) (string, int, error)
	}{
		{"docx: one 512 MB document.xml", zipOf(t, map[string]int{"word/document.xml": 512 * mb}, nil), LocalDOCXText},
		{"pptx: twelve 60 MB slides", zipOf(t, slides, nil), LocalPPTXText},
		{"pptx: five 25 MB slides, each under the part cap", zipOf(t, budgetOnly, nil), LocalPPTXText},
		{"epub: a 100 MB package document", zipOf(t, map[string]int{"META-INF/container.xml": 100, "content.opf": 100 * mb}, nil), LocalEPUBText},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.data) > 2*mb {
				t.Fatalf("fixture is %d bytes; a bomb this test means is under 2 MB", len(tc.data))
			}
			var err error
			alloc := peakHeapDuring(func() { _, _, err = tc.parse(tc.data) })
			if !errors.Is(err, ErrTooLarge) {
				t.Fatalf("err = %v, want ErrTooLarge", err)
			}
			// Before the fix the audit measured 1.12 GB peak RSS for the docx,
			// and 11.5 GB allocated for a pptx that then PARSED successfully.
			if alloc > 400*mb {
				t.Fatalf("peak heap %d MB refusing a %d KB file", alloc/mb, len(tc.data)/1024)
			}
			t.Logf("%d KB file refused, peak heap %d MB", len(tc.data)/1024, alloc/mb)
		})
	}
}

func TestADeckOverThePageCapIsRefusedBeforeInflating(t *testing.T) {
	slides := map[string]int{}
	for i := 1; i <= DefaultMaxPages+1; i++ {
		slides["ppt/slides/slide"+itoa(i)+".xml"] = 10
	}
	_, _, err := LocalPPTXText(zipOf(t, slides, nil))
	if !errors.Is(err, ErrPageCapExceeded) {
		t.Fatalf("err = %v, want ErrPageCapExceeded", err)
	}
}
