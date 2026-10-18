package chunk

import (
	"fmt"
	"strings"
)

// code.go — a repository's code file as chunks (up-methods phase 18).
//
// Code has no headings and no pages, and the Markdown splitter would re-render
// it. So a code file is cut on BLANK LINES, the boundaries its author already
// put between functions and blocks, and packed up to the chunk size. Each
// chunk's heading is the file's path and its page range is a LINE range: the
// document's page unit is "line", so a citation reads "path, lines 40-72".

// SplitCode cuts source into chunks of whole blank-line-separated blocks.
// A block longer than the chunk size is cut between lines.
func SplitCode(path, source string, opts Options) []Chunk {
	opts = opts.withDefaults()
	lines := strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n")

	var out []Chunk
	start, size := -1, 0     // the pending chunk's first line (0-based) and length
	flush := func(end int) { // end is exclusive
		if start < 0 {
			return
		}
		first, last := start, end-1
		for first <= last && strings.TrimSpace(lines[first]) == "" {
			first++
		}
		for last >= first && strings.TrimSpace(lines[last]) == "" {
			last--
		}
		if first <= last {
			out = append(out, Chunk{
				Ord:         len(out),
				HeadingPath: path,
				PageStart:   first + 1,
				PageEnd:     last + 1,
				Text: fmt.Sprintf("%s (lines %d-%d)\n\n%s", path, first+1, last+1,
					strings.Join(lines[first:last+1], "\n")),
			})
		}
		start, size = -1, 0
	}

	blockStart := 0
	for i := 0; i <= len(lines); i++ {
		if i < len(lines) && strings.TrimSpace(lines[i]) != "" {
			continue
		}
		// lines[blockStart:i] is one block (possibly empty).
		block := 0
		for _, l := range lines[blockStart:i] {
			block += len(l) + 1
		}
		if block > 0 {
			if start >= 0 && size+block > opts.ChunkSize {
				flush(blockStart)
			}
			if block > opts.ChunkSize {
				// One block bigger than a chunk: cut it between lines.
				flush(blockStart)
				for j := blockStart; j < i; j++ {
					if start >= 0 && size+len(lines[j])+1 > opts.ChunkSize {
						flush(j)
					}
					if start < 0 {
						start = j
					}
					size += len(lines[j]) + 1
				}
			} else {
				if start < 0 {
					start = blockStart
				}
				size += block
			}
		}
		blockStart = i + 1
	}
	flush(len(lines))
	return out
}
